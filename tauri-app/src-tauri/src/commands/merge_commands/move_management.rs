//! Move management : activate, deactivate, deactivate_all, list, perf stats

use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::graph::parser::build_graph_from_json;
use crate::{AppState, Movement, MAX_MOVEMENTS};
use serde::Deserialize;
use stagespace_engines::{
    EngineParams, LoopMode, OscSender, PlayDirection, PositionBuffer, Runtime,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use super::lock_or_recover;

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct ActivateMoveRequest {
    pub movement_id: String,
    pub name: String,
    pub graph_json: serde_json::Value,
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub is_preview: bool,
    /// Origin = isobarycentre des tracks ciblées [x, y, z]
    #[serde(default)]
    pub origin: Option<[f64; 3]>,
    /// Duration du move (pour loop)
    #[serde(default = "super::default_duration")]
    pub duration: f64,
    /// Loop mode : "loop" (défaut) ou "oneshot"
    #[serde(default = "super::default_loop_mode")]
    pub loop_mode: String,
    /// Direction : "forward" (défaut), "backward", ou "ping_pong"
    #[serde(default = "super::default_direction")]
    pub direction: String,
}

/// Active un move : crée un worker Runtime, l'attache au MergeRuntime.
#[tauri::command]
pub async fn activate_move(
    request: ActivateMoveRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    eprintln!(
        "[ACTIVATE] id={} name={} tracks={:?}",
        request.movement_id, request.name, request.track_indices
    );

    let audio_state_arc = state.audio_state.clone();
    let movements_arc = state.movements.clone();
    let merge_rt_arc = state.merge_runtime.clone();
    let app_handle_arc = state.app_handle.clone();
    let is_preview = request.is_preview;
    let name = request.name.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Compiler le sub-graph
        let audio_state = lock_or_recover(&audio_state_arc);
        let graph = build_graph_from_json(&request.graph_json, &audio_state).map_err(|e| {
            eprintln!("[ACTIVATE-ERROR] build_graph_from_json failed: {e}");
            e
        })?;
        drop(audio_state);

        // 2. Créer le worker Runtime
        let osc_sender = OscSender::default();
        let runtime = Runtime::new("127.0.0.1".to_string(), 8000, osc_sender).map_err(|e| {
            eprintln!("[ACTIVATE-ERROR] Runtime::new failed: {e}");
            format!("Failed to create worker runtime: {e}")
        })?;

        // 3. Compiler avec audio + overrides
        let overrides = runtime.audio_param_overrides();
        let compiled =
            compile_graph_with_audio_and_overrides(&graph, audio_state_arc.clone(), overrides)
                .map_err(|e| {
                    eprintln!("[ACTIVATE-ERROR] compile_graph failed: {e}");
                    e
                })?;

        // 4. Configurer le worker
        runtime.set_preview_mode(request.is_preview);
        let loop_mode = match request.loop_mode.as_str() {
            "oneshot" => LoopMode::OneShot,
            _ => LoopMode::Loop,
        };
        runtime.set_loop_mode(loop_mode);
        let direction = match request.direction.as_str() {
            "backward" => PlayDirection::Backward,
            "ping_pong" => PlayDirection::PingPong,
            _ => PlayDirection::Forward,
        };
        runtime.set_direction(direction);
        if let Some(ref origin) = request.origin {
            runtime.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
        }

        // 5. Créer le PositionBuffer et l'attacher au worker
        let buffer = Arc::new(PositionBuffer::new());
        runtime.set_position_buffer(buffer.clone());

        // 6. Vérifier la limite de movements
        {
            let movements = lock_or_recover(&movements_arc);
            if movements.len() >= MAX_MOVEMENTS {
                return Err(format!(
                    "Maximum {MAX_MOVEMENTS} movements reached — stop some first"
                ));
            }
        }

        // 7. Démarrer le worker thread
        runtime
            .play_compiled(
                compiled,
                EngineParams {
                    n_objects: request.osc_ids.len(),
                    duration: request.duration,
                    fps: 60.0,
                    extra: serde_json::json!({}),
                },
                request.osc_ids.clone(),
            )
            .map_err(|e| format!("Worker playback failed: {e}"))?;

        // 8. Enregistrer le movement
        let movement = Movement {
            id: request.movement_id.clone(),
            name: request.name.clone(),
            runtime,
            osc_ids: request.osc_ids.clone(),
            is_preview: request.is_preview,
            track_indices: request.track_indices.clone(),
        };
        {
            let mut movements = lock_or_recover(&movements_arc);
            movements.insert(request.movement_id.clone(), movement);
        }

        // 9. Enregistrer le move dans le MergeRuntime
        {
            let merge_rt = lock_or_recover(&merge_rt_arc);
            merge_rt.register_move(
                request.movement_id.clone(),
                buffer,
                request.osc_ids.clone(),
                request.track_indices.clone(),
                request.is_preview,
            );
            if let Some(ref origin) = request.origin {
                merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
            }

            if !merge_rt.is_running() {
                let app_handle = lock_or_recover(&app_handle_arc)
                    .as_ref()
                    .ok_or("App handle not available")?
                    .clone();
                merge_rt.set_position_callback(Box::new(
                    move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
                        let positions_data: Vec<(usize, [f64; 3])> = positions
                            .into_iter()
                            .map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z]))
                            .collect();
                        let _ = app_handle.emit(
                            "global-positions",
                            serde_json::json!({
                                "time": t,
                                "positions": positions_data,
                            }),
                        );
                    },
                ));
                drop(merge_rt);
                let mut merge_rt = lock_or_recover(&merge_rt_arc);
                merge_rt
                    .start()
                    .map_err(|e| format!("Failed to start MergeRuntime: {e}"))?;
            }
        }

        // 10. Emit active-moves-update
        if let Some(app_handle) = lock_or_recover(&app_handle_arc).clone() {
            let _ = app_handle.emit("active-moves-update", ());
        }

        Ok(format!(
            "Move '{}' activated ({})",
            name,
            if is_preview { "preview" } else { "live" }
        ))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Désactive un move avec fade out
#[tauri::command]
pub async fn deactivate_move(
    movement_id: String,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let fade = fade_duration.unwrap_or(0.5);

    // 1. Démarrer le fade out dans le MergeRuntime
    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt.start_fade_out(&movement_id, fade);
    }

    // 2. Si fade instantané, retirer immédiatement dans spawn_blocking
    if fade <= 0.0 {
        let merge_rt_arc = state.merge_runtime.clone();
        let movements_arc = state.movements.clone();
        let app_handle_arc = state.app_handle.clone();
        let mv_id = movement_id.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            deactivate_move_immediate_arc(&mv_id, &merge_rt_arc, &movements_arc, &app_handle_arc)
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
    }

    // 3. Attendre la fin du fade dans un thread séparé
    let mv_id = movement_id.clone();
    let app_state = state.app_handle.clone();
    let merge_rt = state.merge_runtime.clone();
    let movements = state.movements.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(fade));
        {
            let merge_rt = lock_or_recover(&merge_rt);
            merge_rt.unregister_move(&mv_id);
        }
        let movement = {
            let mut movements = lock_or_recover(&movements);
            movements.remove(&mv_id)
        };
        if let Some(movement) = movement {
            movement.runtime.stop(); // stop() join le thread proprement
        }
        if let Some(app_handle) = lock_or_recover(&app_state).clone() {
            let _ = app_handle.emit("active-moves-update", ());
        }
    });

    Ok(format!("Move '{movement_id}' fading out"))
}

fn deactivate_move_immediate_arc(
    movement_id: &str,
    merge_runtime: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    movements: &Arc<Mutex<HashMap<String, Movement>>>,
    app_handle: &Arc<Mutex<Option<AppHandle>>>,
) -> Result<String, String> {
    {
        let merge_rt = lock_or_recover(merge_runtime);
        merge_rt.unregister_move(movement_id);
    }
    let movement = {
        let mut movements = lock_or_recover(movements);
        movements.remove(movement_id)
    };
    if let Some(movement) = movement {
        movement.runtime.stop(); // stop() join le thread proprement
    }
    if let Some(app_handle) = lock_or_recover(app_handle).clone() {
        let _ = app_handle.emit("active-moves-update", ());
    }
    Ok(format!("Move '{movement_id}' deactivated"))
}

/// Désactive tous les moves avec fade out
#[tauri::command]
pub async fn deactivate_all_moves(
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let fade = fade_duration.unwrap_or(0.5);

    let move_ids: Vec<String> = {
        let movements = lock_or_recover(&state.movements);
        movements.keys().cloned().collect()
    };

    if move_ids.is_empty() {
        return Ok("No active moves".to_string());
    }

    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        for id in &move_ids {
            merge_rt.start_fade_out(id, fade);
        }
    }

    let count = move_ids.len();
    if fade > 0.0 {
        let app_state = state.app_handle.clone();
        let merge_rt = state.merge_runtime.clone();
        let movements = state.movements.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs_f64(fade));
            for id in &move_ids {
                {
                    let merge_rt = lock_or_recover(&merge_rt);
                    merge_rt.unregister_move(id);
                }
                let movement = {
                    let mut movements = lock_or_recover(&movements);
                    movements.remove(id)
                };
                if let Some(movement) = movement {
                    movement.runtime.stop(); // stop() join le thread proprement
                }
            }
            if let Some(app_handle) = lock_or_recover(&app_state).clone() {
                let _ = app_handle.emit("active-moves-update", ());
            }
        });
        Ok(format!("{count} moves fading out"))
    } else {
        let merge_rt_arc = state.merge_runtime.clone();
        let movements_arc = state.movements.clone();
        let app_handle_arc = state.app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for id in &move_ids {
                let _ = deactivate_move_immediate_arc(
                    id,
                    &merge_rt_arc,
                    &movements_arc,
                    &app_handle_arc,
                );
            }
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
        Ok(format!("{count} moves deactivated"))
    }
}

/// Récupère les stats de performance du MergeRuntime
#[tauri::command]
pub async fn get_merge_perf_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let perf = merge_rt.get_perf_stats();
    Ok(serde_json::json!({
        "fps": perf.fps,
        "oscRate": perf.osc_rate,
        "latencyMs": perf.latency_ms,
        "cpuPercent": perf.cpu_percent,
        "oscErrorRate": perf.osc_error_rate,
    }))
}

/// Liste les moves actifs
#[tauri::command]
pub async fn list_active_moves(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let movements = lock_or_recover(&state.movements);
    Ok(movements
        .values()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "name": m.name,
                "osc_ids": m.osc_ids,
                "is_preview": m.is_preview,
                "is_playing": m.runtime.is_running(),
                "track_count": m.osc_ids.len(),
            })
        })
        .collect())
}
