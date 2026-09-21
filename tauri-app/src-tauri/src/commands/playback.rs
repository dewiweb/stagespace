use super::error::IpcError;
use super::state::lock_or_recover;
use crate::AppState;
use serde::Deserialize;
use tauri::State;

// ── Live commands : macros globales ─────────────────────────────────────────
//
// Le chemin "graphe expert" (play_graph/preview_graph/update_graph/stop_graph
// sur des workers graph-main/graph-preview) a été supprimé — les moves passent
// exclusivement par les slots (`activate_move` / `update_move_graph_merged` /
// `deactivate_all_moves`). Seul `set_macro` survit : il s'applique aux macros
// globales du MergeRuntime, actives pour tous les moves.

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
    pub radius_scale: Option<f64>,
    pub height_offset: Option<f64>,
}

/// Macros globales du MergeRuntime — appliquées au merge de tous les moves
/// (le réglage survit aux stop/start individuels).
#[tauri::command]
pub async fn set_macro(
    request: SetMacroRequest,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let macros = lock_or_recover(&state.merge_runtime).macros();
    if let Some(s) = request.speed {
        macros.set_speed(s);
    }
    if let Some(s) = request.scale {
        macros.set_scale(s);
    }
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
    // radius_scale + height_offset
    if let Some(v) = request.radius_scale {
        macros.set_radius_scale(v);
    }
    if let Some(v) = request.height_offset {
        macros.set_height_offset(v);
    }
    Ok(())
}
