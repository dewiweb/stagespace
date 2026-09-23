// Test d'intégration "graphe complexe" — pousse un move graph croisant
// engines + modifiers + composites + physics, un global graph complet
// (Merge.strategy + transforms + Zone/Velocity), et vérifie la chaîne
// réelle : workers → MergeRuntime → post-process → PositionSink.
#[allow(clippy::uninlined_format_args)]
mod complex_graph_tests {
    use crate::commands::merge_commands::{
        parse_direction, parse_loop_mode, spawn_move_for_recall, MoveSpec,
    };
    use crate::commands::state::Shared;
    use crate::graph::compilation::compile_graph_with_audio;
    use crate::graph::parser::build_graph_from_json;
    use stagespace_engines::position_sink::{PositionSink, SendReport};
    use stagespace_engines::{
        AudioState, MergeRuntime, OscProfile, OscReceiver, OscSender, SpatialChannels,
    };
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
            osc_receiver: Arc::new(Mutex::new(OscReceiver::new(0))),
            plugin_registry: None,
        }
    }

    fn n(id: &str, ty: &str, params: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "id": id, "type": "custom", "position": {"x": 0, "y": 0},
            "data": {"label": ty, "type": ty, "params": params}
        })
    }

    fn e(id: &str, from: &str, to: &str, to_port: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id, "source": from, "target": to,
            "sourceHandle": "output", "targetHandle": to_port
        })
    }

    /// Move graph complexe : deux branches engine+modifier mélangées (Mix),
    /// alternées dans le temps avec un essaim physique (Sequence).
    ///
    ///   Objects ─┬─→ Circular ─→ Scale ──────────→ Mix.A ─┐
    ///            ├─→ Spiral ───→ Rotate ─────────→ Mix.B ─┴→ Sequence.A ─┐
    ///            └─→ Swarm ─────────────────────────────────→ Sequence.B ┴→ Output
    ///   Duration ─→ Circular, Spiral, Swarm (port duration)
    fn complex_move_graph() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                n("objs", "Objects", serde_json::json!({"n_objects": 6})),
                n("dur", "Duration", serde_json::json!({"duration": 4.0})),
                n("circ", "Circular", serde_json::json!({"radius": 2.0})),
                n("spir", "Spiral", serde_json::json!({"radius": 1.5, "turns": 2.0})),
                n("swarm", "Swarm", serde_json::json!({})),
                n("scale", "Scale", serde_json::json!({"x": 2.0, "y": 1.0, "z": 0.5})),
                n("rot", "Rotate", serde_json::json!({"angleY": 0.5})),
                n("mix", "Mix", serde_json::json!({"blend": 0.6})),
                n("seq", "Sequence", serde_json::json!({})),
                n("out", "Output", serde_json::json!({})),
            ],
            "edges": [
                e("e1", "objs", "circ", "input"),
                e("e2", "objs", "spir", "input"),
                e("e3", "objs", "swarm", "input"),
                e("e4", "dur", "circ", "duration"),
                e("e5", "dur", "spir", "duration"),
                e("e6", "dur", "swarm", "duration"),
                e("e7", "circ", "scale", "input"),
                e("e8", "scale", "mix", "input_a"),
                e("e9", "spir", "rot", "input"),
                e("e10", "rot", "mix", "input_b"),
                e("e11", "mix", "seq", "input_a"),
                e("e12", "swarm", "seq", "input_b"),
                e("e13", "seq", "out", "input"),
            ]
        })
    }

    /// Global graph complet : Merge (strategy=blend) → transforms → effets.
    fn complex_global_graph() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                n("merge", "Merge", serde_json::json!({"strategy": "blend"})),
                n("man", "ManualPosition", serde_json::json!({})),
                n("rs", "RadiusScale", serde_json::json!({"radius_scale": 1.5})),
                n("ho", "HeightOffset", serde_json::json!({"height_offset": 0.5})),
                n("ptd", "PerTrackDepth", serde_json::json!({"depths": []})),
                n("sc", "Scale", serde_json::json!({"scale": 2.0})),
                n("rot", "Rotate", serde_json::json!({"yaw": 90.0})),
                n("off", "Offset", serde_json::json!({"x": 1.0, "y": 0.0, "z": 0.0})),
                n("zone", "Zone", serde_json::json!({
                    "shape": "sphere", "center": [0, 0, 0], "radius": 2.5,
                    "falloff": 0.5, "channels": {"spread": 1.0}, "enabled": true
                })),
                n("vel", "Velocity", serde_json::json!({
                    "source": "speed", "channel": "distance",
                    "scale": 0.1, "offset": 0.0, "min": 0.0, "max": 2.0
                })),
                n("out", "Output", serde_json::json!({})),
            ],
            "edges": [
                e("g1", "merge", "man", "input"),
                e("g2", "man", "rs", "input"),
                e("g3", "rs", "ho", "input"),
                e("g4", "ho", "ptd", "input"),
                e("g5", "ptd", "sc", "input"),
                e("g6", "sc", "rot", "input"),
                e("g7", "rot", "off", "input"),
                e("g8", "off", "zone", "input"),
                e("g9", "zone", "vel", "input"),
                e("g10", "vel", "out", "input"),
            ]
        })
    }

    #[test]
    fn test_complex_move_graph_compiles_and_moves() {
        let audio = Arc::new(Mutex::new(AudioState::new()));
        let graph =
            build_graph_from_json(&complex_move_graph(), &audio.lock().unwrap()).expect("parse");
        let f = compile_graph_with_audio(&graph, audio).expect("compile");

        // 6 objets — positions finies, distinctes par objet, mouvantes dans t
        let p0_t0 = f(0.0, 0);
        let p0_t1 = f(1.0, 0);
        assert!(p0_t0.iter().all(|v| v.is_finite()), "t0: {p0_t0:?}");
        assert!(
            (p0_t1 - p0_t0).norm() > 1e-6,
            "l'objet 0 doit bouger entre t=0 et t=1"
        );
        for i in 0..6 {
            let p = f(0.5, i);
            assert!(p.iter().all(|v| v.is_finite()), "obj {i}: {p:?}");
        }
        // Les objets ne doivent pas tous être superposés
        let distinct: HashSet<u64> = (0..6)
            .map(|i| {
                let p = f(0.5, i);
                (p.x * 1000.0) as i64 as u64 ^ ((p.z * 1000.0) as i64 as u64) << 32
            })
            .collect();
        assert!(distinct.len() > 1, "les objets doivent être distincts");
    }

    #[test]
    fn test_complex_global_graph_effects_and_chain() {
        let audio = AudioState::new();
        let graph = build_graph_from_json(&complex_global_graph(), &audio).expect("parse");

        // Effets extraits : strategy blend + 1 zone + 1 modulation
        let effects = stagespace_engines::extract_graph_effects(&graph).expect("effects");
        assert_eq!(
            effects.strategy,
            Some(stagespace_engines::merge_runtime::MergeStrategy::Blend)
        );
        assert_eq!(effects.zones.len(), 1);
        assert_eq!(effects.modulations.len(), 1);

        // La chaîne compile et transforme : radius×1.5, height+0.5, scale×2,
        // yaw 90°, offset +1x. Entrée (1,0,0) → (1.5,0.5,0) → (3,1,0) →
        // rot yaw : norme xz conservée (9) et y=1 → +offset x.
        let macros = Arc::new(stagespace_engines::runtime::MacroState::new());
        let pp = stagespace_engines::compile_post_process(
            stagespace_engines::PostProcessCompileParams {
                graph,
                macros: macros.clone(),
            },
        )
        .expect("compile post-process");

        let track_positions = HashMap::new();
        let manual_positions = HashMap::new();
        let depths: Vec<f64> = vec![];
        let ctx = stagespace_engines::runtime::PostProcessContext {
            t: 0.0,
            macros: &macros,
            audio_state: &audio,
            track_positions: &track_positions,
            manual_positions: &manual_positions,
            origin: nalgebra::Vector3::zeros(),
            track_depths: &depths,
        };
        let out = pp(&ctx, vec![(0usize, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
        assert_eq!(out.len(), 1);
        let p = out[0].1;
        assert!((p.y - 1.0).abs() < 1e-9, "y = height+scale: {p:?}");
        // yaw 90° conserve la norme XZ (3.0 avant offset) puis +1 en x
        let xz = ((p.x - 1.0).powi(2) + p.z.powi(2)).sqrt();
        assert!((xz - 3.0).abs() < 1e-9, "norme xz après rot+offset: {p:?}");
    }

    /// Frames capturées : (object_id, [x, y, z]) par envoi.
    type FrameLog = Arc<Mutex<Vec<(u32, [f64; 3])>>>;

    /// Sink de capture — enregistre chaque frame mergée (post-process incluse).
    struct RecordingSink {
        frames: FrameLog,
    }
    impl PositionSink for RecordingSink {
        fn send_state(
            &mut self,
            object_id: u32,
            position: nalgebra::Vector3<f64>,
            _channels: Option<&SpatialChannels>,
        ) -> SendReport {
            self.frames
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((object_id, [position.x, position.y, position.z]));
            SendReport {
                sent: 1,
                ..Default::default()
            }
        }
        fn describe(&self) -> String {
            "recording".to_string()
        }
    }

    /// End-to-end : le graphe complexe spawné en vrai worker + un circular en
    /// conflit sur la track 0 → merge thread → sink. Vérifie que les frames
    /// sortent pour les deux objets et que les positions bougent.
    #[test]
    fn test_complex_graph_end_to_end_through_merge() {
        let sh = make_shared();
        let frames: FrameLog = Arc::new(Mutex::new(Vec::new()));

        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_sink(Box::new(RecordingSink {
                frames: frames.clone(),
            }));
            mr.set_osc_ids(vec![1, 2]);
        }

        let spec =
            |id: &str, name: &str, graph: serde_json::Value, osc_ids: Vec<u32>, idx: Vec<usize>| {
                MoveSpec {
                    id: id.to_string(),
                    name: name.to_string(),
                    graph_json: graph,
                    osc_ids,
                    track_indices: idx,
                    is_preview: false,
                    origin: None,
                    duration: 4.0,
                    loop_mode: parse_loop_mode("loop"),
                    direction: parse_direction("forward"),
                    fade: None,
                    speed: None,
                    spatial_macros: None,
                    animation_state: None,
                }
            };

        // Move A : graphe complexe sur osc_id 1 (index 0)
        spawn_move_for_recall(
            spec(
                "mv-complex",
                "Complex",
                complex_move_graph(),
                vec![1],
                vec![0],
            ),
            &sh,
        )
        .expect("spawn complex");
        // Move B : circular sur osc_ids 1+2 (index 0+1) — conflit sur index 0
        let circle = serde_json::json!({
            "nodes": [
                n("o", "Objects", serde_json::json!({"n_objects": 2})),
                n("d", "Duration", serde_json::json!({"duration": 4.0})),
                n("c", "Circular", serde_json::json!({"radius": 1.0})),
                n("out", "Output", serde_json::json!({})),
            ],
            "edges": [
                e("a", "o", "c", "input"),
                e("b", "d", "c", "duration"),
                e("c", "c", "out", "input"),
            ]
        });
        spawn_move_for_recall(
            spec("mv-circle", "Circle", circle, vec![1, 2], vec![0, 1]),
            &sh,
        )
        .expect("spawn circle");

        // Démarrer le merge thread et laisser tourner ~500ms
        sh.merge_runtime
            .lock()
            .unwrap()
            .start()
            .expect("merge start");
        std::thread::sleep(std::time::Duration::from_millis(500));
        sh.merge_runtime.lock().unwrap().stop();

        let captured = frames.lock().unwrap();
        assert!(!captured.is_empty(), "aucune frame capturée par le sink");

        // Les deux objets émettent (track 1 gagnée par un des deux moves,
        // track 2 par le circular seul)
        let ids: HashSet<u32> = captured.iter().map(|(id, _)| *id).collect();
        assert!(ids.contains(&1), "osc_id 1 absent des frames: {ids:?}");
        assert!(ids.contains(&2), "osc_id 2 absent des frames: {ids:?}");

        // Les positions bougent dans le temps (première vs dernière frame de l'id 2)
        let pos2: Vec<[f64; 3]> = captured
            .iter()
            .filter(|(id, _)| *id == 2)
            .map(|(_, p)| *p)
            .collect();
        assert!(pos2.len() >= 2);
        let moved = (pos2[0][0] - pos2[pos2.len() - 1][0]).abs()
            + (pos2[0][2] - pos2[pos2.len() - 1][2]).abs();
        assert!(moved > 1e-3, "l'objet 2 doit bouger: {pos2:?}");

        // Toutes les positions sont finies
        assert!(captured
            .iter()
            .all(|(_, p)| p.iter().all(|v| v.is_finite())));

        // Perf : le merge a réellement tourné
        assert!(
            sh.merge_runtime.lock().unwrap().merge_frame_count() > 0,
            "le merge thread doit avoir produit des frames"
        );

        // Cleanup : stopper les workers
        let mv = sh.movements.lock().unwrap();
        for m in mv.values() {
            m.runtime.stop();
        }
    }
}
