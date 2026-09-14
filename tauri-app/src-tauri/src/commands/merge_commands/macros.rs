//! Macros et settings globaux : merge strategy, scale, rotation, shift, speed, depths, origin, osc_ids

use crate::commands::playback::SetMacroRequest;
use crate::AppState;
use stagespace_engines::{LoopMode, MergeStrategy, PlayDirection};
use tauri::State;

use super::lock_or_recover;

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
/// Bloqué pendant le playback pour éviter d'envoyer des positions vers des tracks inexistantes
#[tauri::command]
pub async fn set_global_osc_ids(
    osc_ids: Vec<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Vérifier si des movements sont actifs
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.is_empty() {
            return Err(
                "Cannot change OSC IDs during playback. Stop all moves first.".to_string(),
            );
        }
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_osc_ids(osc_ids);
    Ok(())
}

/// Définit le loop mode et/ou la direction d'un move individuel (per-move, dans le worker).
/// Les champs optionnels permettent de ne modifier qu'un seul des deux sans écraser l'autre.
#[tauri::command]
pub async fn set_move_playback_mode(
    movement_id: String,
    loop_mode: Option<String>,
    direction: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| format!("Movement '{movement_id}' not found"))?;
    if let Some(lm) = loop_mode {
        let mode = match lm.as_str() {
            "oneshot" => LoopMode::OneShot,
            "loop" => LoopMode::Loop,
            _ => return Err(format!("Unknown loop mode: {lm}")),
        };
        movement.runtime.set_loop_mode(mode);
    }
    if let Some(dir) = direction {
        let pd = match dir.as_str() {
            "forward" => PlayDirection::Forward,
            "backward" => PlayDirection::Backward,
            "ping_pong" => PlayDirection::PingPong,
            _ => return Err(format!("Unknown direction: {dir}")),
        };
        movement.runtime.set_direction(pd);
    }
    Ok(())
}
