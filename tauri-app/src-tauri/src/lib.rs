// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use stagespace_engines::{
    init_logging, AudioCaptureManager, AudioState, MergeRuntime, OscReceiver, OscSender,
    PluginRegistry, PresetManager, Runtime,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

pub mod bridge_server;
pub mod commands;
pub mod graph;
pub mod supervisor;
use commands::animation::{launch_animation, update_animation_state};
use commands::audio::{
    get_audio_state, list_audio_devices, start_audio_capture, start_audio_poller,
    stop_audio_capture, update_audio_state,
};
use commands::cue_commands::{
    get_parked_objects, park_object, recall_cue, store_cue, store_score_cue, unpark_object,
};
use commands::file_io::{
    get_show_snapshot, import_hol_project, load_graph_from_file, save_graph_to_file,
    set_show_snapshot,
};
use commands::merge_commands::{
    activate_move, add_channel_modulation, add_zone, clear_all_manual_positions,
    clear_all_spatial_channels, clear_channel_modulations, clear_manual_position,
    clear_spatial_channel, clear_zones, deactivate_all_moves, deactivate_move, diagnose_graph,
    get_merge_perf_stats, get_profile_channels, get_track_positions, list_active_moves,
    list_channel_modulations, list_effective_channels, list_graph_effects, list_spatial_channels,
    list_zones, remove_channel_modulation, remove_zone, set_global_macro, set_global_origin,
    set_global_osc_ids, set_kinematic_smoothing, set_manual_position, set_merge_strategy,
    set_move_playback_mode, set_move_priority, set_move_speed, set_move_weight,
    set_spatial_channel, set_track_depths, set_track_position, set_track_positions, throw_object,
    update_global_graph, update_move_graph_merged, update_signal_graph, update_zone,
};
use commands::network::discover_osc_targets;
use commands::osc::{
    get_emitted_positions, get_last_osc_message, get_last_show_cmd_age, get_manual_position,
    get_manual_positions, get_object_states, get_osc_armed, get_osc_receiver_port,
    get_perceptual_metrics, get_pos_tape, get_psn_health, osc_add_mapping, osc_clear_mappings,
    osc_get_all_values, osc_get_value, osc_in_stats, osc_list_mappings, osc_remove_mapping,
    osc_set_in_enabled, osc_set_mapping_enabled, osc_suppress_in, play_pos_tape, send_osc_position,
    send_show_feedback, send_show_nack, set_attention, set_distance_reality, set_gesture,
    set_media_sync, set_osc_armed, set_osc_output, set_osc_receiver_port, set_pos_tape_record,
    set_psn_config, set_spatial_compression, set_timecode_fps, set_venue_config,
};
use commands::playback::set_macro;
use commands::plugins::{import_plugin, list_plugins, reload_plugins};
use commands::presets::{preset_delete, preset_list, preset_load, preset_save};
use commands::remote_ui::{remote_ui_status, set_remote_ui};
use commands::sampling::{
    frontend_log, get_perf_stats, sample_movement_trajectories, sample_movement_trajectory,
};
use commands::score::{
    score_timeline_load, score_timeline_play, score_timeline_seek, score_timeline_set_loop,
    score_timeline_state, score_timeline_stop, score_timeline_update,
};
use commands::state::lock_or_recover;

// État global de l'application
pub struct AppState {
    pub audio_state: Arc<Mutex<AudioState>>,
    pub osc_receiver: Arc<Mutex<OscReceiver>>,
    pub presets: Arc<Mutex<PresetManager>>,
    /// Sink d'événements UI (positions, logs, resyncs) — branché au setup
    /// par la fenêtre ; `None` en headless pur (CLI/tests sans frontend).
    pub event_sink: Arc<Mutex<Option<commands::state::EventSink>>>,
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
    /// Récepteur PSN/RTTrP (PosiStageNet) — tracking industrie : flux
    /// tracker_id → positions manuelles lissées.
    pub psn_receiver: Arc<stagespace_engines::psn_receiver::PsnReceiver>,
    /// Flag anti-recall concurrent — empêche deux cue recalls simultanés
    pub recall_in_progress: Arc<std::sync::atomic::AtomicBool>,
    /// Compteur panic/deactivate — un recall qui le voit bouger s'avorte.
    pub deactivate_gen: Arc<std::sync::atomic::AtomicU64>,
    /// Capture audio via cpal (remplace getUserMedia de la WebView)
    pub audio_capture: Arc<Mutex<AudioCaptureManager>>,
    /// Flag pour arrêter le poller audio proprement à la fermeture
    pub audio_poller_shutdown: Arc<AtomicBool>,
    /// Flag pour arrêter le superviseur backend (watchdog merge + kill
    /// des workers zombies — audits C5/C7) à la fermeture de l'app.
    pub supervisor_shutdown: Arc<AtomicBool>,
    /// Registry des plugins WASM — None si wasmtime n'a pas pu s'initialiser.
    /// Mutex : `reload_plugins` re-scanne in-place sans stopper le runtime.
    pub plugin_registry: Option<Arc<Mutex<stagespace_engines::PluginRegistry>>>,
    /// Dossier des bundles `.ssx` (`<app_data_dir>/plugins/`).
    pub plugins_dir: Option<std::path::PathBuf>,
    /// Bridge remote-UI (HTTP/SSE → navigateurs) — start/stop à chaud
    /// via `set_remote_ui` (Settings) ou au boot via STAGESPACE_BRIDGE_BIND.
    pub remote_ui: Mutex<bridge_server::RemoteUi>,
    /// Snapshot du show courant (enveloppe) — poussé par le frontend à
    /// chaque save/load ; les UIs distantes le récupèrent via
    /// `get_show_snapshot` à la connexion (les slots vivent côté frontend,
    /// sans snapshot un remote démarrerait sur un store vide).
    pub show_snapshot: Mutex<Option<serde_json::Value>>,
    /// Score timeline — clips multi-pistes exécutés par le backend
    /// (spawn_move/recall direct, survit à la webview).
    pub score_timeline: Arc<Mutex<commands::score::ScoreTimeline>>,
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
    pub graph_json: stagespace_engines::GraphJson,
    /// Graph de modulation per-move (domaine signal) — snapshot pour les cues
    pub signal_graph: Option<stagespace_engines::GraphJson>,
    /// Durée du move (secondes)
    pub duration: f64,
    /// Loop mode sérialisé : "loop" | "oneshot"
    pub loop_mode: String,
    /// Direction sérialisée : "forward" | "backward" | "ping_pong"
    pub direction: String,
    /// Origin (isobarycentre des tracks ciblées) à l'activation
    pub origin: Option<[f64; 3]>,
    /// Sémantique de fin (revert|hold) — gardée pour les cue snapshots.
    pub end_mode: stagespace_engines::EndMode,
    /// Sémantique d'ancrage (origin|current|follow) — idem.
    pub anchor_mode: stagespace_engines::AnchorMode,
    /// Cible de l'ancrage follow (obj_index).
    pub anchor_target: Option<u32>,
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

/// Construction de l'état applicatif partagé — extraite pour être réutilisée
/// par le pont de test headless (mock_app) avec le même wiring exact.
pub fn new_app_state() -> AppState {
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
    // Plugins WASM — dossier `<data_dir>/com.stagespace.studio/plugins/`
    // (même racine que l'app_data_dir Tauri : identifier de
    // tauri.conf.json). Un plugin cassé n'empêche pas les autres —
    // erreurs collectées dans le registry, visibles via list_plugins.
    let plugins_dir = dirs::data_dir().map(|d| d.join("com.stagespace.studio").join("plugins"));
    if let Some(dir) = &plugins_dir {
        let _ = std::fs::create_dir_all(dir);
    }
    let plugin_registry = match PluginRegistry::new() {
        Ok(mut reg) => {
            if let Some(dir) = &plugins_dir {
                let n = reg.scan_dir(dir);
                if n > 0 {
                    eprintln!("[PLUGINS] {n} plugin(s) loaded from {}", dir.display());
                }
                for (path, err) in reg.errors() {
                    eprintln!("[PLUGINS-ERROR] {}: {err}", path.display());
                }
            }
            Some(Arc::new(Mutex::new(reg)))
        }
        Err(e) => {
            eprintln!("[PLUGINS-ERROR] wasmtime init failed: {e}");
            None
        }
    };
    AppState {
        audio_state,
        osc_receiver: Arc::new(Mutex::new(OscReceiver::new(8001))),
        presets: Arc::new(Mutex::new(PresetManager::new())),
        event_sink: Arc::new(Mutex::new(None)),
        movements: Arc::new(Mutex::new(HashMap::new())),
        pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
        move_generation: Arc::new(AtomicU64::new(0)),
        merge_runtime: Arc::new(Mutex::new(merge_rt)),
        psn_receiver: Arc::new(stagespace_engines::psn_receiver::PsnReceiver::new()),
        recall_in_progress: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        deactivate_gen: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        audio_capture: Arc::new(Mutex::new(AudioCaptureManager::new())),
        audio_poller_shutdown: Arc::new(AtomicBool::new(false)),
        supervisor_shutdown: Arc::new(AtomicBool::new(false)),
        plugin_registry,
        plugins_dir,
        remote_ui: Mutex::new(bridge_server::RemoteUi::default()),
        show_snapshot: Mutex::new(None),
        score_timeline: Arc::new(Mutex::new(commands::score::ScoreTimeline::default())),
    }
}

/// Setup du backend — branche le sink d'événements UI, démarre le receiver
/// OSC (show-control `/stagespace/*`), le poller audio et le superviseur.
/// Générique sur le runtime : utilisé par `run()` (Wry) et par le pont de
/// test headless (MockRuntime) — le sink découple l'émission de la webview.
pub fn setup_backend_runtime<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    init_logging();

    let app_handle = app.handle().clone();
    let state: State<AppState> = app.state();
    {
        let sink_handle = app_handle.clone();
        *lock_or_recover(&state.event_sink) =
            Some(Arc::new(move |event: &str, payload: serde_json::Value| {
                let _ = sink_handle.emit(event, payload);
            }));
    }

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
        // Branche le cache des valeurs OSC sur le merge (source
        // `SignalOsc` du signal graph — l'Arc interne est
        // re-pointé si le receiver est recréé sur un autre port).
        {
            let merge_rt = state
                .merge_runtime
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            merge_rt.set_osc_values_handle(receiver.address_values_handle());
        }
        // Show-control : `/stagespace/*` intercepté par le
        // receiver → évènement `show-control` vers le frontend
        // (dispatch = les mêmes fonctions que les raccourcis).
        {
            let app_handle = app.handle().clone();
            // L'arrêt d'urgence vit aussi côté backend : un panic
            // OSC ne doit JAMAIS dépendre d'une webview vivante —
            // sinon il est ACKé mais jamais exécuté (webview gelée).
            let stop_movements = state.movements.clone();
            let stop_merge = state.merge_runtime.clone();
            let stop_gen = state.deactivate_gen.clone();
            // Socket de réponse partagé — le sink peut répondre
            // au demandeur d'un `positions` query sans webview.
            let reply_handle = receiver.reply_socket_handle();
            receiver.set_show_sink(move |cmd, addr| {
                match cmd {
                    stagespace_engines::osc_receiver::ShowCommand::Panic
                    | stagespace_engines::osc_receiver::ShowCommand::Stop => {
                        // Backend-side stop — exécuté ici, pas
                        // via la webview. Le panic gagne sur tout.
                        stop_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let drained: Vec<Movement> = {
                            stop_movements
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .drain()
                                .map(|(_, m)| m)
                                .collect()
                        };
                        for m in drained {
                            m.runtime.stop();
                        }
                        if matches!(cmd, stagespace_engines::osc_receiver::ShowCommand::Panic) {
                            let merge = stop_merge.lock().unwrap_or_else(|e| e.into_inner());
                            let origin = merge.origin();
                            // Objets parkés ou tenus manuellement :
                            // ne PAS téléporter vers l'origine — le
                            // merge les réémettrait aussitôt depuis
                            // leur position tenue (flash aller-retour,
                            // revue L6). Manuel/park = override
                            // opérateur, il survit au panic.
                            let manuals = merge.manual_positions();
                            let parked = merge.parked_objects();
                            for (obj_idx, id) in merge.osc_ids().iter().enumerate() {
                                if manuals.contains_key(&obj_idx) || parked.contains(&obj_idx) {
                                    continue;
                                }
                                let _ = merge.send_position_now(*id, origin);
                            }
                        }
                        // Chaque webview annule ses propres timers
                        // pre_wait/follow — ils vivent par contexte
                        // JS : un panic ici n'atteint pas le
                        // setTimeout armé dans une autre fenêtre
                        // (revue H1 — sinon la cue tire après panic).
                        let _ = app_handle.emit("timers:cancel", ());
                    }
                    stagespace_engines::osc_receiver::ShowCommand::PositionsQuery => {
                        // `/stagespace/positions` — dump des positions
                        // émises au demandeur (console/companion).
                        // Backend-direct : pas de webview requise.
                        let merge = stop_merge.lock().unwrap_or_else(|e| e.into_inner());
                        let positions = merge.emitted_positions();
                        let sock = reply_handle
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        if let Some(sock) = sock {
                            for (obj, pos) in positions {
                                if let Some(bytes) =
                                    stagespace_engines::osc_receiver::encode_position_feedback(
                                        obj, pos,
                                    )
                                {
                                    let _ = sock.send_to(&bytes, addr);
                                }
                            }
                        }
                    }
                    _ => {}
                }
                // Broadcast à TOUTES les fenêtres : la fenêtre run
                // détachée voit les commandes OSC dans son log.
                let _ = app_handle.emit(
                    "show-log",
                    serde_json::json!({
                        "label": format!("{cmd:?} {addr}"),
                    }),
                );
                let _ = app_handle.emit(
                    "show-control",
                    serde_json::json!({
                        "command": cmd,
                        "from": addr.to_string(),
                    }),
                );
            });
        }
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
        let state: &AppState = &app.state();
        start_audio_poller(state.event_sink.clone(), state);
        eprintln!("[INFO] Audio state poller started");
    }

    // Démarrer le superviseur backend (audits C5/C7) — kill des
    // workers zombies + restart du merge sans dépendre du polling
    // frontend. Une webview gelée ne peut plus provoquer de
    // blackout OSC définitif.
    {
        let state: &AppState = &app.state();
        supervisor::start(state);
        eprintln!("[INFO] Backend supervisor started");
    }

    Ok(())
}

/// Dispatch IPC de toutes les commands — extrait en fonction nommée pour
/// être partagée par `run()` (webview réelle) et le pont de test headless
/// (`get_ipc_response` sur MockRuntime) sans dupliquer la liste.
pub fn stagespace_invoke_handler<R: tauri::Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    let handler: fn(tauri::ipc::Invoke<R>) -> bool = tauri::generate_handler![
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
        osc_set_mapping_enabled,
        osc_suppress_in,
        osc_in_stats,
        get_last_osc_message,
        get_last_show_cmd_age,
        send_show_nack,
        set_osc_receiver_port,
        set_osc_output,
        set_osc_armed,
        get_osc_armed,
        get_osc_receiver_port,
        preset_save,
        preset_load,
        preset_delete,
        preset_list,
        set_macro,
        save_graph_to_file,
        load_graph_from_file,
        send_osc_position,
        send_show_feedback,
        set_timecode_fps,
        set_psn_config,
        get_psn_health,
        get_object_states,
        get_emitted_positions,
        get_manual_position,
        get_manual_positions,
        throw_object,
        set_venue_config,
        get_perceptual_metrics,
        set_distance_reality,
        set_spatial_compression,
        set_attention,
        set_gesture,
        set_pos_tape_record,
        get_pos_tape,
        set_media_sync,
        play_pos_tape,
        score_timeline_load,
        score_timeline_update,
        score_timeline_play,
        score_timeline_stop,
        score_timeline_seek,
        score_timeline_set_loop,
        score_timeline_state,
        get_perf_stats,
        discover_osc_targets,
        sample_movement_trajectories,
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
        // Signal graph (domaine modulation → deltas de macros)
        diagnose_graph,
        update_signal_graph,
        set_track_positions,
        get_track_positions,
        set_track_position,
        set_manual_position,
        clear_manual_position,
        clear_all_manual_positions,
        throw_object,
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
        update_zone,
        remove_zone,
        clear_zones,
        list_zones,
        // Effets déclarés par le graph global (nodes Zone/Velocity)
        list_graph_effects,
        get_profile_channels,
        list_effective_channels,
        // Cue commands (Phase 3 — cue system étendu)
        store_cue,
        store_score_cue,
        recall_cue,
        park_object,
        get_parked_objects,
        unpark_object,
        frontend_log,
        // Plugins WASM (bundles .ssx dans <data_dir>/plugins/)
        list_plugins,
        reload_plugins,
        import_plugin,
        // Remote-UI bridge (Settings — serveur HTTP/SSE à chaud)
        set_remote_ui,
        remote_ui_status,
        // Show snapshot — l'hôte partage l'enveloppe aux UIs distantes
        set_show_snapshot,
        get_show_snapshot,
    ];
    handler(invoke)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance — une 2e instance ferait conflit sur les ports
        // OSC/bridge (échec silencieux en régie). Le 2e lancement focus
        // la fenêtre existante et meurt là.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(new_app_state())
        .on_window_event(|window, event| {
            // Seule la fenêtre PRINCIPALE arrête le show — une fenêtre
            // détachée (conduite/run) qui se ferme ne doit jamais tuer
            // moves, merge, OSC ou superviseur.
            if window.label() != "main" {
                return;
            }
            // Destroyed uniquement — CloseRequested peut être annulé par
            // la garde "unsaved changes" du frontend (preventDefault) :
            // nettoyer ici tuerait le show sur une fermeture annulée.
            if let tauri::WindowEvent::Destroyed = event {
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
                // Arrêter le poller audio et le superviseur backend
                state
                    .audio_poller_shutdown
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                state
                    .supervisor_shutdown
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                // Fermer les fenêtres détachées avec la principale — sinon
                // elles survivent en orphelines : surfaces figées sans
                // backend, actions routées vers une fenêtre morte.
                for label in ["run", "conduite"] {
                    if let Some(w) = window.get_webview_window(label) {
                        let _ = w.close();
                    }
                }
                eprintln!("[INFO] All movements stopped on window close");
            }
        })
        .setup(|app| {
            setup_backend_runtime(app)?;
            // La webview `main` devient la cible IPC du bridge remote-UI —
            // posée toujours (le toggle Settings l'utilise à chaud), alors
            // que le serveur ne démarre que sur demande (env ou commande).
            {
                let state = app.state::<AppState>();
                state
                    .remote_ui
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .webview = app.get_webview_window("main");
            }
            // Remote UI opt-in : bridge HTTP+SSE vers navigateurs
            // distants (STAGESPACE_BRIDGE_BIND) — cohabite avec la webview.
            bridge_server::spawn_if_enabled(app.handle());
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
        .invoke_handler(stagespace_invoke_handler)
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

#[cfg(test)]
#[path = "tests/example_show_tests.rs"]
mod example_show_test_file;

#[cfg(test)]
#[path = "tests/complex_graph_tests.rs"]
mod complex_graph_test_file;

#[cfg(test)]
#[path = "tests/supervisor_tests.rs"]
mod supervisor_test_file;

#[cfg(test)]
#[path = "tests/param_modulation_tests.rs"]
mod param_modulation_test_file;

#[cfg(test)]
#[path = "tests/show_control_e2e_tests.rs"]
mod show_control_e2e_test_file;

#[cfg(test)]
#[path = "tests/osc_locks_tests.rs"]
mod osc_locks_test_file;
