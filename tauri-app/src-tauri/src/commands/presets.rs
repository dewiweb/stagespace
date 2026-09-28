use super::state::lock_or_recover;
use crate::commands::error::IpcError;
use crate::AppState;
use stagespace_engines::Preset;
use tauri::State;

// Preset Commands
#[tauri::command]
pub async fn preset_save(
    name: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut presets = lock_or_recover(&state.presets);
    presets.save(name, config);
    Ok(())
}

#[tauri::command]
pub async fn preset_load(
    name: String,
    state: State<'_, AppState>,
) -> Result<Option<Preset>, IpcError> {
    let presets = lock_or_recover(&state.presets);
    Ok(presets.load(&name).cloned())
}

#[tauri::command]
pub async fn preset_delete(name: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut presets = lock_or_recover(&state.presets);
    presets
        .delete(&name)
        .map_err(|e| IpcError::io(e.to_string()))
}

#[tauri::command]
pub async fn preset_list(state: State<'_, AppState>) -> Result<Vec<String>, IpcError> {
    let presets = lock_or_recover(&state.presets);
    Ok(presets.get_presets())
}
