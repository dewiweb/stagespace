// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use stagespace_engines::{
    init_logging, AudioCaptureManager, AudioState, MergeRuntime, OscReceiver, OscSender,
    PresetManager, Runtime,
};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

mod commands;
pub mod graph;
use commands::animation::{launch_animation, update_animation_state};
use commands::audio::{
    get_audio_state, list_audio_devices, start_audio_capture, start_audio_poller,
    stop_audio_capture, update_audio_state,
};
use commands::cue_commands::{delete_cue, list_cues, recall_cue, store_cue};
use commands::file_io::{import_hol_project, load_graph_from_file, save_graph_to_file};
use commands::merge_commands::{
    activate_move, clear_all_manual_positions, clear_all_spatial_channels,
    clear_manual_position, clear_spatial_channel, deactivate_all_moves, deactivate_move,
    get_merge_perf_stats, list_active_moves, set_global_macro, set_global_origin,
    set_global_osc_ids, set_manual_position, set_merge_strategy, set_move_playback_mode,
    set_move_speed, set_spatial_channel, set_track_depths, set_track_positions,
    update_global_graph, update_move_graph_merged,
};
use commands::network::discover_osc_targets;
use commands::osc::{
    get_osc_receiver_port, osc_add_mapping, osc_get_all_values, osc_get_value, osc_list_mappings,
    osc_remove_mapping, send_osc_position, set_osc_output, set_osc_receiver_port,
};
use commands::overrides::{clear_all_overrides, set_object_override};
use commands::playback::{play_graph, preview_graph, set_macro, stop_graph, update_graph};
use commands::presets::{preset_delete, preset_list, preset_load, preset_save};
use commands::sampling::{
    frontend_log, get_perf_stats, sample_movement_trajectory, sample_trajectory,
};
use commands::state::lock_or_recover;
use graph::parser::build_graph_from_json;

// État global de l'application
pub struct AppState {
    pub runtime: Mutex<Option<Runtime>>,
    pub audio_state: Arc<Mutex<AudioState>>,
    pub osc_receiver: Arc<Mutex<OscReceiver>>,
    pub osc_sender: Arc<Mutex<OscSender>>,
    /// Osc IDs actuels (pour hot-swap)
    pub current_osc_ids: Mutex<Vec<u32>>,
    pub presets: Arc<Mutex<PresetManager>>,
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    /// Multi-movement: plusieurs runtimes parallèles indépendants (workers)
    pub movements: Arc<Mutex<HashMap<String, Movement>>>,
    /// MergeRuntime global — merge les positions de tous les workers,
    /// applique les macros spatiales, envoie l'OSC (une seule socket)
    pub merge_runtime: Arc<Mutex<MergeRuntime>>,
    /// Flag anti-recall concurrent — empêche deux cue recalls simultanés
    pub recall_in_progress: Arc<std::sync::atomic::AtomicBool>,
    /// Capture audio via cpal (remplace getUserMedia de la WebView)
    pub audio_capture: Arc<Mutex<AudioCaptureManager>>,
    /// Flag pour arrêter le poller audio proprement à la fermeture
    pub audio_poller_shutdown: Arc<AtomicBool>,
}

/// Un movement = un runtime indépendant avec ses propres tracks et mode (preview/live)
pub struct Movement {
    pub id: String,
    pub name: String,
    pub runtime: Runtime,
    pub osc_ids: Vec<u32>,
    pub is_preview: bool,
    pub track_indices: Vec<usize>, // indices des tracks dans le .hol
}

/// Limite de movements simultanés pour éviter l'épuisement des ressources
pub const MAX_MOVEMENTS: usize = 32;

#[derive(Serialize)]
pub struct MovementInfo {
    pub id: String,
    pub name: String,
    pub osc_ids: Vec<u32>,
    pub is_preview: bool,
    pub is_playing: bool,
    pub track_count: usize,
    pub fps: f64,
    pub osc_rate: f64,
    pub latency_ms: f64,
    pub cpu_percent: f64,
}

// Graph Compilation
#[tauri::command]
async fn compile_graph(
    graph_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let audio_state = state.audio_state.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] audio_state mutex poisoned, recovering: {e}");
        e.into_inner()
    });
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    match graph::compilation::compile_graph(&graph) {
        Ok(_) => Ok("Graph compiled successfully".to_string()),
        Err(e) => Err(e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage({
            let osc_sender = OscSender::default();
            // Ne pas panic si le port 8000 est pris — mode dégradé
            let merge_rt =
                match MergeRuntime::new("127.0.0.1".to_string(), 8000, osc_sender.clone(), 60.0) {
                    Ok(rt) => rt,
                    Err(e) => {
                        eprintln!(
                            "[WARN] MergeRuntime failed to bind port 8000: {e}. \
                             Trying port 8002 as fallback..."
                        );
                        match MergeRuntime::new(
                            "127.0.0.1".to_string(),
                            8002,
                            osc_sender.clone(),
                            60.0,
                        ) {
                            Ok(rt) => rt,
                            Err(e2) => {
                                eprintln!(
                                    "[ERROR] MergeRuntime failed on both ports: {e}, {e2}. \
                                     Starting with a disabled merge runtime."
                                );
                                // Dernier recours : port 0 (OS assigne un port aléatoire)
                                MergeRuntime::new(
                                    "127.0.0.1".to_string(),
                                    0,
                                    osc_sender.clone(),
                                    60.0,
                                )
                                .expect("MergeRuntime must start on port 0")
                            }
                        }
                    }
                };
            AppState {
                runtime: Mutex::new(None),
                audio_state: Arc::new(Mutex::new(AudioState::new())),
                osc_receiver: Arc::new(Mutex::new(OscReceiver::new(8001))),
                osc_sender: Arc::new(Mutex::new(osc_sender)),
                current_osc_ids: Mutex::new(Vec::new()),
                presets: Arc::new(Mutex::new(PresetManager::new())),
                app_handle: Arc::new(Mutex::new(None)),
                movements: Arc::new(Mutex::new(HashMap::new())),
                merge_runtime: Arc::new(Mutex::new(merge_rt)),
                recall_in_progress: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                audio_capture: Arc::new(Mutex::new(AudioCaptureManager::new())),
                audio_poller_shutdown: Arc::new(AtomicBool::new(false)),
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. } = event
            {
                // Stopper tous les movements proprement à la fermeture
                let state: State<AppState> = window.state();
                let drained: Vec<Movement> = {
                    let mut movements = state.movements.lock().unwrap_or_else(|e| e.into_inner());
                    movements.drain().map(|(_, m)| m).collect()
                };
                for movement in drained {
                    movement.runtime.stop(); // stop() join le thread proprement
                }
                // Stopper aussi le runtime legacy
                if let Some(runtime) = state
                    .runtime
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take()
                {
                    runtime.stop();
                }
                // Stopper le MergeRuntime
                state
                    .merge_runtime
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .stop();
                // Stopper le receiver OSC
                state
                    .osc_receiver
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .stop();
                // Stopper la capture audio (libère le microphone)
                {
                    let capture = lock_or_recover(&state.audio_capture);
                    capture.stop();
                }
                // Arrêter le poller audio
                state
                    .audio_poller_shutdown
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                eprintln!("[INFO] All movements stopped on window close");
            }
        })
        .setup(|app| {
            // Initialize logging
            init_logging();

            let app_handle = app.handle().clone();
            let state: State<AppState> = app.state();
            let mut handle_guard = state.app_handle.lock().unwrap_or_else(|e| {
                eprintln!("[WARN] app_handle mutex poisoned, recovering: {e}");
                e.into_inner()
            });
            *handle_guard = Some(app_handle);

            // Démarrer le receiver OSC (port 8001 par défaut)
            // Non-fatal : si le port est pris, on log l'erreur mais l'app continue
            {
                let mut receiver = state.osc_receiver.lock().unwrap_or_else(|e| e.into_inner());
                if let Err(e) = receiver.start() {
                    eprintln!(
                        "[WARN] OSC receiver failed to start on port {}: {}",
                        receiver.port, e
                    );
                } else {
                    eprintln!("[INFO] OSC receiver listening on port {}", receiver.port);
                }
            }

            // Démarrer le poller audio (envoie `audio-state-update` au frontend)
            {
                let app_handle = app.handle().clone();
                let state: &AppState = &app.state();
                start_audio_poller(app_handle, state);
                eprintln!("[INFO] Audio state poller started");
            }

            // Sur Linux WebKitGTK : autoriser getUserMedia (microphone)
            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|wv| {
                        use webkit2gtk::glib::Cast;
                        use webkit2gtk::PermissionRequestExt;
                        use webkit2gtk::UserMediaPermissionRequestExt;
                        use webkit2gtk::WebViewExt;
                        let webview = wv.inner();
                        webview.connect_permission_request(|_wv, req| {
                            // N'autoriser que les permissions audio (microphone)
                            // Pas caméra, géolocation, notifications, etc.
                            if let Some(media) = req
                                .downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
                            {
                                if media.is_for_audio_device()
                                    && !media.is_for_video_device()
                                {
                                    req.allow();
                                }
                            }
                            false
                        });
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_hol_project,
            list_audio_devices,
            start_audio_capture,
            stop_audio_capture,
            update_audio_state,
            get_audio_state,
            osc_add_mapping,
            osc_remove_mapping,
            osc_list_mappings,
            osc_get_value,
            osc_get_all_values,
            set_osc_receiver_port,
            set_osc_output,
            get_osc_receiver_port,
            preset_save,
            preset_load,
            preset_delete,
            preset_list,
            compile_graph,
            play_graph,
            stop_graph,
            update_graph,
            preview_graph,
            set_macro,
            save_graph_to_file,
            load_graph_from_file,
            send_osc_position,
            get_perf_stats,
            set_object_override,
            clear_all_overrides,
            discover_osc_targets,
            sample_trajectory,
            sample_movement_trajectory,
            launch_animation,
            update_animation_state,
            // Merge commands (Phase 1 — architecture hybride)
            activate_move,
            deactivate_move,
            deactivate_all_moves,
            set_merge_strategy,
            set_global_macro,
            set_move_speed,
            set_move_playback_mode,
            set_track_depths,
            set_global_origin,
            set_global_osc_ids,
            update_move_graph_merged,
            get_merge_perf_stats,
            list_active_moves,
            // Global graph commands (Phase 2 — post-processing)
            update_global_graph,
            set_track_positions,
            set_manual_position,
            clear_manual_position,
            clear_all_manual_positions,
            // Spatial channels (Phase 4 — canaux étendus)
            set_spatial_channel,
            clear_spatial_channel,
            clear_all_spatial_channels,
            // Cue commands (Phase 3 — cue system étendu)
            store_cue,
            recall_cue,
            list_cues,
            delete_cue,
            frontend_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ═══════════════════════════════════════════════════════════════
// TESTS — valide le flow Animation end-to-end côté Tauri
// Voir tests/animation_tests.rs (extrait pour respecter la règle modularisation)
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
#[path = "tests/animation_tests.rs"]
mod tests;
