use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

// BPM Commands
/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn bpm_tap(state: State<'_, AppState>) -> Result<Option<f64>, String> {
    let mut bpm = lock_or_recover(&state.bpm_tracker);
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    Ok(bpm.tap(current_time))
}

#[tauri::command]
pub async fn bpm_set(bpm: f64, state: State<'_, AppState>) -> Result<(), String> {
    let mut bpm_tracker = lock_or_recover(&state.bpm_tracker);
    bpm_tracker.set_bpm(bpm);
    Ok(())
}

#[tauri::command]
pub async fn bpm_get(state: State<'_, AppState>) -> Result<Option<f64>, String> {
    let bpm_tracker = lock_or_recover(&state.bpm_tracker);
    Ok(bpm_tracker.get_bpm())
}

#[tauri::command]
pub async fn bpm_reset(state: State<'_, AppState>) -> Result<(), String> {
    let mut bpm_tracker = lock_or_recover(&state.bpm_tracker);
    bpm_tracker.reset();
    Ok(())
}
