// Guards des chemins LIVE pour les engines à état — backward/ping-pong/
// phase spread re-simulent depuis t=0 à chaque eval → worker gelé →
// stale-kill. Le guard existait au spawn ; il doit aussi tenir sur
// set_move_playback_mode, update_animation_state et le hot-swap de graphe.
#[allow(clippy::uninlined_format_args)]
mod stateful_guard_tests {
    use crate::commands::merge_commands::{
        check_stateful_playback, graph_json_has_stateful, spawn_move_for_recall, MoveSpec,
    };
    use crate::commands::state::Shared;
    use stagespace_engines::{
        AudioState, MergeRuntime, OscProfile, OscReceiver, OscSender, PlayDirection,
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
            event_sink: Arc::new(Mutex::new(None)),
            movements: Arc::new(Mutex::new(HashMap::new())),
            poses: Arc::new(Mutex::new(HashMap::new())),
            pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
            move_generation: Arc::new(AtomicU64::new(0)),
            merge_runtime: Arc::new(Mutex::new(merge)),
            recall_in_progress: Arc::new(AtomicBool::new(false)),
            deactivate_gen: Arc::new(AtomicU64::new(0)),
            score_timeline: Arc::new(Mutex::new(Default::default())),
            osc_out_target: Arc::new(Mutex::new(("127.0.0.1".to_string(), 8000))),
            osc_receiver: Arc::new(Mutex::new(OscReceiver::new(0))),
            plugin_registry: None,
            plugins_dir: None,
        }
    }

    fn swarm_graph_json() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "o", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Objects", "params": {"n_objects": 4}}},
                {"id": "d", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Duration", "params": {"duration": 4.0}}},
                {"id": "sw", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Swarm", "params": {}}},
                {"id": "out", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Output", "params": {}}},
            ],
            "edges": [
                {"id":"e1","source":"o","target":"sw","sourceHandle":"objects","targetHandle":"objects"},
                {"id":"e2","source":"d","target":"sw","sourceHandle":"duration","targetHandle":"duration"},
                {"id":"e3","source":"sw","target":"out","sourceHandle":"out","targetHandle":"in"},
            ]
        })
    }

    fn circular_graph_json() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "o", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Objects", "params": {"n_objects": 2}}},
                {"id": "d", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Duration", "params": {"duration": 4.0}}},
                {"id": "c", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Circular", "params": {"radius": 1.0}}},
                {"id": "out", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Output", "params": {}}},
            ],
            "edges": [
                {"id":"e1","source":"o","target":"c","sourceHandle":"objects","targetHandle":"objects"},
                {"id":"e2","source":"d","target":"c","sourceHandle":"duration","targetHandle":"duration"},
                {"id":"e3","source":"c","target":"out","sourceHandle":"out","targetHandle":"in"},
            ]
        })
    }

    #[test]
    fn graph_json_has_stateful_detects_engine_nodes() {
        let sw: stagespace_engines::GraphJson = serde_json::from_value(swarm_graph_json()).unwrap();
        let circ: stagespace_engines::GraphJson =
            serde_json::from_value(circular_graph_json()).unwrap();
        assert!(graph_json_has_stateful(&sw), "Swarm est stateful");
        assert!(!graph_json_has_stateful(&circ), "Circular ne l'est pas");
    }

    #[test]
    fn check_stateful_playback_rejects_backward_and_phase() {
        let sw: stagespace_engines::GraphJson = serde_json::from_value(swarm_graph_json()).unwrap();
        let circ: stagespace_engines::GraphJson =
            serde_json::from_value(circular_graph_json()).unwrap();

        // Stateful : backward et phase spread refusés, forward ok.
        let err = check_stateful_playback(&sw, false, false).unwrap_err();
        assert!(
            format!("{err}").contains("cannot run backward, ping-pong or with phase spread"),
            "message attendu, got {err}"
        );
        assert!(
            check_stateful_playback(&sw, true, true).is_err(),
            "phase ≠0 → refus"
        );
        assert!(
            check_stateful_playback(&sw, true, false).is_ok(),
            "forward sans phase → ok"
        );

        // Non-stateful : tout passe — backward/ping-pong sont des fonctions
        // pures de t pour les trajectoires classiques.
        assert!(check_stateful_playback(&circ, false, false).is_ok());
        assert!(check_stateful_playback(&circ, false, true).is_ok());
    }

    fn spec(id: &str, direction: PlayDirection) -> MoveSpec {
        MoveSpec {
            id: id.to_string(),
            name: "Swarm".to_string(),
            graph_json: serde_json::from_value(swarm_graph_json()).unwrap(),
            osc_ids: vec![7, 8, 9, 10],
            track_indices: vec![0, 1, 2, 3],
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: stagespace_engines::LoopMode::Loop,
            direction,
            fade: None,
            speed: None,
            spatial_macros: None,
            animation_state: None,
            signal_graph: None,
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
            anchor_pose: None,
            clear_manual_positions: false,
        }
    }

    #[test]
    fn spawn_rejects_backward_on_stateful_graph() {
        // Le guard spawn (existant) — régression : il doit continuer de
        // rejeter un spawn swarm+backward avec le même message, et laisser
        // passer le même graphe en forward.
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7, 8, 9, 10]);
        }
        let err =
            spawn_move_for_recall(spec("mv-stateful", PlayDirection::Backward), &sh).unwrap_err();
        assert!(
            format!("{err}").contains("cannot run backward, ping-pong or with phase spread"),
            "spawn stateful+backward doit être refusé, got {err}"
        );
        assert!(
            spawn_move_for_recall(spec("mv-stateful-ok", PlayDirection::Forward), &sh).is_ok(),
            "forward doit passer"
        );
    }
}
