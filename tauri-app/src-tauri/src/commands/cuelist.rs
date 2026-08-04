use stagespace_engines::Cue;
use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

// Cue List Commands
/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn cuelist_add(cue: Cue, state: State<'_, AppState>) -> Result<(), String> {
    let mut cuelist = lock_or_recover(&state.cuelist);
    cuelist.add(cue);
    Ok(())
}

#[tauri::command]
pub async fn cuelist_remove(index: usize, state: State<'_, AppState>) -> Result<(), String> {
    let mut cuelist = lock_or_recover(&state.cuelist);
    cuelist.remove(index).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cuelist_list(state: State<'_, AppState>) -> Result<Vec<Cue>, String> {
    let cuelist = lock_or_recover(&state.cuelist);
    Ok(cuelist.list().to_vec())
}

#[tauri::command]
pub async fn cuelist_clear(state: State<'_, AppState>) -> Result<(), String> {
    let mut cuelist = lock_or_recover(&state.cuelist);
    cuelist.clear();
    Ok(())
}
