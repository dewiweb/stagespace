//! Positions manuelles et positions de tracks : set/clear pour drag 3D et Barycenter

use crate::commands::error::IpcError;
use crate::AppState;
use std::collections::HashMap;
use tauri::State;

use super::{lock_or_recover, require_finite_vec3};

/// Définit les positions des tracks .hol (pour Barycenter)
#[tauri::command]
pub async fn set_track_positions(
    positions: HashMap<u32, [f64; 3]>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    for (track, pos) in &positions {
        require_finite_vec3(&format!("positions[{track}]"), *pos)?;
    }
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_track_positions(positions);
    Ok(())
}

/// Origine d'UNE track — merge dans la map (pour /stagespace/trackpos :
/// un set unitaire ne doit pas effacer les autres origines posées).
#[tauri::command]
pub async fn set_track_position(
    track: u32,
    position: [f64; 3],
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_track_position(track, require_finite_vec3("position", position)?);
    Ok(())
}

/// Positions d'origine des tracks — panic hors-.hol les utilise au lieu
/// de (0,0,0) en dur (posées par /stagespace/trackpos ou import .hol).
#[tauri::command]
pub async fn get_track_positions(
    state: State<'_, AppState>,
) -> Result<HashMap<u32, [f64; 3]>, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(merge_rt.track_positions())
}

/// Définit une position manuelle pour un objet (pour ManualPosition / drag 3D)
#[tauri::command]
pub async fn set_manual_position(
    object_index: usize,
    position: [f64; 3],
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_manual_position(object_index, require_finite_vec3("position", position)?);
    Ok(())
}

/// Efface la position manuelle pour un objet
#[tauri::command]
pub async fn clear_manual_position(
    object_index: usize,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_manual_position(object_index);
    Ok(())
}

/// Efface toutes les positions manuelles
#[tauri::command]
pub async fn clear_all_manual_positions(state: State<'_, AppState>) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.clear_all_manual_positions();
    Ok(())
}

/// Grab & throw — lance un objet avec une vélocité initiale (m/s).
/// L'objet part de sa dernière position émise et continue balistique
/// avec amortissement (~2/s) jusqu'au repos en position manuelle.
#[tauri::command]
pub async fn throw_object(
    obj: usize,
    vel: [f64; 3],
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    crate::state::lock_or_recover(&state.merge_runtime).throw_object(obj, vel);
    Ok(())
}
