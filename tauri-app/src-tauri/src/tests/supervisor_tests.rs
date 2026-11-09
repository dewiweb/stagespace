// Tests du superviseur backend (audits C5/C7) :
// - drain_stale_kills : un worker zombie est réellement stoppé et retiré
//   de `movements` ; un id réutilisé (buffer différent) n'est PAS tué.
// - supervise_merge : un merge mort avec moves actifs est redémarré sans
//   aucun appel frontend ; un merge arrêté sans moves n'est pas relancé.
#[allow(clippy::uninlined_format_args)]
mod supervisor_tests {
    use crate::commands::state::Shared;
    use crate::supervisor;
    use crate::Movement;
    use stagespace_engines::position_buffer::PositionBuffer;
    use stagespace_engines::runtime::Runtime;
    use stagespace_engines::{AudioState, MergeRuntime, OscProfile, OscReceiver, OscSender};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

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

    fn make_movement(
        id: &str,
        audio: &Arc<Mutex<AudioState>>,
        buffer: &Arc<PositionBuffer>,
    ) -> Movement {
        let runtime = Runtime::new_with_audio_state(audio.clone());
        runtime.set_position_buffer(buffer.clone());
        Movement {
            id: id.to_string(),
            name: id.to_string(),
            runtime,
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

    #[test]
    fn test_stale_kill_stops_and_removes_worker() {
        let sh = make_shared();
        let buffer = Arc::new(PositionBuffer::new());
        let mv = make_movement("m-zombie", &sh.audio_state, &buffer);
        sh.movements
            .lock()
            .unwrap()
            .insert("m-zombie".to_string(), mv);
        sh.pending_move_ids
            .lock()
            .unwrap()
            .insert("m-zombie".to_string());

        // Le merge publie le stale-kill (id + Arc du buffer observé gelé).
        sh.merge_runtime
            .lock()
            .unwrap()
            .enqueue_stale_kill("m-zombie".to_string(), buffer.clone());

        supervisor::drain_stale_kills(&sh);

        assert!(
            !sh.movements.lock().unwrap().contains_key("m-zombie"),
            "le worker stale doit être retiré de movements"
        );
        assert!(
            sh.pending_move_ids.lock().unwrap().is_empty(),
            "l'id doit être purgé de pending_move_ids"
        );
        // File vidée par le drain
        assert!(sh
            .merge_runtime
            .lock()
            .unwrap()
            .drain_stale_kills()
            .is_empty());
    }

    #[test]
    fn test_stale_kill_does_not_kill_reused_id() {
        let sh = make_shared();
        // Move plus récent sous le même id — buffer DIFFÉRENT de celui
        // que le merge a observé gelé → le superviseur ne doit pas tuer.
        let old_buffer = Arc::new(PositionBuffer::new());
        let new_buffer = Arc::new(PositionBuffer::new());
        let mv = make_movement("m-reused", &sh.audio_state, &new_buffer);
        sh.movements
            .lock()
            .unwrap()
            .insert("m-reused".to_string(), mv);

        sh.merge_runtime
            .lock()
            .unwrap()
            .enqueue_stale_kill("m-reused".to_string(), old_buffer);

        supervisor::drain_stale_kills(&sh);

        assert!(
            sh.movements.lock().unwrap().contains_key("m-reused"),
            "un id réutilisé par un move plus récent ne doit pas être tué"
        );
    }

    #[test]
    fn test_supervise_merge_restarts_dead_thread() {
        let sh = make_shared();
        {
            let mut merge = sh.merge_runtime.lock().unwrap();
            let buffer = Arc::new(PositionBuffer::new());
            merge.register_move(
                "m1".to_string(),
                buffer,
                vec![1],
                vec![0],
                false,
                stagespace_engines::EndMode::default(),
            );
            merge.start().expect("start");
            merge.stop(); // thread mort, move encore actif dans le merge
            assert!(!merge.is_running());
            assert!(merge.has_active_moves());
        }

        let mut last_restart = Instant::now() - Duration::from_secs(10);
        supervisor::supervise_merge(&sh, &mut last_restart);

        let merge = sh.merge_runtime.lock().unwrap();
        assert!(
            merge.is_running(),
            "le watchdog doit relancer un merge mort avec moves actifs"
        );
    }

    #[test]
    fn test_supervise_merge_no_restart_without_active_moves() {
        let sh = make_shared();
        {
            let mut merge = sh.merge_runtime.lock().unwrap();
            merge.start().expect("start");
            merge.stop();
            assert!(!merge.has_active_moves());
        }
        let mut last_restart = Instant::now() - Duration::from_secs(10);
        supervisor::supervise_merge(&sh, &mut last_restart);
        assert!(
            !sh.merge_runtime.lock().unwrap().is_running(),
            "sans moves actifs, le watchdog ne relance pas le merge"
        );
    }
}
