use super::state::lock_or_recover;
use crate::AppState;
use stagespace_engines::Preset;
use tauri::State;

// Preset Commands
#[tauri::command]
pub async fn preset_save(
    name: String,
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut presets = lock_or_recover(&state.presets);
    presets.save(name, config);
    Ok(())
}

#[tauri::command]
pub async fn preset_load(
    name: String,
    state: State<'_, AppState>,
) -> Result<Option<Preset>, String> {
    let presets = lock_or_recover(&state.presets);
    Ok(presets.load(&name).cloned())
}

#[tauri::command]
pub async fn preset_delete(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut presets = lock_or_recover(&state.presets);
    presets.delete(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preset_list(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let presets = lock_or_recover(&state.presets);
    Ok(presets.get_presets())
}
