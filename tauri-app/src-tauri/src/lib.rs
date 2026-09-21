// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use stagespace_engines::{
    init_logging, AudioCaptureManager, AudioState, MergeRuntime, OscReceiver, OscSender,
    PresetManager, Runtime,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub mod commands;
pub mod graph;
use commands::animation::{launch_animation, update_animation_state};
use commands::audio::{
    get_audio_state, list_audio_devices, start_audio_capture, start_audio_poller,
    stop_audio_capture, update_audio_state,
};
use commands::cue_commands::{recall_cue, store_cue};
use commands::file_io::{import_hol_project, load_graph_from_file, save_graph_to_file};
use commands::merge_commands::{
    activate_move, add_channel_modulation, add_zone, clear_all_manual_positions,
    clear_all_spatial_channels, clear_channel_modulations, clear_manual_position,
    clear_spatial_channel, clear_zones, deactivate_all_moves, deactivate_move,
    get_merge_perf_stats, list_active_moves, list_channel_modulations, list_graph_effects,
    list_spatial_channels, list_zones, remove_channel_modulation, remove_zone, set_global_macro,
    set_global_origin, set_global_osc_ids, set_kinematic_smoothing, set_manual_position,
    set_merge_strategy, set_move_playback_mode, set_move_priority, set_move_speed, set_move_weight,
    set_spatial_channel, set_track_depths, set_track_positions, update_global_graph,
    update_move_graph_merged,
};
use commands::network::discover_osc_targets;
use commands::osc::{
    get_osc_receiver_port, osc_add_mapping, osc_clear_mappings, osc_get_all_values, osc_get_value,
    osc_in_stats, osc_list_mappings, osc_remove_mapping, osc_set_in_enabled, osc_suppress_in,
    send_osc_position, set_osc_output, set_osc_receiver_port,
};
use commands::overrides::{clear_all_overrides, set_object_override};
use commands::playback::set_macro;
use commands::presets::{preset_delete, preset_list, preset_load, preset_save};
use commands::sampling::{
    frontend_log, get_perf_stats, sample_movement_trajectory, sample_trajectory,
};
use commands::state::lock_or_recover;

// État global de l'application
pub struct AppState {
    pub audio_state: Arc<Mutex<AudioState>>,
    pub osc_receiver: Arc<Mutex<OscReceiver>>,
    pub presets: Arc<Mutex<PresetManager>>,
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    /// Multi-movement: plusieurs runtimes parallèles indépendants (workers)
    pub movements: Arc<Mutex<HashMap<String, Movement>>>,
    /// IDs réservés pendant l'activation d'un move (fenêtre compile+spawn) —
    /// un deactivate sur un id en cours d'activation renvoie Err au lieu de
    /// no-op silencieux.
    pub pending_move_ids: Arc<Mutex<HashSet<String>>>,
    /// Compteur de génération par move — un sleeper de fade-out ne supprime
    /// un id que si la génération correspond (id réutilisé = génération différente).
    pub move_generation: Arc<AtomicU64>,
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
/// Les champs de snapshot (graph_json, duration, loop_mode, direction, origin)
/// permettent à store_cue/recall_cue de recréer le move sans le frontend.
pub struct Movement {
    pub id: String,
    pub name: String,
    pub runtime: Runtime,
    pub osc_ids: Vec<u32>,
    pub is_preview: bool,
    pub track_indices: Vec<usize>, // indices des tracks dans le .hol
    /// Sub-graph JSON utilisé à l'activation — snapshot pour les cues
    pub graph_json: serde_json::Value,
    /// Durée du move (secondes)
    pub duration: f64,
    /// Loop mode sérialisé : "loop" | "oneshot"
    pub loop_mode: String,
    /// Direction sérialisée : "forward" | "backward" | "ping_pong"
    pub direction: String,
    /// Origin (isobarycentre des tracks ciblées) à l'activation
    pub origin: Option<[f64; 3]>,
    /// Génération de l'id — un sleeper de fade-out ne touche l'entrée que
    /// si la génération correspond encore (protection id réutilisé).
    pub generation: u64,
}

/// Limite de movements simultanés pour éviter l'épuisement des ressources
pub const MAX_MOVEMENTS: usize = 32;

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct MovementInfo {
    pub id: String,
    pub name: String,
    pub osc_ids: Vec<u32>,
    pub is_preview: bool,
    pub is_playing: bool,
    pub track_count: usize,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage({
            let osc_sender = OscSender::default();
            // AudioState maître — partagé par le MergeRuntime et tous les
            // workers (injection à la construction). Le poller n'écrit que
            // cet Arc ; plus de copies synchronisées par polling.
            let audio_state = Arc::new(Mutex::new(AudioState::new()));
            // Ports candidats : 8000 (défaut), 8002 (fallback), 0 (port OS).
            // Si aucun ne bind — pas de stack UDP — l'app ne peut pas servir :
            // exit explicite plutôt qu'un panic ou un runtime zombie.
            let merge_rt = [8000u16, 8002, 0]
                .into_iter()
                .enumerate()
                .find_map(|(i, port)| {
                    match MergeRuntime::new_with_audio_state(
                        "127.0.0.1".to_string(),
                        port,
                        osc_sender.clone(),
                        60.0,
                        audio_state.clone(),
                    ) {
                        Ok(rt) => Some(rt),
                        Err(e) => {
                            eprintln!("[WARN] MergeRuntime bind port {port} failed: {e}");
                            let _ = i;
                            None
                        }
                    }
                })
                .unwrap_or_else(|| {
                    eprintln!("[FATAL] MergeRuntime: no UDP port available — exiting");
                    std::process::exit(1);
                });
            AppState {
                audio_state,
                osc_receiver: Arc::new(Mutex::new(OscReceiver::new(8001))),
                presets: Arc::new(Mutex::new(PresetManager::new())),
                app_handle: Arc::new(Mutex::new(None)),
                movements: Arc::new(Mutex::new(HashMap::new())),
                pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
                move_generation: Arc::new(AtomicU64::new(0)),
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
                // Connecter le routing OSC IN aux destinations du MergeRuntime
                // (macros, canaux spatiaux, positions manuelles)
                let targets = state
                    .merge_runtime
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .osc_in_targets();
                receiver.set_targets(targets);
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
                            if let Some(media) =
                                req.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
                            {
                                if media.is_for_audio_device() && !media.is_for_video_device() {
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
            osc_clear_mappings,
            osc_get_value,
            osc_get_all_values,
            osc_set_in_enabled,
            osc_suppress_in,
            osc_in_stats,
            set_osc_receiver_port,
            set_osc_output,
            get_osc_receiver_port,
            preset_save,
            preset_load,
            preset_delete,
            preset_list,
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
            set_move_weight,
            set_move_priority,
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
            list_spatial_channels,
            list_channel_modulations,
            // Kinematic modulations (Phase 4 P2 — cinématique → canaux)
            add_channel_modulation,
            remove_channel_modulation,
            clear_channel_modulations,
            set_kinematic_smoothing,
            // Zones (Phase 4 P4 — effets spatiaux par position)
            add_zone,
            remove_zone,
            clear_zones,
            list_zones,
            // Effets déclarés par le graph global (nodes Zone/Velocity)
            list_graph_effects,
            // Cue commands (Phase 3 — cue system étendu)
            store_cue,
            recall_cue,
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

#[cfg(test)]
#[path = "tests/recall_tests.rs"]
mod recall_test_file;
