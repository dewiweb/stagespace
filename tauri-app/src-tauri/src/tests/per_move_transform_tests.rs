// Tests de la transform per-move (0.8.0) — le worker applique scale/shift/
// rotation en espace local, seedées au spawn via SpatialMacroInit.
#[allow(clippy::uninlined_format_args)]
mod per_move_transform_tests {
    use crate::commands::merge_commands::{spawn_move_for_recall, MoveSpec, SpatialMacroInit};
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

    /// Objects + Duration → Circular(radius 1) → Output — cercle de rayon 1.
    fn circle_graph_json() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "o", "type": "custom", "position": {"x":0.0,"y":0.0},
                 "data": {"type": "Objects", "params": {"n_objects": 1}}},
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

    fn spec_with_spatial(id: &str, spatial: Option<SpatialMacroInit>) -> MoveSpec {
        MoveSpec {
            id: id.to_string(),
            name: id.to_string(),
            graph_json: serde_json::from_value(circle_graph_json()).unwrap(),
            osc_ids: vec![7],
            track_indices: vec![0],
            is_preview: false,
            origin: Some([0.0, 0.0, 0.0]),
            duration: 4.0,
            loop_mode: stagespace_engines::LoopMode::Loop,
            direction: stagespace_engines::PlayDirection::Forward,
            fade: None,
            speed: None,
            spatial_macros: spatial,
            animation_state: None,
            signal_graph: None,
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
            anchor_pose: None,
            clear_manual_positions: false,
        }
    }

    /// Scale per-move : un move seedé scale=2 émet un cercle de rayon 2
    /// (espace local — avant toute transform globale du merge).
    #[test]
    fn per_move_scale_applies_in_worker() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        spawn_move_for_recall(
            spec_with_spatial(
                "mv-scaled",
                Some(SpatialMacroInit {
                    scale: 2.0,
                    shift: (0.0, 0.0, 0.0),
                    rotation: (0.0, 0.0, 0.0),
                }),
            ),
            &sh,
        )
        .expect("spawn scaled");

        std::thread::sleep(std::time::Duration::from_millis(120));
        let movements = sh.movements.lock().unwrap();
        let m = movements.get("mv-scaled").unwrap();
        let buf = m.runtime.position_buffer_arc().expect("buffer");
        let p = buf.read()[0].1;
        let r = (p.x * p.x + p.z * p.z).sqrt();
        assert!(
            (r - 2.0).abs() < 0.25,
            "scale per-move ×2 → rayon 2.0, got {r} (pos={p:?})"
        );
    }

    /// Shift per-move : translation en espace monde — le cercle est centré
    /// sur le shift (le rayon autour du centre reste nominal).
    #[test]
    fn per_move_shift_repositions_in_world() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        spawn_move_for_recall(
            spec_with_spatial(
                "mv-shifted",
                Some(SpatialMacroInit {
                    scale: 1.0,
                    shift: (5.0, 0.0, 0.0),
                    rotation: (0.0, 0.0, 0.0),
                }),
            ),
            &sh,
        )
        .expect("spawn shifted");

        std::thread::sleep(std::time::Duration::from_millis(120));
        let movements = sh.movements.lock().unwrap();
        let m = movements.get("mv-shifted").unwrap();
        let buf = m.runtime.position_buffer_arc().expect("buffer");
        let p = buf.read()[0].1;
        // Cercle rayon 1 centré en x=5 → x ∈ [4, 6].
        assert!(
            p.x > 3.5,
            "shift per-move +5x → positions autour de x=5, got x={} (pos={p:?})",
            p.x
        );
    }

    /// Sans seeding (transform neutre) : le cercle reste rayon 1 centré
    /// en 0 — le comportement par défaut est inchangé.
    #[test]
    fn neutral_transform_is_unchanged() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        spawn_move_for_recall(spec_with_spatial("mv-neutral", None), &sh).expect("spawn neutral");

        std::thread::sleep(std::time::Duration::from_millis(120));
        let movements = sh.movements.lock().unwrap();
        let m = movements.get("mv-neutral").unwrap();
        let buf = m.runtime.position_buffer_arc().expect("buffer");
        let p = buf.read()[0].1;
        let r = (p.x * p.x + p.z * p.z).sqrt();
        assert!(
            (r - 1.0).abs() < 0.2,
            "pas de seeding → rayon nominal 1.0, got {r} (pos={p:?})"
        );
    }
}
