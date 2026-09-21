//! Positions manuelles et positions de tracks : set/clear pour drag 3D et Barycenter

use crate::commands::error::IpcError;
use crate::AppState;
use std::collections::HashMap;
use tauri::State;

use super::lock_or_recover;

/// Définit les positions des tracks .hol (pour Barycenter)
#[tauri::command]
pub async fn set_track_positions(
    positions: HashMap<u32, [f64; 3]>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
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
) -> Result<(), IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    merge_rt.set_manual_position(object_index, position);
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
