//! Macros et settings globaux : merge strategy, scale, rotation, shift, speed, depths, origin, osc_ids

use crate::commands::error::IpcError;
use crate::commands::playback::SetMacroRequest;
use crate::AppState;
use stagespace_engines::{LoopMode, MergeStrategy, PlayDirection};
use tauri::State;

use super::{lock_or_recover, require_finite, require_finite_vec3};

/// Définit la stratégie de merge
#[tauri::command]
pub async fn set_merge_strategy(
    strategy: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let strat = match strategy.as_str() {
        "override" => MergeStrategy::Override,
        "crossfade" => MergeStrategy::Crossfade,
        "blend" => MergeStrategy::Blend,
        "priority" => MergeStrategy::Priority,
        _ => {
            return Err(IpcError::validation(format!(
                "Unknown merge strategy: {strategy}"
            )))
        }
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
) -> Result<(), IpcError> {
    if let Some(v) = request.scale {
        require_finite("scale", v)?;
    }
    for (name, v) in [
        ("shiftX", request.shiftX),
        ("shiftY", request.shiftY),
        ("shiftZ", request.shiftZ),
        ("yaw", request.yaw),
        ("pitch", request.pitch),
        ("roll", request.roll),
        ("radius_scale", request.radius_scale),
        ("height_offset", request.height_offset),
    ] {
        if let Some(v) = v {
            require_finite(name, v)?;
        }
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    apply_set_macro_request(&request, &merge_rt);
    Ok(())
}

/// Applique les champs Some d'un SetMacroRequest au MergeRuntime —
/// partagé entre la commande et le lecteur de score timeline (les
/// macros spatiales d'un slot s'appliquent au lancement, comme un
/// play manuel).
pub(crate) fn apply_set_macro_request(
    request: &SetMacroRequest,
    merge_rt: &stagespace_engines::MergeRuntime,
) {
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
}

/// Définit les macros spatiales d'un move individuel (per-move — le
/// worker les applique en espace local : scale/rotation autour du centre
/// de sa trajectoire, shift en translation monde). Symétrique per-move
/// de `set_global_macro`, pour l'édition live de la transform d'un slot
/// en lecture (0.8.0 — vraie transform per-move).
#[tauri::command]
pub async fn set_move_macro(
    movement_id: String,
    request: SetMacroRequest,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    for (name, v) in [
        ("scale", request.scale),
        ("shiftX", request.shiftX),
        ("shiftY", request.shiftY),
        ("shiftZ", request.shiftZ),
        ("yaw", request.yaw),
        ("pitch", request.pitch),
        ("roll", request.roll),
        ("radius_scale", request.radius_scale),
        ("height_offset", request.height_offset),
    ] {
        if let Some(v) = v {
            require_finite(name, v)?;
        }
    }
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| IpcError::not_found(format!("Movement '{movement_id}' not found")))?;
    let macros = movement.runtime.macros();
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
) -> Result<(), IpcError> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| IpcError::not_found(format!("Movement '{movement_id}' not found")))?;
    movement
        .runtime
        .macros()
        .set_speed(require_finite("speed", speed)?);
    Ok(())
}

/// Définit le poids de merge d'un move (fade effectif = fade × weight)
#[tauri::command]
pub async fn set_move_weight(
    movement_id: String,
    weight: f64,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.contains_key(&movement_id) {
            return Err(IpcError::not_found(format!(
                "Movement '{movement_id}' not found"
            )));
        }
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_move_weight(&movement_id, require_finite("weight", weight)?);
    Ok(())
}

/// Définit la priorité de merge d'un move (stratégie Priority)
#[tauri::command]
pub async fn set_move_priority(
    movement_id: String,
    priority: u32,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.contains_key(&movement_id) {
            return Err(IpcError::not_found(format!(
                "Movement '{movement_id}' not found"
            )));
        }
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_move_priority(&movement_id, priority);
    Ok(())
}

/// Définit les depths par track (pour le MergeRuntime)
#[tauri::command]
pub async fn set_track_depths(
    depths: Vec<f64>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    for (i, d) in depths.iter().enumerate() {
        require_finite(&format!("depths[{i}]"), *d)?;
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_track_depths(depths);
    Ok(())
}

/// Définit l'origin global (isobarycentre des tracks)
#[tauri::command]
pub async fn set_global_origin(
    origin: [f64; 3],
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let origin = require_finite_vec3("origin", origin)?;
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
) -> Result<(), IpcError> {
    // Vérifier si des movements sont actifs
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.is_empty() {
            return Err(IpcError::busy(
                "Cannot change OSC IDs during playback. Stop all moves first.",
            ));
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
) -> Result<(), IpcError> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| IpcError::not_found(format!("Movement '{movement_id}' not found")))?;
    if let Some(lm) = loop_mode {
        let mode = match lm.as_str() {
            "oneshot" => LoopMode::OneShot,
            "loop" => LoopMode::Loop,
            _ => return Err(IpcError::validation(format!("Unknown loop mode: {lm}"))),
        };
        movement.runtime.set_loop_mode(mode);
    }
    if let Some(dir) = direction {
        let pd = match dir.as_str() {
            "forward" => PlayDirection::Forward,
            "backward" => PlayDirection::Backward,
            "ping_pong" => PlayDirection::PingPong,
            _ => return Err(IpcError::validation(format!("Unknown direction: {dir}"))),
        };
        // Même règle qu'au spawn : un t décroissant re-simule depuis t=0 à
        // chaque frame (O(t·n²)) → worker gelé → stale-kill. Le refus doit
        // exister ici aussi — le guard spawn ne couvre pas le changement
        // de direction en cours de jeu.
        super::check_stateful_playback(&movement.graph_json, pd == PlayDirection::Forward, false)?;
        movement.runtime.set_direction(pd);
    }
    Ok(())
}
