//! Commands Tauri pour le MergeRuntime (architecture hybride Phase 1).
//!
//! Ces commands coexistent avec les commands legacy (play_movement, stop_movement).
//! Le frontend utilisera activate_move/deactivate_move à la place.

use crate::commands::playback::SetMacroRequest;
use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use crate::{Movement, MAX_MOVEMENTS};
use serde::Deserialize;
use stagespace_engines::{
    EngineParams, LoopMode, MergeRuntime, MergeStrategy, OscSender, PositionBuffer, Runtime,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {e}");
        e.into_inner()
    })
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATE / DEACTIVATE MOVES (architecture hybride)
// ═══════════════════════════════════════════════════════════════

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
    #[serde(default = "default_duration")]
    pub duration: f64,
}

fn default_duration() -> f64 {
    4.0
}

/// Active un move : crée un worker Runtime, l'attache au MergeRuntime.
/// Le worker calcule f(t,i) en parallèle, écrit dans un PositionBuffer.
/// Le MergeRuntime merge tous les buffers, applique les macros spatiales, envoie l'OSC.
#[tauri::command]
pub async fn activate_move(
    request: ActivateMoveRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    eprintln!(
        "[ACTIVATE] id={} name={} tracks={:?}",
        request.movement_id, request.name, request.track_indices
    );

    // Le travail lourd (compilation, création runtime) est synchrone.
    // L'exécuter dans spawn_blocking pour ne pas bloquer l'async runtime de Tauri
    // (qui gère aussi les événements, les autres commandes IPC, etc.)
    let audio_state_arc = state.audio_state.clone();
    let movements_arc = state.movements.clone();
    let merge_rt_arc = state.merge_runtime.clone();
    let app_handle_arc = state.app_handle.clone();
    let is_preview = request.is_preview;
    let name = request.name.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Compiler le sub-graph
        let audio_state = lock_or_recover(&audio_state_arc);
        let graph = build_graph_from_json(&request.graph_json, &audio_state)?;
        drop(audio_state);

        // 2. Créer le worker Runtime
        let osc_sender = OscSender::default();
        let runtime = Runtime::new("127.0.0.1".to_string(), 8000, osc_sender)
            .map_err(|e| format!("Failed to create worker runtime: {e}"))?;

        // 3. Compiler avec audio + overrides
        let overrides = runtime.audio_param_overrides();
        let compiled =
            compile_graph_with_audio_and_overrides(&graph, audio_state_arc.clone(), overrides)?;

        // 4. Configurer le worker
        runtime.set_preview_mode(request.is_preview);
        runtime.set_loop_mode(LoopMode::Loop);
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
        let handle = runtime
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
            thread_handle: Some(handle),
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
            let existing = merge_rt.osc_ids();
            let mut merged_ids = existing.clone();
            for &id in &request.osc_ids {
                if !merged_ids.contains(&id) {
                    merged_ids.push(id);
                }
            }
            merge_rt.set_osc_ids(merged_ids);
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
    eprintln!("[DEACTIVATE] id={} fade={}", movement_id, fade);

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

    // 3. Attendre la fin du fade dans un thread séparé pour ne pas bloquer
    //    l'async runtime de Tauri (std::thread::sleep bloque le task executor).
    let mv_id = movement_id.clone();
    let app_state = state.app_handle.clone();
    let merge_rt = state.merge_runtime.clone();
    let movements = state.movements.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(fade));
        // Cleanup inline (évite d'appeler deactivate_move_immediate qui needing State)
        {
            let merge_rt = lock_or_recover(&merge_rt);
            merge_rt.unregister_move(&mv_id);
            merge_rt.rebuild_osc_ids();
        }
        let movement = {
            let mut movements = lock_or_recover(&movements);
            movements.remove(&mv_id)
        };
        if let Some(mut movement) = movement {
            movement.runtime.stop();
            if let Some(handle) = movement.thread_handle.take() {
                drop(handle); // Detach — le thread exit au prochain check running
            }
        }
        if let Some(app_handle) = lock_or_recover(&app_state).clone() {
            let _ = app_handle.emit("active-moves-update", ());
        }
    });

    Ok(format!("Move '{movement_id}' fading out"))
}

fn deactivate_move_immediate_arc(
    movement_id: &str,
    merge_runtime: &Arc<Mutex<MergeRuntime>>,
    movements: &Arc<Mutex<HashMap<String, Movement>>>,
    app_handle: &Arc<Mutex<Option<AppHandle>>>,
) -> Result<String, String> {
    {
        let merge_rt = lock_or_recover(merge_runtime);
        merge_rt.unregister_move(movement_id);
        merge_rt.rebuild_osc_ids();
    }
    let movement = {
        let mut movements = lock_or_recover(movements);
        movements.remove(movement_id)
    };
    if let Some(mut movement) = movement {
        movement.runtime.stop();
        if let Some(handle) = movement.thread_handle.take() {
            drop(handle);
        }
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

    // Récupérer tous les IDs
    let move_ids: Vec<String> = {
        let movements = lock_or_recover(&state.movements);
        movements.keys().cloned().collect()
    };

    if move_ids.is_empty() {
        return Ok("No active moves".to_string());
    }

    // Démarrer le fade out pour tous
    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        for id in &move_ids {
            merge_rt.start_fade_out(id, fade);
        }
    }

    // Attendre le fade dans un thread séparé pour ne pas bloquer l'async runtime
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
                if let Some(mut movement) = movement {
                    movement.runtime.stop();
                    if let Some(handle) = movement.thread_handle.take() {
                        drop(handle);
                    }
                }
            }
            {
                let merge_rt = lock_or_recover(&merge_rt);
                merge_rt.rebuild_osc_ids();
            }
            if let Some(app_handle) = lock_or_recover(&app_state).clone() {
                let _ = app_handle.emit("active-moves-update", ());
            }
        });
        Ok(format!("{count} moves fading out"))
    } else {
        // Fade instantané : retirer immédiatement dans spawn_blocking
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

/// Définit la stratégie de merge
#[tauri::command]
pub async fn set_merge_strategy(
    strategy: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let strat = match strategy.as_str() {
        "override" => MergeStrategy::Override,
        "crossfade" => MergeStrategy::Crossfade,
        "blend" => MergeStrategy::Blend,
        "priority" => MergeStrategy::Priority,
        _ => return Err(format!("Unknown merge strategy: {strategy}")),
    };
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_merge_strategy(strat);
    Ok(())
}

/// Définit les macros spatiales globales (scale, rotation, shift, radius_scale, height_offset)
/// PAS speed — speed reste per-move (utiliser set_move_speed)
#[tauri::command]
pub async fn set_global_macro(
    request: SetMacroRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let macros = merge_rt.macros();
    if let Some(s) = request.scale {
        macros.set_scale(s);
    }
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
    if let Some(v) = request.radius_scale {
        macros.set_radius_scale(v);
    }
    if let Some(v) = request.height_offset {
        macros.set_height_offset(v);
    }
    // Note: speed n'est PAS appliqué ici — speed reste per-move
    Ok(())
}

/// Définit le speed d'un move individuel (per-move, dans le worker)
#[tauri::command]
pub async fn set_move_speed(
    movement_id: String,
    speed: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| format!("Movement '{movement_id}' not found"))?;
    movement.runtime.macros().set_speed(speed);
    Ok(())
}

/// Définit les depths par track (pour le MergeRuntime)
#[tauri::command]
pub async fn set_track_depths(depths: Vec<f64>, state: State<'_, AppState>) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_track_depths(depths);
    Ok(())
}

/// Définit l'origin global (isobarycentre des tracks)
#[tauri::command]
pub async fn set_global_origin(origin: [f64; 3], state: State<'_, AppState>) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
    Ok(())
}

/// Définit les OSC ids globaux (tracks sélectionnées)
#[tauri::command]
pub async fn set_global_osc_ids(
    osc_ids: Vec<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_osc_ids(osc_ids);
    Ok(())
}

/// Hot-swap le graphe d'un move (worker) en cours
#[tauri::command]
pub async fn update_move_graph_merged(
    movement_id: String,
    graph_json: serde_json::Value,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| format!("Movement '{movement_id}' not found"))?;

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let overrides = movement.runtime.audio_param_overrides();
    let compiled =
        compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)?;

    let fade = fade_duration.unwrap_or(0.3);
    movement.runtime.recall_cue(compiled, fade);

    Ok(format!("Move '{movement_id}' graph hot-swapped"))
}

/// Récupère les stats de performance du MergeRuntime
#[tauri::command]
pub async fn get_merge_perf_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let perf = merge_rt.get_perf_stats();
    Ok(serde_json::json!({
        "fps": perf.fps,
        "osc_rate": perf.osc_rate,
        "latency_ms": perf.latency_ms,
        "cpu_percent": perf.cpu_percent,
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

/// Compile et hot-swap le graph global (post-processing)
/// Le graph global est appliqué par le MergeRuntime après le merge des positions.
#[tauri::command]
pub async fn update_global_graph(
    graph_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Récupérer l'audio state partagé
    let audio_state = {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt
            .audio_state_arc()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    };

    // Parser le graph JSON en Graph
    let graph = build_graph_from_json(&graph_json, &audio_state)
        .map_err(|e| format!("Failed to parse global graph: {e}"))?;

    // Compiler le graph en PostProcessFn
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let macros = merge_rt.macros();

    let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

    let post_process_fn = stagespace_engines::compile_post_process(compile_params)
        .map_err(|e| format!("Failed to compile global graph: {e:?}"))?;

    // Hot-swap la fonction dans le MergeRuntime
    merge_rt.swap_post_process_fn(post_process_fn);

    Ok(())
}

/// Définit les positions des tracks .hol (pour Barycenter)
#[tauri::command]
pub async fn set_track_positions(
    positions: std::collections::HashMap<u32, [f64; 3]>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_track_positions(positions);
    Ok(())
}

/// Définit une position manuelle pour un objet (pour ManualPosition / drag 3D)
#[tauri::command]
pub async fn set_manual_position(
    object_index: usize,
    position: [f64; 3],
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_manual_position(object_index, position);
    Ok(())
}

/// Efface la position manuelle pour un objet
#[tauri::command]
pub async fn clear_manual_position(
    object_index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_manual_position(object_index);
    Ok(())
}

/// Efface toutes les positions manuelles
#[tauri::command]
pub async fn clear_all_manual_positions(state: State<'_, AppState>) -> Result<(), String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_all_manual_positions();
    Ok(())
}
