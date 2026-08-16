use super::state::lock_or_recover;
use crate::AppState;
use stagespace_engines::AudioState;
use tauri::State;

#[tauri::command]
pub async fn update_audio_state(
    state: State<'_, AppState>,
    audio_data: AudioState,
) -> Result<(), String> {
    // 1. Stocker dans AppState (lock très bref)
    {
        let mut audio_state = lock_or_recover(&state.audio_state);
        *audio_state = audio_data.clone();
    }
    // 2. Collecter les Arcs des runtimes actifs (lock bref sur movements)
    let runtime_arcs: Vec<_> = {
        let movements = lock_or_recover(&state.movements);
        movements
            .values()
            .map(|m| m.runtime.audio_state_arc())
            .collect()
    };
    // 3. Mettre à jour chaque runtime SANS tenir le lock sur movements
    //    → évite de bloquer update_animation_state qui a aussi besoin de movements
    for arc in &runtime_arcs {
        let mut s = arc.lock().unwrap_or_else(|e| e.into_inner());
        *s = audio_data.clone();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_audio_state(state: State<'_, AppState>) -> Result<AudioState, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    Ok(audio_state.clone())
}
