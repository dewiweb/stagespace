use stagespace_engines::AudioState;
use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn update_audio_state(state: State<'_, AppState>, audio_data: AudioState) -> Result<(), String> {
    // Stocker dans AppState
    {
        let mut audio_state = lock_or_recover(&state.audio_state);
        *audio_state = audio_data.clone();
    }
    // Pousser vers tous les runtimes actifs (pour les audio mods)
    let movements = lock_or_recover(&state.movements);
    for (_, movement) in movements.iter() {
        movement.runtime.set_audio_state(audio_data.clone());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_audio_state(state: State<'_, AppState>) -> Result<AudioState, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    Ok(audio_state.clone())
}
