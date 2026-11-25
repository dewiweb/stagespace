// Tests des poses — capture/snap/fallbacks (P1, design :
// docs/position-presets-design.md). Logique pure sur Shared headless.
#[allow(clippy::uninlined_format_args)]
mod pose_tests {
    use crate::commands::poses::{capture_pose, goto_pose, poseramp_graph_json, snap_pose};
    use crate::commands::state::Shared;
    use stagespace_engines::{AudioState, MergeRuntime, OscProfile, OscReceiver, OscSender, Pose};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex};

    fn make_shared() -> Shared {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let merge =
            MergeRuntime::new("127.0.0.1".to_string(), 0, sender, 60.0).expect("MergeRuntime bind");
        merge.set_osc_ids(vec![1, 2, 3, 4]);
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

    #[test]
    fn capture_uses_manual_positions_via_last_position() {
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            // track 1 = obj 0, track 3 = obj 2
            merge.set_manual_position(0, [2.0, 1.5, 0.0]);
            merge.set_manual_position(2, [-2.5, 2.0, 0.5]);
        }
        let pose = capture_pose(&sh, "line".to_string(), Some(vec![1, 3])).expect("capture");
        assert_eq!(pose.positions.get(&1), Some(&[2.0, 1.5, 0.0]));
        assert_eq!(pose.positions.get(&3), Some(&[-2.5, 2.0, 0.5]));
        assert_eq!(pose.positions.len(), 2);
    }

    #[test]
    fn capture_falls_back_to_trackpos() {
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            // Pas de position manuelle — mais une origine trackpos sur la track 2.
            merge.set_track_position(2, [0.0, -3.0, 0.0]);
        }
        let pose = capture_pose(&sh, "base".to_string(), Some(vec![2])).expect("capture");
        assert_eq!(pose.positions.get(&2), Some(&[0.0, -3.0, 0.0]));
    }

    #[test]
    fn capture_skips_unknown_positions_and_unpatched() {
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            merge.set_manual_position(0, [1.0, 0.0, 0.0]);
        }
        // track 1 : position connue · track 2 : rien de connu · track 99 : non patchée
        let pose = capture_pose(&sh, "partial".to_string(), Some(vec![1, 2, 99])).expect("capture");
        assert_eq!(pose.positions.len(), 1);
        assert!(pose.positions.contains_key(&1));
    }

    #[test]
    fn capture_errors_when_nothing_known() {
        let sh = make_shared();
        let result = capture_pose(&sh, "void".to_string(), Some(vec![2, 3]));
        assert!(result.is_err(), "rien de capturable → erreur explicite");
    }

    #[test]
    fn snap_writes_manual_positions_for_patched_tracks() {
        let sh = make_shared();
        let mut positions = HashMap::new();
        positions.insert(1u32, [2.0, 1.5, 0.0]);
        positions.insert(3u32, [-2.5, 2.0, 0.0]);
        positions.insert(99u32, [9.0, 9.0, 9.0]); // non patchée — ignorée
        let pose = Pose {
            name: "p".to_string(),
            positions,
        };
        let applied = snap_pose(&sh, &pose).expect("snap");
        assert_eq!(applied, 2);
        let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
        let manuals = merge.manual_positions();
        assert_eq!(manuals.get(&0), Some(&[2.0, 1.5, 0.0])); // track 1 → obj 0
        assert_eq!(manuals.get(&2), Some(&[-2.5, 2.0, 0.0])); // track 3 → obj 2
        assert!(!manuals.values().any(|p| *p == [9.0, 9.0, 9.0]));
    }

    #[test]
    fn snap_errors_when_no_track_patched() {
        let sh = make_shared();
        let mut positions = HashMap::new();
        positions.insert(99u32, [1.0, 1.0, 1.0]);
        let pose = Pose {
            name: "ghost".to_string(),
            positions,
        };
        assert!(snap_pose(&sh, &pose).is_err());
    }

    #[test]
    fn snap_after_remapping_follows_current_mapping() {
        // Règle namespace : les poses sont track_id-keyed — après un
        // remapping osc_ids, la conversion obj suit le mapping COURANT.
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            // Remapping : track 1 passe en obj 2 (liste réordonnée).
            merge.set_osc_ids(vec![2, 3, 1, 4]);
        }
        let mut positions = HashMap::new();
        positions.insert(1u32, [5.0, 5.0, 5.0]);
        let pose = Pose {
            name: "p".to_string(),
            positions,
        };
        snap_pose(&sh, &pose).expect("snap");
        let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
        let manuals = merge.manual_positions();
        assert_eq!(
            manuals.get(&2),
            Some(&[5.0, 5.0, 5.0]),
            "track 1 → obj 2 après remapping"
        );
        assert!(!manuals.contains_key(&0));
    }

    #[test]
    fn poseramp_graph_is_standard_and_referential() {
        // Le graphe généré est le graphe standard Objects→PoseRamp→Output,
        // référentiel (from: live, to: pose:<name>) — aucune position
        // cuite, résolution au compile (design §5).
        let g = poseramp_graph_json(3, "line-up", 2.0, "smooth");
        assert_eq!(g.nodes.len(), 4);
        let ramp = g
            .nodes
            .iter()
            .find(|n| n.id == "ramp-1")
            .expect("ramp node");
        assert_eq!(ramp.data.node_type.as_deref(), Some("PoseRamp"));
        assert_eq!(ramp.data.params["from"], serde_json::json!("live"));
        assert_eq!(ramp.data.params["to"], serde_json::json!("pose:line-up"));
        assert_eq!(ramp.data.params["easing"], serde_json::json!("smooth"));
        // pas de positions cuitées dans le graphe
        assert!(ramp.data.params.get("resolved_from").is_none());
        assert!(ramp.data.params.get("resolved_to").is_none());
    }

    #[test]
    fn goto_spawns_move_and_clears_manuals() {
        // Capture-then-clear (design §6.9) : la rampe capture le from
        // PUIS efface les manuels des objets membres — continuité à t=0.
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            merge.set_manual_position(0, [4.0, 4.0, 0.0]);
        }
        let mut positions = HashMap::new();
        positions.insert(1u32, [0.0, 3.0, 0.0]);
        positions.insert(2u32, [0.0, -3.0, 0.0]);
        let pose = Pose {
            name: "target".to_string(),
            positions,
        };
        sh.poses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("target".to_string(), pose);

        let res = goto_pose(&sh, "target", Some(2.0), None).expect("goto");
        assert_eq!(res.objects, 2);
        assert!(res.skipped.is_empty());

        // move spawné avec les bonnes sémantiques
        let movements = sh.movements.lock().unwrap_or_else(|e| e.into_inner());
        let mv = movements.get(&res.movement_id).expect("movement spawned");
        assert_eq!(mv.loop_mode, "oneshot");
        assert_eq!(mv.end_mode, stagespace_engines::EndMode::Hold);
        assert_eq!(mv.osc_ids, vec![1, 2]);
        assert_eq!(
            mv.origin,
            Some([0.0, 0.0, 0.0]),
            "positions canoniques absolues"
        );
        drop(movements);

        // capture-then-clear : le manuel de l'objet membre est effacé
        let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
        assert!(
            merge.manual_positions().is_empty(),
            "manuel membre effacé au spawn"
        );
    }

    #[test]
    fn goto_prefilters_unpatched_tracks() {
        let sh = make_shared();
        let mut positions = HashMap::new();
        positions.insert(1u32, [1.0, 1.0, 0.0]);
        positions.insert(99u32, [2.0, 2.0, 0.0]); // non patchée
        let pose = Pose {
            name: "partial".to_string(),
            positions,
        };
        sh.poses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("partial".to_string(), pose);

        let res = goto_pose(&sh, "partial", Some(1.0), None).expect("goto");
        assert_eq!(res.objects, 1, "seule la track patchée participe");
        assert_eq!(res.skipped, vec![99]);
        let movements = sh.movements.lock().unwrap_or_else(|e| e.into_inner());
        let mv = movements.get(&res.movement_id).unwrap();
        assert_eq!(mv.osc_ids, vec![1]);
    }

    #[test]
    fn goto_excludes_parked_objects() {
        let sh = make_shared();
        {
            let merge = sh.merge_runtime.lock().unwrap_or_else(|e| e.into_inner());
            merge.park_object(0); // track 1 parkée
        }
        let mut positions = HashMap::new();
        positions.insert(1u32, [1.0, 1.0, 0.0]);
        positions.insert(2u32, [2.0, 2.0, 0.0]);
        let pose = Pose {
            name: "t".to_string(),
            positions,
        };
        sh.poses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("t".to_string(), pose);

        let res = goto_pose(&sh, "t", Some(1.0), None).expect("goto");
        assert_eq!(
            res.skipped,
            vec![1],
            "parkée = exclue (la priorité tranche)"
        );
        assert_eq!(res.objects, 1);
    }

    #[test]
    fn goto_errors_unknown_pose() {
        let sh = make_shared();
        assert!(goto_pose(&sh, "ghost", None, None).is_err());
    }

    #[test]
    fn goto_errors_empty_pose() {
        let sh = make_shared();
        sh.poses.lock().unwrap_or_else(|e| e.into_inner()).insert(
            "empty".to_string(),
            Pose {
                name: "empty".to_string(),
                positions: HashMap::new(),
            },
        );
        assert!(goto_pose(&sh, "empty", None, None).is_err());
    }

    #[test]
    fn goto_errors_all_unpatchable() {
        let sh = make_shared();
        let mut positions = HashMap::new();
        positions.insert(99u32, [1.0, 1.0, 0.0]);
        let pose = Pose {
            name: "ghosts".to_string(),
            positions,
        };
        sh.poses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("ghosts".to_string(), pose);
        assert!(
            goto_pose(&sh, "ghosts", None, None).is_err(),
            "aucune track mobile → erreur, aucune mutation"
        );
    }

    #[test]
    fn goto_validates_duration() {
        let sh = make_shared();
        let mut positions = HashMap::new();
        positions.insert(1u32, [1.0, 1.0, 0.0]);
        let pose = Pose {
            name: "t".to_string(),
            positions,
        };
        sh.poses
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("t".to_string(), pose);
        assert!(goto_pose(&sh, "t", Some(0.0), None).is_err());
        assert!(goto_pose(&sh, "t", Some(-5.0), None).is_err());
        assert!(goto_pose(&sh, "t", Some(f64::NAN), None).is_err());
    }
}
