use stagespace_engines::{Runtime, EngineParams, OscSender, OscProfile,
    PositionFn, LoopMode};
use serde::Deserialize;
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};
use tauri::{State, Emitter};
use crate::AppState;
use crate::{Movement, MovementInfo, MAX_MOVEMENTS};
use crate::graph::parser::build_graph_from_json;
use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::commands::playback::SetMacroRequest;

/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
/// Un Mutex empoisonné signifie qu'un thread a panicé en tenant le lock.
/// Au lieu de propager l'erreur forever, on récupère les données internes.
/// C'est sûr car nos données ne sont pas dans un état invalide critique.
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}

// ═══════════════════════════════════════════════════════════════
// MULTI-MOVEMENT: plusieurs runtimes parallèles indépendants
// ═══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct PlayMovementRequest {
    movement_id: String,
    name: String,
    graph_json: serde_json::Value,
    osc_ids: Vec<u32>,
    track_indices: Vec<usize>,
    is_preview: bool,
    osc_address: String,
    osc_port: u16,
    osc_profile: String,
    /// Origin = isobarycentre des tracks ciblées [x, y, z]
    #[serde(default)]
    origin: Option<[f64; 3]>,
}

/// Lance un movement (runtime indépendant) — preview ou live
#[tauri::command]
pub async fn play_movement(
    request: PlayMovementRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&request.graph_json, &audio_state)?;
    drop(audio_state);

    let osc_profile = OscProfile::from_str(&request.osc_profile)
        .map_err(|e| format!("Invalid OSC profile: {}", e))?;

    let osc_sender = OscSender::new(osc_profile, request.osc_address.clone(), request.osc_port);
    let runtime = Runtime::new(request.osc_address, request.osc_port, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    let overrides = runtime.audio_param_overrides();
    let compiled = compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)?;

    // Mode preview: pas d'OSC
    runtime.set_preview_mode(request.is_preview);
    runtime.set_loop_mode(LoopMode::Loop);

    // Origin = isobarycentre des tracks ciblées — la trajectoire épouse la position de départ
    if let Some(ref origin) = request.origin {
        runtime.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
    }

    // Callback position — emit sur un canal spécifique au movement
    let app_handle = lock_or_recover(&state.app_handle)
        .as_ref().ok_or("App handle not available")?.clone();
    let movement_id = request.movement_id.clone();
    let osc_ids_for_callback = request.osc_ids.clone();

    runtime.set_position_callback(Box::new(move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
        let positions_data: Vec<(usize, [f64; 3])> = positions
            .into_iter().map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z])).collect();
        let _ = app_handle.emit(
            &format!("movement-positions-{}", movement_id),
            serde_json::json!({
                "time": t,
                "positions": positions_data,
                "osc_ids": osc_ids_for_callback,
            }),
        );
    }));

    // Vérifier la limite de movements
    {
        let movements = lock_or_recover(&state.movements);
        if movements.len() >= MAX_MOVEMENTS {
            return Err(format!("Maximum {} movements reached — stop some first", MAX_MOVEMENTS));
        }
    }

    let handle = runtime.play_compiled(
        compiled,
        EngineParams {
            n_objects: request.osc_ids.len(),
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({}),
        },
        request.osc_ids.clone(),
    ).map_err(|e| format!("Playback failed: {}", e))?;

    let movement = Movement {
        id: request.movement_id.clone(),
        name: request.name.clone(),
        runtime,
        osc_ids: request.osc_ids,
        is_preview: request.is_preview,
        track_indices: request.track_indices,
        thread_handle: Some(handle),
    };

    let mut movements = lock_or_recover(&state.movements);
    movements.insert(request.movement_id.clone(), movement);

    Ok(format!("Movement '{}' started ({})", request.name,
        if request.is_preview { "preview" } else { "live" }))
}

/// Stoppe un movement individuel — stop le runtime et join le thread
#[tauri::command]
pub async fn stop_movement(
    movement_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Extraire le movement du hashmap SANS tenir le lock pendant stop+join
    let movement = {
        let mut movements = lock_or_recover(&state.movements);
        movements.remove(&movement_id)
    };
    if let Some(mut movement) = movement {
        movement.runtime.stop();
        if let Some(handle) = movement.thread_handle.take() {
            let _ = handle.join();
        }
        // Emit movement list update
        if let Some(app_handle) = lock_or_recover(&state.app_handle).clone() {
            let _ = app_handle.emit("movements-update", ());
        }
        Ok(format!("Movement '{}' stopped", movement.name))
    } else {
        Err(format!("Movement '{}' not found", movement_id))
    }
}

/// Stoppe tous les movements — stop + join tous les threads
#[tauri::command]
pub async fn stop_all_movements(state: State<'_, AppState>) -> Result<String, String> {
    // Drainer le hashmap SANS tenir le lock pendant stop+join
    let drained: Vec<Movement> = {
        let mut movements = lock_or_recover(&state.movements);
        movements.drain().map(|(_, m)| m).collect()
    };
    // Stop + join en dehors du lock
    let count = drained.len();
    for mut movement in drained {
        movement.runtime.stop();
        if let Some(handle) = movement.thread_handle.take() {
            let _ = handle.join();
        }
    }
    // Emit movement list update
    if let Some(app_handle) = lock_or_recover(&state.app_handle).clone() {
        let _ = app_handle.emit("movements-update", ());
    }
    Ok(format!("{} movements stopped", count))
}

/// Liste tous les movements actifs avec perf stats
#[tauri::command]
pub async fn list_movements(state: State<'_, AppState>) -> Result<Vec<MovementInfo>, String> {
    let movements = lock_or_recover(&state.movements);
    Ok(movements.values().map(|m| {
        let perf = m.runtime.get_perf_stats();
        MovementInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            osc_ids: m.osc_ids.clone(),
            is_preview: m.is_preview,
            is_playing: m.runtime.is_running(),
            track_count: m.osc_ids.len(),
            fps: perf.fps,
            osc_rate: perf.osc_rate,
            latency_ms: perf.latency_ms,
            cpu_percent: perf.cpu_percent,
        }
    }).collect())
}

/// Met à jour les macros d'un movement individuel
#[tauri::command]
pub async fn set_movement_macro(
    movement_id: String,
    request: SetMacroRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements.get(&movement_id)
        .ok_or_else(|| format!("Movement '{}' not found", movement_id))?;
    let macros = movement.runtime.macros();
    if let Some(s) = request.speed { macros.set_speed(s); }
    if let Some(s) = request.scale { macros.set_scale(s); }
    let current_shift = macros.get_shift();
    macros.set_shift(
        request.shiftX.unwrap_or(current_shift.x),
        request.shiftY.unwrap_or(current_shift.y),
        request.shiftZ.unwrap_or(current_shift.z),
    );
    let (cy, cp, cr) = macros.get_rotation();
    macros.set_rotation(
        request.yaw.unwrap_or(cy),
        request.pitch.unwrap_or(cp),
        request.roll.unwrap_or(cr),
    );
    Ok(())
}

/// Hot-swap le graphe d'un movement en cours (live by design)
/// Compile le nouveau graphe et crossfade vers la nouvelle fonction
#[tauri::command]
pub async fn update_movement_graph(
    movement_id: String,
    graph_json: serde_json::Value,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements.get(&movement_id)
        .ok_or_else(|| format!("Movement '{}' not found", movement_id))?;

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let overrides = movement.runtime.audio_param_overrides();
    let compiled = compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)?;

    let fade = fade_duration.unwrap_or(0.3);
    movement.runtime.recall_cue(compiled, fade);

    Ok(format!("Movement '{}' graph hot-swapped", movement_id))
}

/// Stop un movement avec fade out (au lieu de stop instantané)
#[tauri::command]
pub async fn stop_movement_with_fade(
    movement_id: String,
    fade_duration: f64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Extraire le movement SANS tenir le lock pendant stop+join
    let movement = {
        let mut movements = lock_or_recover(&state.movements);
        movements.remove(&movement_id)
    };
    if let Some(mut movement) = movement {
        // Crossfade vers une fonction nulle (fade out)
        let zero_fn: PositionFn = Box::new(|_t, _i| nalgebra::Vector3::zeros());
        movement.runtime.recall_cue(zero_fn, fade_duration);
        // Laisser le thread de playback exécuter le crossfade jusqu'au bout,
        // puis stopper le runtime et join le thread
        std::thread::sleep(std::time::Duration::from_secs_f64(fade_duration));
        movement.runtime.stop();
        if let Some(handle) = movement.thread_handle.take() {
            let _ = handle.join();
        }
        // Emit movement list update
        if let Some(app_handle) = lock_or_recover(&state.app_handle).clone() {
            let _ = app_handle.emit("movements-update", ());
        }
        Ok(format!("Movement '{}' fading out over {:.1}s", movement.name, fade_duration))
    } else {
        Err(format!("Movement '{}' not found", movement_id))
    }
}
