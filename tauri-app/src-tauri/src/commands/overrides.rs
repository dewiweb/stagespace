use super::state::lock_or_recover;
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
) -> Result<(), String> {
    let pos = nalgebra::Vector3::new(x, y, z);
    // Appliquer à tous les movements actifs (système Animation)
    let movements = lock_or_recover(&state.movements);
    let count = movements.len();
    for movement in movements.values() {
        movement.runtime.set_override(obj_index, pos);
    }
    drop(movements);
    // Aussi appliquer au runtime legacy (graphe expert) si présent
    if count == 0 {
        let state_guard = lock_or_recover(&state.runtime);
        if let Some(runtime) = state_guard.as_ref() {
            runtime.set_override(obj_index, pos);
        }
    }
    Ok(())
}

/// Supprime tous les overrides
#[tauri::command]
pub async fn clear_all_overrides(state: State<'_, AppState>) -> Result<(), String> {
    let movements = lock_or_recover(&state.movements);
    let count = movements.len();
    for movement in movements.values() {
        movement.runtime.clear_all_overrides();
    }
    drop(movements);
    if count == 0 {
        let state_guard = lock_or_recover(&state.runtime);
        if let Some(runtime) = state_guard.as_ref() {
            runtime.clear_all_overrides();
        }
    }
    Ok(())
}
