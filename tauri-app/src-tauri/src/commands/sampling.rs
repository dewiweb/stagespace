use std::sync::{Mutex, MutexGuard};
use tauri::State;
use crate::AppState;

/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}

/// Récupère les stats de performance du runtime (FPS, OSC rate, latency)
#[tauri::command]
pub async fn get_perf_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = state_guard.as_ref() {
        let stats = runtime.get_perf_stats();
        Ok(serde_json::json!({
            "fps": stats.fps,
            "oscRate": stats.osc_rate,
            "latencyMs": stats.latency_ms,
            "cpuPercent": stats.cpu_percent,
        }))
    } else {
        Ok(serde_json::json!({
            "fps": 0,
            "oscRate": 0,
            "latencyMs": 0,
            "cpuPercent": 0,
        }))
    }
}

/// Échantillonne la trajectoire compilée pour la visualiser dans la 3D
/// Retourne N points (t, x, y, z) pour un objet donné
#[tauri::command]
pub async fn sample_trajectory(
    object_index: usize,
    n_samples: usize,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<Vec<(f64, f64, f64, f64)>, String> {
    let state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = state_guard.as_ref() {
        Ok(runtime.sample_trajectory(object_index, n_samples.max(2), duration.max(0.1)))
    } else {
        Ok(vec![])
    }
}

/// Échantillonne la trajectoire d'un movement actif (système Animation)
/// Retourne N points (t, x, y, z) pour un objet donné
#[tauri::command]
pub async fn sample_movement_trajectory(
    movement_id: String,
    object_index: usize,
    n_samples: usize,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<Vec<(f64, f64, f64, f64)>, String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements.get(&movement_id)
        .ok_or_else(|| format!("Movement '{}' not found", movement_id))?;
    Ok(movement.runtime.sample_trajectory(object_index, n_samples.max(2), duration.max(0.1)))
}
