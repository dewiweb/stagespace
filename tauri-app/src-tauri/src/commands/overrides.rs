use super::state::lock_or_recover;
use crate::commands::error::IpcError;
use crate::AppState;
use tauri::State;

/// Override la position d'un objet (par index) — l'objet ignore la trajectoire
#[tauri::command]
pub async fn set_object_override(
    obj_index: usize,
    x: f64,
    y: f64,
    z: f64,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let pos = nalgebra::Vector3::new(x, y, z);
    // Appliquer à tous les movements actifs — le graphe "expert" tourne
    // aussi comme worker (graph-main / graph-preview).
    let movements = lock_or_recover(&state.movements);
    for movement in movements.values() {
        movement.runtime.set_override(obj_index, pos);
    }
    Ok(())
}

/// Supprime tous les overrides
#[tauri::command]
pub async fn clear_all_overrides(state: State<'_, AppState>) -> Result<(), IpcError> {
    let movements = lock_or_recover(&state.movements);
    for movement in movements.values() {
        movement.runtime.clear_all_overrides();
    }
    Ok(())
}
