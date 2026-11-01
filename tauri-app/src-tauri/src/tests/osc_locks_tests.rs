#[cfg(test)]
mod osc_locks_tests {
    use crate::commands::osc::{set_osc_output, set_osc_receiver_port};
    use crate::{AppState, Movement};
    use stagespace_engines::AudioState;
    use tauri::Manager;
    use stagespace_engines::osc_sender::{OscProfile, OscSender};
    use stagespace_engines::merge_runtime::MergeRuntime;
    use stagespace_engines::runtime::Runtime;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex};

    /// AppState complet minimal — même forme que lib.rs:setup().
    fn make_app_state() -> AppState {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let merge = MergeRuntime::new("127.0.0.1".to_string(), 0, sender, 60.0).unwrap();
        AppState {
            audio_state: Arc::new(Mutex::new(AudioState::new())),
            osc_receiver: Arc::new(Mutex::new(stagespace_engines::osc_receiver::OscReceiver::new(0))),
            presets: Arc::new(Mutex::new(stagespace_engines::presets::PresetManager::new())),
            app_handle: Arc::new(Mutex::new(None)),
            movements: Arc::new(Mutex::new(HashMap::new())),
            pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
            move_generation: Arc::new(AtomicU64::new(0)),
            merge_runtime: Arc::new(Mutex::new(merge)),
            psn_receiver: Arc::new(stagespace_engines::psn_receiver::PsnReceiver::new()),
            recall_in_progress: Arc::new(AtomicBool::new(false)),
            deactivate_gen: Arc::new(AtomicU64::new(0)),
            audio_capture: Arc::new(Mutex::new(
                stagespace_engines::audio_capture::AudioCaptureManager::new(),
            )),
            audio_poller_shutdown: Arc::new(AtomicBool::new(false)),
            supervisor_shutdown: Arc::new(AtomicBool::new(false)),
            plugin_registry: None,
            plugins_dir: None,
        }
    }

    /// Un Movement minimal — seule sa PRÉSENCE compte : le garde teste
    /// `movements.is_empty()`, pas son contenu.
    fn dummy_movement() -> Movement {
        Movement {
            id: "m1".to_string(),
            name: "test".to_string(),
            runtime: Runtime::new(),
            osc_ids: vec![1],
            is_preview: false,
            track_indices: vec![0],
            graph_json: stagespace_engines::GraphJson::default(),
            signal_graph: None,
            duration: 10.0,
            loop_mode: "loop".to_string(),
            direction: "forward".to_string(),
            origin: None,
            end_mode: stagespace_engines::EndMode::default(),
            anchor_mode: stagespace_engines::AnchorMode::default(),
            anchor_target: None,
            generation: 0,
        }
    }

    /// State<'_, AppState> via le mock tauri — la commande exige le type
    /// State exact, qui ne se construit pas à la main.
    fn managed_state<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::State<'_, AppState> {
        app.state::<AppState>()
    }

    /// Les verrous OSC en playback : reconfigurer IN/OUT pendant qu'un
    /// move tourne rerouterait les positions ou casserait les mappings
    /// (TOCTOU — le check frontend peut être stale, le backend doit
    /// refuser). Une régression laisserait passer un rebind destructeur.
    #[test]
    fn osc_input_port_locked_during_playback() {
        let app = tauri::test::mock_app();
        let s = make_app_state();
        s.movements
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("m1".to_string(), dummy_movement());
        app.manage(s);
        let res = tauri::async_runtime::block_on(set_osc_receiver_port(
            9001,
            managed_state(&app),
        ));
        let err = res.expect_err("le rebind OSC-IN doit être refusé pendant le playback");
        assert_eq!(err.code, "conflict");
    }

    #[test]
    fn osc_output_config_locked_during_playback() {
        let app = tauri::test::mock_app();
        let s = make_app_state();
        s.movements
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("m1".to_string(), dummy_movement());
        app.manage(s);
        let res = tauri::async_runtime::block_on(set_osc_output(
            "127.0.0.1".to_string(),
            9000,
            "generic".to_string(),
            managed_state(&app),
        ));
        let err = res.expect_err("la reconfig OSC-OUT doit être refusée pendant le playback");
        assert_eq!(err.code, "conflict");
    }
}
