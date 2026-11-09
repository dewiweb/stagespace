// Tests du recall de cue et de la projection is_playing — le chemin le
// plus dangereux du live (kill/respawn de workers, flags, zombies).
#[allow(clippy::field_reassign_with_default, clippy::uninlined_format_args)]
mod recall_tests {
    use crate::commands::cue_commands::recall_cue_inner;
    use crate::commands::merge_commands::collect_movement_infos;
    use crate::commands::state::Shared;
    use crate::Movement;
    use stagespace_engines::{
        AudioState, Cue, CueMode, MergeRuntime, OscProfile, OscReceiver, OscSender, Runtime,
        SpatialChannel,
    };
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex};

    /// Shared headless — tous les composants réels, app_handle = None.
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

    fn make_cue() -> Cue {
        Cue {
            id: "cue-1".to_string(),
            schema_version: None,
            name: "Test".to_string(),
            description: String::new(),
            graph: stagespace_engines::GraphJson::default(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.0,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        }
    }

    fn make_movement(id: &str) -> Movement {
        Movement {
            id: id.to_string(),
            name: id.to_string(),
            runtime: Runtime::new(),
            osc_ids: vec![1],
            is_preview: false,
            track_indices: vec![0],
            graph_json: stagespace_engines::GraphJson::default(),
            signal_graph: None,
            duration: 4.0,
            loop_mode: "loop".to_string(),
            direction: "forward".to_string(),
            origin: None,
            generation: 1,
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
        }
    }

    fn circular_graph() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "o", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"Objects","type":"Objects","params":{"n_objects":1}}},
                {"id": "d", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"Duration","type":"Duration","params":{"duration":4.0}}},
                {"id": "e", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"Circular","type":"Circular","params":{"radius":1.0,"n_objects":1}}},
                {"id": "out", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"Output","type":"Output","params":{}}}
            ],
            "edges": [
                {"id":"e1","source":"o","target":"e","targetHandle":"objects"},
                {"id":"e2","source":"d","target":"e","targetHandle":"duration"},
                {"id":"e3","source":"e","target":"out","targetHandle":"in"}
            ]
        })
    }

    #[test]
    fn test_recall_compiles_and_swaps_global_post_process() {
        let sh = make_shared();
        let mut cue = make_cue();
        cue.global_graph = Some(serde_json::from_value(serde_json::json!({
            "nodes": [
                {"id":"input", "type":"custom", "position":{"x":0,"y":0},
                 "data":{"label":"Merge", "type":"Merge", "params":{}}},
                {"id":"scale", "type":"custom", "position":{"x":0,"y":0},
                 "data":{"label":"RadiusScale", "type":"RadiusScale", "params":{"radius_scale":2.0}}},
                {"id":"output", "type":"custom", "position":{"x":0,"y":0},
                 "data":{"label":"Output", "type":"Output", "params":{}}}
            ],
            "edges": [
                {"id":"e1", "source":"input", "target":"scale", "sourceHandle":"out", "targetHandle":"in"},
                {"id":"e2", "source":"scale", "target":"output", "sourceHandle":"out", "targetHandle":"in"}
            ]
        })).unwrap());
        recall_cue_inner(cue, sh.clone()).unwrap();
        let samples = vec![(0.0, 1.0, 0.0, 2.0)];
        assert_eq!(
            sh.merge_runtime
                .lock()
                .unwrap()
                .apply_post_process_to_samples(samples.clone(), 0),
            vec![(0.0, 2.0, 0.0, 4.0)]
        );
        let mut invalid = make_cue();
        invalid.global_graph = Some(stagespace_engines::GraphJson::default());
        assert!(recall_cue_inner(invalid, sh.clone()).is_err());
        assert_eq!(
            sh.merge_runtime
                .lock()
                .unwrap()
                .apply_post_process_to_samples(samples, 0),
            vec![(0.0, 2.0, 0.0, 4.0)]
        );
    }

    #[test]
    fn test_recall_rejects_concurrent_and_releases_flag() {
        let sh = make_shared();
        // Flag pré-posé → rejet, et le flag appartient à l'autre recall
        // (il n'est PAS relâché par le rejet).
        sh.recall_in_progress
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let err = recall_cue_inner(make_cue(), sh.clone()).unwrap_err();
        assert_eq!(err.code, "busy");
        assert!(err.message.contains("already in progress"), "err: {err}");
        assert!(sh
            .recall_in_progress
            .load(std::sync::atomic::Ordering::SeqCst));

        // Recall normal → flag relâché par le guard à la fin.
        sh.recall_in_progress
            .store(false, std::sync::atomic::Ordering::SeqCst);
        recall_cue_inner(make_cue(), sh.clone()).expect("empty recall ok");
        assert!(!sh
            .recall_in_progress
            .load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn test_recall_deactivates_moves_not_in_cue() {
        let sh = make_shared();
        {
            let mut mv = sh.movements.lock().unwrap();
            mv.insert("ghost".to_string(), make_movement("ghost"));
        }
        let mut cue = make_cue();
        cue.active_move_ids = vec![]; // ghost n'est pas dans le cue
        recall_cue_inner(cue, sh.clone()).expect("recall");
        assert!(
            sh.movements.lock().unwrap().is_empty(),
            "un move absent du cue doit être désactivé au recall"
        );
    }

    #[test]
    fn test_recall_respawns_move_snapshot() {
        let sh = make_shared();
        // Le move snapshoté doit avoir ses osc_ids dans la liste globale —
        // sinon le merge ne route rien (validation track_indices).
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        let mut cue = make_cue();
        cue.active_move_ids = vec!["mv-a".to_string()];
        cue.moves = vec![stagespace_engines::MoveSnapshot {
            id: "mv-a".to_string(),
            name: "A".to_string(),
            graph_json: serde_json::from_value(circular_graph()).unwrap(),
            signal_graph: None,
            osc_ids: vec![7],
            track_indices: vec![0],
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: "loop".to_string(),
            direction: "forward".to_string(),
            animation_state: None,
            fade_in: 0.0,
            fade_out: 0.0,
            end_mode: None,
            anchor_mode: None,
            anchor_target: None,
        }];
        recall_cue_inner(cue, sh.clone()).expect("recall with respawn");

        let mv = sh.movements.lock().unwrap();
        assert!(
            mv.contains_key("mv-a"),
            "le move snapshoté doit être respawné"
        );
        let alive = mv["mv-a"].runtime.is_running();
        drop(mv);
        assert!(alive, "le worker respawné doit tourner");
        assert!(
            sh.merge_runtime.lock().unwrap().has_move("mv-a"),
            "le move doit être enregistré dans le merge"
        );
        // Cleanup : stop le worker pour ne pas laisser un thread tourner.
        let m = sh.movements.lock().unwrap().remove("mv-a");
        if let Some(m) = m {
            m.runtime.stop();
        }
    }

    /// Quand le cue porte des snapshots (Phase 5), `moves` est la vérité :
    /// un move running listé dans `moves` mais absent d'`active_move_ids`
    /// (race poll frontend) doit CONTINUER — pas kill-then-respawn.
    #[test]
    fn test_recall_keeps_running_move_listed_in_moves_not_in_active_ids() {
        use crate::commands::merge_commands::{
            parse_direction, parse_loop_mode, spawn_move_for_recall, MoveSpec,
        };
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_osc_ids(vec![7]);
        }
        // Spawn initial via le même chemin que le recall
        let spec = MoveSpec {
            id: "mv-live".to_string(),
            name: "Live".to_string(),
            graph_json: serde_json::from_value(circular_graph()).unwrap(),
            osc_ids: vec![7],
            track_indices: vec![0],
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: parse_loop_mode("loop"),
            direction: parse_direction("forward"),
            fade: None,
            speed: None,
            spatial_macros: None,
            animation_state: None,
            signal_graph: None,
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
        };
        spawn_move_for_recall(spec, &sh).expect("initial spawn");
        let gen_before = sh.movements.lock().unwrap()["mv-live"].generation;

        // Cue : le move est dans `moves` mais PAS dans active_move_ids.
        let mut cue = make_cue();
        cue.active_move_ids = vec![];
        cue.moves = vec![stagespace_engines::MoveSnapshot {
            id: "mv-live".to_string(),
            name: "Live".to_string(),
            graph_json: serde_json::from_value(circular_graph()).unwrap(),
            signal_graph: None,
            osc_ids: vec![7],
            track_indices: vec![0],
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: "loop".to_string(),
            direction: "forward".to_string(),
            animation_state: None,
            fade_in: 0.0,
            fade_out: 0.0,
            end_mode: None,
            anchor_mode: None,
            anchor_target: None,
        }];
        recall_cue_inner(cue, sh.clone()).expect("recall");

        let mv = sh.movements.lock().unwrap();
        let m = mv.get("mv-live").expect("move still present");
        assert_eq!(
            m.generation, gen_before,
            "le move doit continuer (même worker), pas être respawné"
        );
        assert!(m.runtime.is_running());
        drop(mv);
        let m = sh.movements.lock().unwrap().remove("mv-live");
        if let Some(m) = m {
            m.runtime.stop();
        }
    }

    fn signal_graph_json() -> serde_json::Value {
        serde_json::json!({
            "nodes": [
                {"id": "c", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"SignalConst","type":"SignalConst","params":{"value":7.0}}},
                {"id": "o", "type": "custom", "position": {"x":0,"y":0},
                 "data": {"label":"SignalOut","type":"SignalOut","params":{"target":"yaw","amount":2.0}}}
            ],
            "edges": [
                {"id":"e1","source":"c","target":"o","targetHandle":"signal"}
            ]
        })
    }

    #[test]
    fn test_recall_restores_signal_graph_and_resets_when_absent() {
        let sh = make_shared();
        // Cue porteur d'un graph signal → installé dans le merge.
        let mut cue = make_cue();
        cue.signal_graph = Some(serde_json::from_value(signal_graph_json()).unwrap());
        recall_cue_inner(cue, sh.clone()).expect("recall with signal graph");
        let deltas = sh
            .merge_runtime
            .lock()
            .unwrap()
            .eval_signal_deltas(0.0, 1.0 / 60.0);
        assert!(
            (deltas.get("yaw").copied().unwrap_or(0.0) - 14.0).abs() < 1e-9,
            "7.0 * 2.0 = 14 attendu sur yaw, got {deltas:?}"
        );

        // Cue SANS graph signal → reset : la modulation du cue précédent
        // ne doit pas survivre (deltas stales = macros qui bougent seules).
        recall_cue_inner(make_cue(), sh.clone()).expect("recall without signal graph");
        let deltas = sh
            .merge_runtime
            .lock()
            .unwrap()
            .eval_signal_deltas(0.0, 1.0 / 60.0);
        assert!(
            deltas.is_empty(),
            "un cue sans signal graph doit reset la modulation: {deltas:?}"
        );
    }

    #[test]
    fn test_is_playing_requires_worker_and_merge() {
        let sh = make_shared();
        {
            let mut mv = sh.movements.lock().unwrap();
            mv.insert("zombie".to_string(), make_movement("zombie"));
        }
        let infos = {
            let mv = sh.movements.lock().unwrap();
            let mr = sh.merge_runtime.lock().unwrap();
            collect_movement_infos(&mv, &mr)
        };
        // Worker jamais démarré (is_running=false) ET pas dans le merge →
        // is_playing false — un stale-killé ne doit jamais s'afficher "playing".
        assert_eq!(infos.len(), 1);
        assert!(!infos[0].is_playing);
    }

    #[test]
    fn test_tracking_recall_merges_channels_and_keeps_out_of_scope() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_object_channel(0, SpatialChannel::Gain, 0.5);
            mr.set_object_channel(1, SpatialChannel::Spread, 0.3);
        }
        let mut cue = make_cue();
        cue.mode = CueMode::Tracking;
        cue.track_indices = vec![1];
        let mut chs = stagespace_engines::SpatialChannels::default();
        chs.gain = Some(0.8);
        cue.object_channels = Some(HashMap::from([(1usize, chs)]));
        recall_cue_inner(cue, sh.clone()).expect("tracking recall");
        let mr = sh.merge_runtime.lock().unwrap();
        let all = mr.object_channels();
        assert_eq!(
            all.get(&0).and_then(|c| c.gain),
            Some(0.5),
            "un canal hors scope garde sa valeur"
        );
        let c1 = all.get(&1).copied().unwrap_or_default();
        assert_eq!(c1.gain, Some(0.8), "le canal du scope est écrit");
        assert_eq!(
            c1.spread,
            Some(0.3),
            "merge par canal — l'existant du même objet est conservé"
        );
    }

    #[test]
    fn test_tracking_recall_merges_depths_by_index() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_track_depths(vec![1.0, 1.0, 1.0]);
        }
        let mut cue = make_cue();
        cue.mode = CueMode::Tracking;
        cue.track_indices = vec![1];
        // Vec positionnel aligné sur la liste globale des tracks — seul
        // l'index 1 (scope) doit être appliqué.
        cue.per_track_depths = vec![0.5, 0.2, 0.9];
        recall_cue_inner(cue, sh.clone()).expect("tracking recall");
        let mr = sh.merge_runtime.lock().unwrap();
        assert_eq!(mr.track_depths(), vec![1.0, 0.2, 1.0]);
    }

    #[test]
    fn test_parked_object_survives_full_and_tracking_recall() {
        let sh = make_shared();
        {
            let mr = sh.merge_runtime.lock().unwrap();
            // L'opérateur a repris object 1 à la main → on le parke.
            mr.set_object_channel(1, SpatialChannel::Gain, 0.9);
            mr.park_object(1);
        }
        let mut chs = stagespace_engines::SpatialChannels::default();
        chs.gain = Some(-3.0);
        // Full : clear+set d'un cue qui voudrait écrire object 1 → le
        // canal parké est préservé à travers le clear.
        let mut cue = make_cue();
        cue.object_channels = Some(HashMap::from([(1usize, chs)]));
        recall_cue_inner(cue, sh.clone()).expect("full recall");
        {
            let mr = sh.merge_runtime.lock().unwrap();
            assert_eq!(
                mr.object_channels().get(&1).and_then(|c| c.gain),
                Some(0.9),
                "un objet parké n'est jamais écrit par une cue Full"
            );
        }
        // Tracking : idem — l'objet parké est sauté du merge.
        let mut cue = make_cue();
        cue.mode = CueMode::Tracking;
        cue.object_channels = Some(HashMap::from([(1usize, chs)]));
        recall_cue_inner(cue, sh.clone()).expect("tracking recall");
        {
            let mr = sh.merge_runtime.lock().unwrap();
            assert_eq!(
                mr.object_channels().get(&1).and_then(|c| c.gain),
                Some(0.9),
                "un objet parké est sauté du merge Tracking"
            );
            mr.unpark_object(1);
            mr.clear_parked();
        }
    }

    #[test]
    fn test_tracking_recall_does_not_stop_unlisted_moves() {
        let sh = make_shared();
        {
            let mut mv = sh.movements.lock().unwrap();
            mv.insert("ghost".to_string(), make_movement("ghost"));
        }
        let mut cue = make_cue();
        cue.mode = CueMode::Tracking;
        recall_cue_inner(cue, sh.clone()).expect("tracking recall");
        assert!(
            sh.movements.lock().unwrap().contains_key("ghost"),
            "un cue Tracking ne touche pas aux moves non listés"
        );
    }
}
