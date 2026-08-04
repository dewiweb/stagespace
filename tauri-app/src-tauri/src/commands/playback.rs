use stagespace_engines::{Graph, Node, NodeType, Edge, Runtime, EngineParams,
    OscSender, OscProfile, LoopMode};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};
use tauri::{State, Emitter};
use crate::AppState;
use crate::graph::parser::build_graph_from_json;
use crate::graph::compilation::compile_graph as compile_graph_inner;

/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlayRequest {
    engine: String,
    params: serde_json::Value,
    osc_address: String,
    osc_port: u16,
    osc_ids: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlayResponse {
    session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StopRequest {
    session_id: String,
}

#[tauri::command]
pub async fn play(
    request: PlayRequest,
    state: State<'_, AppState>,
) -> Result<PlayResponse, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    // Créer le graphe simple
    let mut graph = Graph::new();
    let objects = Node::with_params(NodeType::Objects, request.params.clone());
    let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));

    let engine_type = match request.engine.as_str() {
        "circular" => NodeType::Circular,
        "spiral" => NodeType::Spiral,
        "lissajous" => NodeType::Lissajous,
        "figure8" => NodeType::Figure8,
        "linear" => NodeType::Linear,
        "oscillation" => NodeType::Oscillation,
        "formation" => NodeType::Formation,
        _ => return Err(format!("Unknown engine: {}", request.engine)),
    };

    let engine = Node::with_params(engine_type, request.params.clone());
    let output = Node::new(NodeType::Output);

    let id_objects = objects.id;
    let id_duration = duration.id;
    let id_engine = engine.id;
    let id_output = output.id;

    graph.add_node(objects);
    graph.add_node(duration);
    graph.add_node(engine);
    graph.add_node(output);

    graph.add_edge(Edge {
        from: id_objects,
        to: id_engine,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });
    graph.add_edge(Edge {
        from: id_duration,
        to: id_engine,
        from_port: "output".to_string(),
        to_port: "duration".to_string(),
    });
    graph.add_edge(Edge {
        from: id_engine,
        to: id_output,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });

    // Compiler le graphe
    let compiled = compile_graph_inner(&graph)?;

    // Créer le runtime avec sender par défaut
    let osc_sender = OscSender::new(OscProfile::GenericCartesian, request.osc_address.clone(), request.osc_port);
    let runtime = Runtime::new(request.osc_address, request.osc_port, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    // Lancer le playback
    runtime
        .play_compiled(
            compiled,
            EngineParams {
                n_objects: request.osc_ids.len(),
                duration: 4.0,
                fps: 60.0,
                extra: request.params,
            },
            request.osc_ids,
        )
        .map_err(|e| format!("Failed to start playback: {}", e))?;

    // Stocker le runtime
    let mut state_guard = lock_or_recover(&state.runtime);
    *state_guard = Some(runtime);

    Ok(PlayResponse { session_id })
}

#[tauri::command]
pub fn stop(_session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = state_guard.take() {
        runtime.stop();
    }
    Ok(())
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct PlayGraphRequest {
    pub graph_json: serde_json::Value,
    #[serde(rename = "osc_address")]
    pub oscAddress: String,
    #[serde(rename = "osc_port")]
    pub oscPort: u16,
    #[serde(rename = "osc_ids")]
    pub oscIds: Vec<u32>,
    #[serde(rename = "osc_profile")]
    pub oscProfile: String,
}

#[tauri::command]
pub async fn play_graph(request: PlayGraphRequest, state: State<'_, AppState>) -> Result<String, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&request.graph_json, &audio_state)?;
    drop(audio_state);

    let compiled = compile_graph_inner(&graph)?;

    let osc_profile = OscProfile::from_str(&request.oscProfile)
        .map_err(|e| format!("Invalid OSC profile '{}': {}", request.oscProfile, e))?;

    let osc_sender = OscSender::new(osc_profile, request.oscAddress.clone(), request.oscPort);
    let runtime = Runtime::new(request.oscAddress, request.oscPort, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    // Callback position pour le frontend (preview 3D)
    let app_handle = lock_or_recover(&state.app_handle)
        .as_ref().ok_or("App handle not available")?.clone();
    let osc_ids_for_callback = request.oscIds.clone();
    let osc_ids_for_playback = request.oscIds.clone();

    runtime.set_position_callback(Box::new(move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
        let positions_data: Vec<(usize, [f64; 3])> = positions
            .into_iter().map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z])).collect();
        let _ = app_handle.emit("positions-update", serde_json::json!({
            "time": t, "positions": positions_data, "osc_ids": osc_ids_for_callback,
        }));
    }));

    // Loop infinie par défaut (live)
    runtime.set_loop_mode(LoopMode::Loop);

    runtime.play_compiled(
        compiled,
        EngineParams {
            n_objects: osc_ids_for_playback.len(),
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({}),
        },
        osc_ids_for_playback.clone(),
    ).map_err(|e| format!("Failed to start playback: {}", e))?;

    // Stocker le runtime + osc_ids
    let mut state_guard = lock_or_recover(&state.runtime);
    *state_guard = Some(runtime);
    let mut ids = lock_or_recover(&state.current_osc_ids);
    *ids = osc_ids_for_playback;

    Ok("Graph playback started".to_string())
}

#[tauri::command]
pub async fn stop_graph(state: State<'_, AppState>) -> Result<String, String> {
    let mut state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = state_guard.take() {
        runtime.stop();
    }
    Ok("Graph playback stopped".to_string())
}

/// Preview mode — compile et joue la trajectoire en 3D SANS envoyer d'OSC
/// Permet à l'ingénieur de visualiser et régler avant de lancer en live
#[tauri::command]
pub async fn preview_graph(
    request: PlayGraphRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&request.graph_json, &audio_state)?;
    drop(audio_state);

    let compiled = compile_graph_inner(&graph)?;

    // Utiliser un OscSender "dummy" — pas d'envoi réel
    let osc_sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 9999);
    let runtime = Runtime::new("127.0.0.1".to_string(), 9999, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    // Activer le mode preview
    runtime.set_preview_mode(true);

    // Callback position pour le frontend (preview 3D)
    let app_handle = lock_or_recover(&state.app_handle)
        .as_ref().ok_or("App handle not available")?.clone();
    let osc_ids_for_callback = request.oscIds.clone();

    runtime.set_position_callback(Box::new(move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
        let positions_data: Vec<(usize, [f64; 3])> = positions
            .into_iter().map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z])).collect();
        let _ = app_handle.emit("positions-update", serde_json::json!({
            "time": t, "positions": positions_data, "osc_ids": osc_ids_for_callback,
        }));
    }));

    runtime.set_loop_mode(LoopMode::Loop);

    runtime.play_compiled(
        compiled,
        EngineParams {
            n_objects: request.oscIds.len(),
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({}),
        },
        request.oscIds,
    ).map_err(|e| format!("Playback failed: {}", e))?;

    // Stocker le runtime
    let mut state_guard = lock_or_recover(&state.runtime);
    *state_guard = Some(runtime);

    Ok("Preview started (no OSC sent)".to_string())
}

/// Hot-swap le graphe en cours de lecture — recompile et remplace la position_fn sans arrêter
/// Avec crossfade smooth pour éviter les sauts de position
#[tauri::command]
pub async fn update_graph(
    graph_json: serde_json::Value,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let state_guard = lock_or_recover(&state.runtime);
    let runtime = state_guard.as_ref().ok_or("No runtime active — call play_graph first")?;

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let compiled = compile_graph_inner(&graph)?;

    // Crossfade smooth (défaut 0.5s) pour éviter les sauts
    let fade = fade_duration.unwrap_or(0.5);
    runtime.recall_cue(compiled, fade);

    Ok("Graph hot-swapped with crossfade".to_string())
}

// ── Live commands : macros, loop mode, cue recall ──────────────────────────

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct SetMacroRequest {
    pub speed: Option<f64>,
    pub scale: Option<f64>,
    pub shiftX: Option<f64>,
    pub shiftY: Option<f64>,
    pub shiftZ: Option<f64>,
    pub yaw: Option<f64>,
    pub pitch: Option<f64>,
    pub roll: Option<f64>,
}

#[tauri::command]
pub async fn set_macro(request: SetMacroRequest, state: State<'_, AppState>) -> Result<(), String> {
    let state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = &*state_guard {
        let macros = runtime.macros();
        if let Some(s) = request.speed { macros.set_speed(s); }
        if let Some(s) = request.scale { macros.set_scale(s); }
        // Shift: partial update
        let current_shift = macros.get_shift();
        macros.set_shift(
            request.shiftX.unwrap_or(current_shift.x),
            request.shiftY.unwrap_or(current_shift.y),
            request.shiftZ.unwrap_or(current_shift.z),
        );
        // Rotation: partial update
        let (cy, cp, cr) = macros.get_rotation();
        macros.set_rotation(
            request.yaw.unwrap_or(cy),
            request.pitch.unwrap_or(cp),
            request.roll.unwrap_or(cr),
        );
        Ok(())
    } else {
        Err("No active runtime".to_string())
    }
}

#[tauri::command]
pub async fn set_loop_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = &*state_guard {
        let loop_mode = match mode.as_str() {
            "loop" => LoopMode::Loop,
            "oneshot" => LoopMode::OneShot,
            _ => return Err(format!("Unknown loop mode: {}", mode)),
        };
        runtime.set_loop_mode(loop_mode);
        Ok(())
    } else {
        Err("No active runtime".to_string())
    }
}
