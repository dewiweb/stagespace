use stagespace_engines::{AudioObject, ObjectGroup};
use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

// Patch Commands
/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn patch_set_object(
    osc_id: u32,
    name: String,
    color: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<AudioObject, String> {
    let mut patch = lock_or_recover(&state.patch);
    Ok(patch.set_object(osc_id, name, color, notes))
}

#[tauri::command]
pub async fn patch_remove_object(osc_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let mut patch = lock_or_recover(&state.patch);
    patch.remove_object(osc_id);
    Ok(())
}

#[tauri::command]
pub async fn patch_list_objects(state: State<'_, AppState>) -> Result<Vec<AudioObject>, String> {
    let patch = lock_or_recover(&state.patch);
    Ok(patch.list_objects())
}

#[tauri::command]
pub async fn patch_set_group(
    name: String,
    object_ids: Vec<u32>,
    engine: String,
    params: serde_json::Value,
    profile: String,
    color: String,
    anchor: [f64; 3],
    state: State<'_, AppState>,
) -> Result<ObjectGroup, String> {
    let mut patch = lock_or_recover(&state.patch);
    let anchor_vec = nalgebra::Vector3::new(anchor[0], anchor[1], anchor[2]);
    Ok(patch.set_group(name, object_ids, engine, params, profile, color, anchor_vec))
}

#[tauri::command]
pub async fn patch_remove_group(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut patch = lock_or_recover(&state.patch);
    patch.remove_group(&name);
    Ok(())
}

#[tauri::command]
pub async fn patch_list_groups(state: State<'_, AppState>) -> Result<Vec<ObjectGroup>, String> {
    let patch = lock_or_recover(&state.patch);
    Ok(patch.list_groups())
}
