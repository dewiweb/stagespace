// Tests du binding `param:` per-move — la mise à jour du seul graphe
// signal recompile le move et re-lie les slots (modulation effective).
#[allow(clippy::uninlined_format_args)]
mod param_modulation_tests {
    use crate::commands::merge_commands::{spawn_move_for_recall, MoveSpec};
    use crate::commands::state::Shared;
    use stagespace_engines::{AudioState, MergeRuntime, OscProfile, OscReceiver, OscSender};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex};

    fn make_shared() -> Shared {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let merge =
            MergeRuntime::new("127.0.0.1".to_string(), 0, sender, 60.0).expect("MergeRuntime bind");
        Shared {
            audio_state: Arc::new(Mutex::new(AudioState::new())),
            app_handle: Arc::new(Mutex::new(None)),
            movements: Arc::new(Mutex::new(HashMap::new())),
            pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
            move_generation: Arc::new(AtomicU64::new(0)),
            merge_runtime: Arc::new(Mutex::new(merge)),
            recall_in_progress: Arc::new(AtomicBool::new(false)),
            deactivate_gen: Arc::new(AtomicU64::new(0)),
            osc_receiver: Arc::new(Mutex::new(OscReceiver::new(0))),
            plugin_registry: None,
            plugins_dir: None,
        }
    }

    fn move_graph_json() -> serde_json::Value {
        // Objects + Duration → Circular → Scale(id "sc") → Output.
        serde_json::json!({
            "nodes": [
                {"id": "o", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Objects", "params": {"n_objects": 2}}},
                {"id": "d", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Duration", "params": {"duration": 4.0}}},
                {"id": "c", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Circular", "params": {"radius": 1.0}}},
                {"id": "sc", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Scale", "params": {"x": 1.0, "y": 1.0, "z": 1.0}}},
                {"id": "out", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Output", "params": {}}},
            ],
            "edges": [
                {"id":"e1","source":"o","target":"c","sourceHandle":"objects","targetHandle":"objects"},
                {"id":"e2","source":"d","target":"c","sourceHandle":"duration","targetHandle":"duration"},
                {"id":"e3","source":"c","target":"sc","sourceHandle":"out","targetHandle":"in"},
                {"id":"e4","source":"sc","target":"out","sourceHandle":"out","targetHandle":"in"},
            ]
        })
    }

    fn signal_graph_json(target: &str, value: f64) -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "k", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "SignalConst", "params": {"value": value}}},
                {"id": "s", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "SignalOut", "params": {"target": target, "amount": 1.0}}},
            ],
            "edges": [
                {"id":"e1","source":"k","target":"s","sourceHandle":"out","targetHandle":"signal"},
            ]
        })
    }

    /// Mettre à jour SEULEMENT le graphe signal d'un move re-bind les
    /// slots : la cible `param:` pointe la nouvelle table, la modulation
    /// est effective après le swap — et une cible invalide est rejetée.
    #[test]
    fn signal_graph_update_rebinds_param_slots() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        let spec = MoveSpec {
            id: "mv-mod".to_string(),
            name: "Mod".to_string(),
            graph_json: serde_json::from_value(move_graph_json()).unwrap(),
            osc_ids: vec![7],
            track_indices: vec![0],
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: stagespace_engines::LoopMode::Loop,
            direction: stagespace_engines::PlayDirection::Forward,
            fade: None,
            speed: None,
            spatial_macros: None,
            animation_state: None,
            signal_graph: Some(
                serde_json::from_value(signal_graph_json("param:sc:x", 0.5)).unwrap(),
            ),
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
        };
        spawn_move_for_recall(spec, &sh).expect("spawn with signal graph");

        // Le worker tourne : positions buffer = cercle scalé par 1+0.5=1.5.
        std::thread::sleep(std::time::Duration::from_millis(120));
        {
            let movements = sh.movements.lock().unwrap();
            let m = movements.get("mv-mod").unwrap();
            let buf = m.runtime.position_buffer_arc().expect("buffer");
            let positions = buf.read();
            let p = positions[0].1;
            let r = (p.x * p.x + p.z * p.z).sqrt();
            assert!(
                (r - 1.5).abs() < 0.2,
                "param:sc:x +0.5 → rayon 1.5, got {r} (pos={p:?})"
            );
        }

        // Re-bind : un nouveau signal graph ciblant le même slot avec une
        // autre valeur → le swap atomique remplace la modulation.
        {
            let movements = sh.movements.lock().unwrap();
            let m = movements.get("mv-mod").unwrap();
            let audio = sh.audio_state.lock().unwrap().clone();
            let move_graph =
                crate::graph::parser::build_graph_from_json(&m.graph_json, &audio).unwrap();
            let slots = stagespace_engines::param_slots::ParamSlots::build(&move_graph);
            let compiled = crate::graph::compilation::compile_graph_live(
                &move_graph,
                &sh,
                Some(slots.clone()),
                Some(m.runtime.held_positions()),
            )
            .unwrap();
            let sig_graph = crate::graph::parser::build_graph_from_json(
                &serde_json::from_value(signal_graph_json("param:sc:x", -0.75)).unwrap(),
                &audio,
            )
            .unwrap();
            let sig_fn =
                stagespace_engines::compile_move_signal_graph(&sig_graph, &move_graph, &slots)
                    .unwrap();
            m.runtime
                .swap_compiled(compiled.clone(), compiled, sig_fn, slots);
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
        {
            let movements = sh.movements.lock().unwrap();
            let m = movements.get("mv-mod").unwrap();
            let buf = m.runtime.position_buffer_arc().expect("buffer");
            let p = buf.read()[0].1;
            let r = (p.x * p.x + p.z * p.z).sqrt();
            assert!(
                (r - 0.25).abs() < 0.2,
                "re-bind param:sc:x −0.75 → rayon 0.25, got {r}"
            );
        }

        // Cible invalide → erreur de compile explicite (pas de silent no-op).
        let movements = sh.movements.lock().unwrap();
        let m = movements.get("mv-mod").unwrap();
        let audio = sh.audio_state.lock().unwrap().clone();
        let move_graph =
            crate::graph::parser::build_graph_from_json(&m.graph_json, &audio).unwrap();
        let slots = stagespace_engines::param_slots::ParamSlots::build(&move_graph);
        let bad = crate::graph::parser::build_graph_from_json(
            &serde_json::from_value::<stagespace_engines::GraphJson>(signal_graph_json(
                "param:sc:nope",
                1.0,
            ))
            .unwrap(),
            &audio,
        )
        .unwrap();
        assert!(
            stagespace_engines::compile_move_signal_graph(&bad, &move_graph, &slots).is_err(),
            "param:sc:nope must fail"
        );
        let _ = m;
    }
    /// `diagnose_graph_inner` : parse failure → issue Error (pas d'erreur
    /// IPC) ; graphe valide → issues vides ; ids frontend présents.
    #[test]
    fn diagnose_graph_inner_reports_issues() {
        use crate::commands::merge_commands::diagnose_graph_inner;
        let sh = make_shared();

        let run = |graph_json: serde_json::Value, ctx: &str, mv: Option<serde_json::Value>| {
            diagnose_graph_inner(
                serde_json::from_value(graph_json).unwrap(),
                ctx,
                mv.map(|v| serde_json::from_value(v).unwrap()),
                &sh,
            )
        };

        // Graphe move valide → aucune issue.
        let issues = run(move_graph_json(), "sub", None).unwrap();
        assert!(issues.is_empty(), "valid graph: {issues:?}");

        // Node inconnu → parse échoue → issue Error (pas d'IPC err).
        let bad = serde_json::json!({
            "nodes": [{"id": "x", "type": "custom", "position": {"x":0.0,"y":0.0},
                       "data": {"type": "NoSuchType", "params": {}}}],
            "edges": []
        });
        let issues = run(bad, "sub", None).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, stagespace_engines::IssueSeverity::Error);

        // Contexte global sans source → erreur.
        let glob = serde_json::json!({
            "nodes": [
                {"id": "sc", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Scale", "params": {"x": 1.0}}},
                {"id": "out", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Output", "params": {}}},
            ],
            "edges": [{"id":"e1","source":"sc","target":"out","sourceHandle":"out","targetHandle":"in"}]
        });
        let issues = run(glob, "global", None).unwrap();
        assert!(
            issues.iter().any(|i| i.message.contains("source")),
            "{issues:?}"
        );

        // Signal : cible `param:` inconnue → erreur portant l'id du SignalOut.
        let sig = serde_json::json!({
            "nodes": [
                {"id": "k", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "SignalConst", "params": {"value": 1.0}}},
                {"id": "s", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "SignalOut", "params": {"target": "param:ghost:x", "amount": 1.0}}},
            ],
            "edges": [{"id":"e1","source":"k","target":"s","sourceHandle":"out","targetHandle":"signal"}]
        });
        let issues = run(sig, "signal", Some(move_graph_json())).unwrap();
        let err = issues
            .iter()
            .find(|i| i.severity == stagespace_engines::IssueSeverity::Error)
            .expect("param target error");
        assert_eq!(err.node_ids, vec!["s".to_string()], "SignalOut id expected");
    }

    /// L'exemple livré doit rester valide : chaque graphe global (principal
    /// + copies des snapshots) passe le diagnostic sans erreur.
    #[test]
    fn example_show_global_graphs_have_no_errors() {
        use crate::commands::merge_commands::diagnose_graph_inner;
        let sh = make_shared();
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../examples/full-feature-show.hfg"
        ))
        .unwrap();
        let show: serde_json::Value = serde_json::from_str(&raw).unwrap();

        fn collect<'a>(v: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
            match v {
                serde_json::Value::Object(m) => {
                    let is_global = m
                        .get("nodes")
                        .and_then(|n| n.as_array())
                        .is_some_and(|ns| ns.iter().any(|n| n["data"]["type"] == "Merge"));
                    if is_global {
                        out.push(v);
                    }
                    m.values().for_each(|x| collect(x, out));
                }
                serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
                _ => {}
            }
        }
        let mut graphs = Vec::new();
        collect(&show, &mut graphs);
        assert!(!graphs.is_empty(), "no global graph found in example");
        for g in graphs {
            let issues = diagnose_graph_inner(
                serde_json::from_value(g.clone()).unwrap(),
                "global",
                None,
                &sh,
            )
            .unwrap();
            let errors: Vec<_> = issues
                .iter()
                .filter(|i| i.severity == stagespace_engines::IssueSeverity::Error)
                .collect();
            assert!(errors.is_empty(), "example global graph errors: {errors:?}");
        }
    }
}
