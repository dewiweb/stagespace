//! Tests du système de slots de params modulables — cibles `param:` du
//! domaine signal (additive, dense, sans stale).
#[cfg(test)]
mod tests {
    use crate::audio::AudioState;
    use crate::compiler::{Compiler, LiveInputs};
    use crate::graph::{Edge, Graph, Node, NodeId, NodeType};
    use crate::node_spec::{all_node_specs, NodeScope};
    use crate::param_slots::{node_key, ParamSlots};
    use crate::signal_compiler::{
        compile_move_signal_graph, compile_signal_graph, SignalCompileError, SignalCtx,
    };
    use std::collections::HashMap;
    use std::sync::Arc;

    /// Node avec un `__fe_id` — comme le parser backend, pour des clés de
    /// ciblage stables (`param:<fe_id>:<key>`).
    fn fe(t: NodeType, fe_id: &str, params: serde_json::Value) -> Node {
        let mut p = params;
        p["__fe_id"] = serde_json::json!(fe_id);
        Node::with_params(t, p)
    }

    fn wire(g: &mut Graph, from: NodeId, to: NodeId, from_port: &str, to_port: &str) {
        g.add_edge(Edge {
            from,
            to,
            from_port: from_port.to_string(),
            to_port: to_port.to_string(),
        });
    }

    fn ctx<'a>(t: f64, audio: &'a AudioState) -> SignalCtx<'a> {
        static OSC: std::sync::OnceLock<HashMap<String, Vec<f64>>> = std::sync::OnceLock::new();
        SignalCtx {
            t,
            dt: 1.0 / 60.0,
            audio_state: audio,
            osc_values: OSC.get_or_init(HashMap::new),
        }
    }

    /// Graphe move : Objects+Duration → Circular → <chain nodes> → Output.
    /// `chain` est connectée en série après le cercle.
    fn move_graph_with(chain: Vec<Node>) -> (Graph, Vec<String>) {
        let mut g = Graph::new();
        let objects = fe(NodeType::Objects, "o", serde_json::json!({"n_objects": 4}));
        let dur = fe(
            NodeType::Duration,
            "d",
            serde_json::json!({"duration": 4.0}),
        );
        let circle = fe(
            NodeType::Circular,
            "c",
            serde_json::json!({"radius": 1.0, "plane": "xz"}),
        );
        let out = fe(NodeType::Output, "out", serde_json::json!({}));
        let (o_id, d_id, c_id, out_id) = (objects.id, dur.id, circle.id, out.id);
        g.add_node(objects);
        g.add_node(dur);
        g.add_node(circle);
        g.add_node(out);
        wire(&mut g, o_id, c_id, "objects", "objects");
        wire(&mut g, d_id, c_id, "duration", "duration");

        let mut keys = Vec::new();
        let mut prev = c_id;
        for n in chain {
            keys.push(node_key(&n));
            let id = n.id;
            g.add_node(n);
            wire(&mut g, prev, id, "out", "in");
            prev = id;
        }
        wire(&mut g, prev, out_id, "out", "in");
        (g, keys)
    }

    /// Signal graph `SignalConst(value) → SignalOut(target)`.
    fn const_signal(target: &str, value: f64, amount: f64) -> Graph {
        let mut g = Graph::new();
        let c = Node::with_params(NodeType::SignalConst, serde_json::json!({"value": value}));
        let o = Node::with_params(
            NodeType::SignalOut,
            serde_json::json!({"target": target, "amount": amount}),
        );
        let (c_id, o_id) = (c.id, o.id);
        g.add_node(c);
        g.add_node(o);
        wire(&mut g, c_id, o_id, "out", "signal");
        g
    }

    fn compile_move(g: &Graph, slots: &Arc<ParamSlots>) -> crate::compiler::CompiledFunction {
        Compiler::compile_with_live_inputs(
            g,
            LiveInputs {
                param_slots: Some(slots.clone()),
                ..Default::default()
            },
        )
        .expect("move compiles")
    }

    fn apply_signal(sig: &Graph, g: &Graph, slots: &Arc<ParamSlots>, audio: &AudioState, t: f64) {
        let mut f = compile_move_signal_graph(sig, g, slots).expect("signal compiles");
        let out = f(&ctx(t, audio));
        slots.apply_frame(&out.slot_deltas);
    }

    /// Additif : Scale.x base 1.0 + const 0.5 → scale effectif 1.5.
    #[test]
    fn param_slot_additive_delta() {
        let scale = fe(
            NodeType::Scale,
            "s1",
            serde_json::json!({"x": 1.0, "y": 1.0, "z": 1.0}),
        );
        let (g, _) = move_graph_with(vec![scale]);
        let slots = ParamSlots::build(&g);
        let f = compile_move(&g, &slots);
        let audio = AudioState::new();

        // Cercle rayon 1, t=0 → (1,0,0) ; Scale.x=1 → x=1.
        assert!((f(0.0, 0).x - 1.0).abs() < 1e-6);

        apply_signal(
            &const_signal("param:s1:x", 0.5, 1.0),
            &g,
            &slots,
            &audio,
            0.0,
        );
        assert!(
            (f(0.0, 0).x - 1.5).abs() < 1e-6,
            "1 + 0.5 → x=1.5, got {}",
            f(0.0, 0).x
        );
        // amount multiplie le delta : const 2.0 × amount 0.5 → +1.0 → x=2.
        apply_signal(
            &const_signal("param:s1:x", 2.0, 0.5),
            &g,
            &slots,
            &audio,
            0.0,
        );
        assert!((f(0.0, 0).x - 2.0).abs() < 1e-6);
    }

    /// Pas de stale : retirer le sink (ou un delta non-fini) ramène le
    /// param à sa base dès la frame suivante.
    #[test]
    fn param_slot_no_stale() {
        let scale = fe(
            NodeType::Scale,
            "s1",
            serde_json::json!({"x": 1.0, "y": 1.0, "z": 1.0}),
        );
        let (g, _) = move_graph_with(vec![scale]);
        let slots = ParamSlots::build(&g);
        let f = compile_move(&g, &slots);
        let audio = AudioState::new();
        let idx = slots.slot_of("s1", "x").unwrap();

        apply_signal(
            &const_signal("param:s1:x", 5.0, 1.0),
            &g,
            &slots,
            &audio,
            0.0,
        );
        assert!((f(0.0, 0).x - 6.0).abs() < 1e-6);

        // Swap vers un signal graph SANS le sink → frame suivante = base.
        apply_signal(&const_signal("yaw", 3.0, 1.0), &g, &slots, &audio, 1.0);
        assert!(
            (f(0.0, 0).x - 1.0).abs() < 1e-6,
            "no stale, got {}",
            f(0.0, 0).x
        );

        // Delta non-fini → contribue 0 cette frame (pas de hold).
        slots.apply_frame(&[(idx, f64::NAN)]);
        assert!((f(0.0, 0).x - 1.0).abs() < 1e-6);
        slots.apply_frame(&[(idx, f64::INFINITY)]);
        assert!((f(0.0, 0).x - 1.0).abs() < 1e-6);
    }

    /// Type-wide : `param:Scale:x` touche les deux nodes Scale ; une cible
    /// id-specific + type-wide se SOMMENT sur le même slot.
    #[test]
    fn param_slot_typewide_and_sum() {
        let s1 = fe(
            NodeType::Scale,
            "s1",
            serde_json::json!({"x": 1.0, "y": 1.0, "z": 1.0}),
        );
        let s2 = fe(
            NodeType::Scale,
            "s2",
            serde_json::json!({"x": 1.0, "y": 1.0, "z": 1.0}),
        );
        let (g, _) = move_graph_with(vec![s1, s2]);
        let slots = ParamSlots::build(&g);
        let f = compile_move(&g, &slots);
        let audio = AudioState::new();
        assert!((f(0.0, 0).x - 1.0).abs() < 1e-6);

        // Type-wide +0.5 sur les deux → x = 1×1.5×1.5 = 2.25.
        apply_signal(
            &const_signal("param:Scale:x", 0.5, 1.0),
            &g,
            &slots,
            &audio,
            0.0,
        );
        assert!((f(0.0, 0).x - 2.25).abs() < 1e-6, "got {}", f(0.0, 0).x);

        // id-specific 0.5 sur s1 + type-wide 0.5 → s1: 2.0, s2: 1.5 → x = 3.0.
        let mut g2 = Graph::new();
        let (c1, c2) = (
            Node::with_params(NodeType::SignalConst, serde_json::json!({"value": 0.5})),
            Node::with_params(NodeType::SignalConst, serde_json::json!({"value": 0.5})),
        );
        let (o1, o2) = (
            Node::with_params(
                NodeType::SignalOut,
                serde_json::json!({"target": "param:Scale:x", "amount": 1.0}),
            ),
            Node::with_params(
                NodeType::SignalOut,
                serde_json::json!({"target": "param:s1:x", "amount": 1.0}),
            ),
        );
        for n in [&c1, &c2, &o1, &o2] {
            g2.add_node(n.clone());
        }
        wire(&mut g2, c1.id, o1.id, "out", "signal");
        wire(&mut g2, c2.id, o2.id, "out", "signal");
        apply_signal(&g2, &g, &slots, &audio, 0.0);
        assert!(
            (f(0.0, 0).x - 3.0).abs() < 1e-6,
            "type+id sum → 3.0, got {}",
            f(0.0, 0).x
        );
    }

    /// Validation des cibles `param:` — chaque cas d'erreur + sink inerte.
    #[test]
    fn param_target_validation() {
        let scale = fe(
            NodeType::Scale,
            "s1",
            serde_json::json!({"x": 1.0, "y": 1.0, "z": 1.0}),
        );
        let (g, _) = move_graph_with(vec![scale]);
        let slots = ParamSlots::build(&g);

        let err = |target: &str| match compile_move_signal_graph(
            &const_signal(target, 1.0, 1.0),
            &g,
            &slots,
        ) {
            Err(SignalCompileError::InvalidTarget(m)) => m,
            Err(e) => panic!("target '{target}' wrong error: {e:?}"),
            Ok(_) => panic!("target '{target}' should fail"),
        };

        // Node id inconnu (et pas un type du catalogue).
        assert!(err("param:ghost:x").contains("unknown node id"));
        // Type valide mais absent du graphe.
        assert!(err("param:Helix:radius").contains("no node of type 'Helix'"));
        // Clé inconnue pour le type.
        assert!(err("param:s1:w").contains("unknown param 'w'"));
        assert!(err("param:Scale:w").contains("unknown param 'w'"));
        // Param non modulable (Objects.n_objects est structural).
        let (g2, _) = move_graph_with(vec![]);
        let slots2 = ParamSlots::build(&g2);
        match compile_move_signal_graph(&const_signal("param:o:n_objects", 1.0, 1.0), &g2, &slots2)
        {
            Err(SignalCompileError::InvalidTarget(m)) => {
                assert!(m.contains("not modulable"), "got {m}");
            }
            Err(e) => panic!("wrong error: {e:?}"),
            Ok(_) => panic!("expected InvalidTarget"),
        }
        // Cible vide → sink inerte (compile OK, aucun delta).
        let mut f = compile_move_signal_graph(&const_signal("", 7.0, 1.0), &g, &slots)
            .expect("empty target compiles");
        let audio = AudioState::new();
        let out = f(&ctx(0.0, &audio));
        assert!(out.slot_deltas.is_empty() && out.macros.is_empty());

        // Scope global : `param:` est une erreur de compile.
        match compile_signal_graph(&const_signal("param:Scale:x", 1.0, 1.0)) {
            Err(SignalCompileError::InvalidTarget(m)) => {
                assert!(m.contains("global"), "got {m}");
            }
            Err(e) => panic!("wrong error: {e:?}"),
            Ok(_) => panic!("global param: should fail"),
        }
    }

    /// Bool modulation : `enabled` de Freeze bascule le hold.
    /// (base true + delta −2 → −1 < 0.5 → disabled → passthrough).
    #[test]
    fn freeze_enabled_modulation_toggles_hold() {
        let freeze = fe(NodeType::Freeze, "fz", serde_json::json!({"enabled": true}));
        let (g, _) = move_graph_with(vec![freeze]);
        let slots = ParamSlots::build(&g);
        let f = compile_move(&g, &slots);
        let audio = AudioState::new();

        // Hold : premier eval fige la position — t ultérieur → même valeur.
        let held = f(0.25, 0);
        assert_eq!(f(0.75, 0), held, "freeze holds");

        apply_signal(
            &const_signal("param:fz:enabled", -2.0, 1.0),
            &g,
            &slots,
            &audio,
            0.0,
        );
        let p = f(0.75, 0);
        assert_ne!(p, held, "disabled → passthrough, got {p:?}");

        // Retour à enabled → hold reprend la position courante.
        apply_signal(
            &const_signal("param:fz:enabled", 0.0, 1.0),
            &g,
            &slots,
            &audio,
            1.0,
        );
        let held2 = f(0.9, 0);
        assert_eq!(f(1.1, 0), held2, "re-enabled → holds again");
    }

    /// Graphe minimal compilable pour un type de node — carriers
    /// Objects/Duration + upstreams position selon les ports du spec.
    /// Graphe minimal compilable pour un type de node — `params` injectés
    /// dans le node testé pour couvrir plusieurs régimes.
    fn graph_for_type_params(t: &NodeType, params: &serde_json::Value) -> Option<Graph> {
        let spec = crate::node_spec::node_spec(t);
        let mut g = Graph::new();
        let objects = fe(NodeType::Objects, "o", serde_json::json!({"n_objects": 4}));
        let dur = fe(
            NodeType::Duration,
            "d",
            serde_json::json!({"duration": 4.0}),
        );
        let out = fe(NodeType::Output, "out", serde_json::json!({}));
        let (o_id, d_id, out_id) = (objects.id, dur.id, out.id);
        g.add_node(objects);
        g.add_node(dur);
        g.add_node(out);

        let node = fe(t.clone(), "n1", params.clone());
        let n_id = node.id;
        g.add_node(node);

        // Ports positions requis : upstreams dédiés par port.
        let pos_names: Vec<&str> = spec
            .inputs
            .iter()
            .filter(|p| p.port_type == crate::node_spec::PortType::Positions)
            .map(|p| p.name.as_str())
            .collect();
        for port_name in pos_names {
            let radius = if port_name == "b" { 2.0 } else { 1.0 };
            // Helix : sortie 3-axes (x,y,z non nuls) — permet de détecter
            // les params sur n'importe quel axe (Scale.y, Clamp.*…).
            let up = fe(
                NodeType::Helix,
                &format!("up{port_name}"),
                serde_json::json!({"radius": radius, "height": 1.0, "turns": 2.0}),
            );
            let up_id = up.id;
            g.add_node(up);
            wire(&mut g, o_id, up_id, "objects", "objects");
            wire(&mut g, d_id, up_id, "duration", "duration");
            wire(&mut g, up_id, n_id, "out", port_name);
        }
        for p in &spec.inputs {
            match p.name.as_str() {
                "objects" => wire(&mut g, o_id, n_id, "objects", "objects"),
                "duration" => wire(&mut g, d_id, n_id, "duration", "duration"),
                "spline" => {
                    let draw = fe(
                        NodeType::DrawSpline,
                        "ds",
                        serde_json::json!({"points": "[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]"}),
                    );
                    let ds_id = draw.id;
                    g.add_node(draw);
                    wire(&mut g, o_id, ds_id, "objects", "objects");
                    wire(&mut g, d_id, ds_id, "duration", "duration");
                    wire(&mut g, ds_id, n_id, "spline", "spline");
                }
                _ => {}
            }
        }
        wire(&mut g, n_id, out_id, "out", "in");
        if crate::validator::Validator::validate(&g).is_err() {
            return None;
        }
        Some(g)
    }

    /// Catalogue : pour chaque type SubOnly/Both et chaque param modulable,
    /// un delta non-zero change la sortie — c'est ce test qui révèle les
    /// params à marquer `modulable: false` (bakés à l'init, jamais relus).
    #[test]
    fn every_modulable_param_changes_output() {
        let audio = AudioState::new();
        let _ = audio;
        let mut covered = Vec::new();
        let mut failing: Vec<String> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        for spec in all_node_specs() {
            if !matches!(spec.scope, NodeScope::SubOnly | NodeScope::Both)
                || !spec.produces_positions()
                || spec.node_type == NodeType::Plugin
            {
                continue;
            }
            let modulable: Vec<_> = spec.params.iter().filter(|p| p.modulable).collect();
            if modulable.is_empty() {
                continue;
            }
            // Plusieurs régimes — certains params ne sont observables que
            // dans un mode/champ donné (Follow.orbit_*, VectorField.*, …).
            let presets: Vec<serde_json::Value> = match spec.node_type {
                NodeType::OSCInput => vec![
                    serde_json::json!({"osc_value": [0.5, 0.4, 0.3]}),
                    serde_json::json!({}),
                ],
                NodeType::Follow => vec![
                    serde_json::json!({"mode": "follow", "speed": 2.0}),
                    serde_json::json!({"mode": "orbit", "speed": 2.0}),
                    serde_json::json!({"mode": "evade", "speed": 2.0}),
                    serde_json::json!({"mode": "arrive", "speed": 2.0}),
                ],
                NodeType::VectorField => vec![
                    serde_json::json!({"field": "noise"}),
                    serde_json::json!({"field": "vortex"}),
                    serde_json::json!({"field": "drawn", "points": [[0.0, 0.0, 0.5, 0.0], [0.5, 0.0, -0.5, 0.0]]}),
                ],
                NodeType::Avoidance => vec![serde_json::json!({"repulsion_radius": 3.0})],
                NodeType::PointDistanceFalloff => {
                    vec![serde_json::json!({"center": [0.5, 0.0, 0.0], "max_distance": 0.6})]
                }
                NodeType::AudioSpectrum => vec![
                    serde_json::json!({"spectrum_band_0": 0.8, "spectrum_band_1": 0.5}),
                    serde_json::json!({}),
                ],
                _ => vec![serde_json::json!({})],
            };
            let mut rigs = Vec::new();
            for preset in &presets {
                let Some(g) = graph_for_type_params(&spec.node_type, preset) else {
                    continue;
                };
                let slots = ParamSlots::build(&g);
                // f_base SANS slots — sinon les deux closures liraient le
                // même delta dans la table partagée.
                let f_base = Compiler::compile_with_live_inputs(&g, LiveInputs::default())
                    .expect("base compiles");
                let f_mod = compile_move(&g, &slots);
                rigs.push((slots, f_base, f_mod));
            }
            if rigs.is_empty() {
                skipped.push(format!("{:?} (no graph)", spec.node_type));
                continue;
            }
            for p in modulable {
                let mut changed = false;
                'rig: for (slots, f_base, f_mod) in &rigs {
                    let Some(idx) = slots.slot_of("n1", &p.key) else {
                        continue;
                    };
                    // Grands deltas aussi : les params à larges défauts
                    // (Clamp ±100) ne bougent pas assez avec ±5.
                    for delta in [5.0, -5.0, 200.0, -200.0] {
                        slots.apply_frame(&[(idx, delta)]);
                        for t in [0.0, 0.37, 1.0, 2.3, 3.9, 7.7, 12.0] {
                            for i in 0..3 {
                                let a = f_base(t, i);
                                let b = f_mod(t, i);
                                if (a - b).norm() > 1e-9 {
                                    changed = true;
                                    break 'rig;
                                }
                            }
                        }
                    }
                    slots.apply_frame(&[]);
                }
                if changed {
                    covered.push(format!("{:?}.{}", spec.node_type, p.key));
                } else {
                    failing.push(format!("{:?}.{}", spec.node_type, p.key));
                }
            }
        }
        eprintln!(
            "modulable params vérifiés : {} — skipped: {skipped:?}",
            covered.len()
        );
        assert!(
            failing.is_empty(),
            "params modulables sans effet live — fixer live-read ou .fixed():\n{}",
            failing.join("\n")
        );
        assert!(covered.len() > 60, "catalogue sous-couvert: {covered:?}");
    }
}
