use super::state::lock_or_recover;
use crate::AppState;
use tauri::State;

/// Log un message depuis le frontend vers stderr (debug)
#[tauri::command]
pub fn frontend_log(message: String) {
    eprintln!("[FE] {message}");
}

/// Récupère les stats de performance du runtime (FPS, OSC rate, latency)
#[tauri::command]
pub async fn get_perf_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // Priorité au MergeRuntime (architecture hybride) — c'est lui qui tourne en live
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let stats = merge_rt.get_perf_stats();
    Ok(serde_json::json!({
        "fps": stats.fps,
        "oscRate": stats.osc_rate,
        "latencyMs": stats.latency_ms,
        "cpuPercent": stats.cpu_percent,
        "oscErrorRate": stats.osc_error_rate,
        "oscRefusedRate": stats.osc_refused_rate,
        // Liveness : fps reste figé si le merge thread meurt — le frontend
        // doit pouvoir détecter un blackout OSC silencieux.
        "isRunning": merge_rt.is_running(),
        "threadDied": merge_rt.thread_died(),
        "mergeFrames": merge_rt.merge_frame_count(),
        "droppedPositions": merge_rt.dropped_position_count(),
    }))
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
    // Le graphe "expert" tourne comme worker (graph-main / graph-preview)
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get("graph-main")
        .or_else(|| movements.get("graph-preview"));
    Ok(match movement {
        Some(m) => m
            .runtime
            .sample_trajectory(object_index, n_samples.max(2), duration.max(0.1)),
        None => vec![],
    })
}

/// Échantillonne la trajectoire d'un movement actif (système Animation)
/// en appliquant le post-process global (graph global compilé).
/// Retourne N points (t, x, y, z) pour un objet donné.
///
/// Contrairement à un simple sample du runtime du movement, cette méthode
/// applique aussi les transformations du graph global (Scale, Rotate, Offset,
/// Barycenter, etc.) pour que la visualisation corresponde à la sortie OSC.
#[tauri::command]
pub async fn sample_movement_trajectory(
    movement_id: String,
    object_index: usize,
    n_samples: usize,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<Vec<(f64, f64, f64, f64)>, String> {
    // 1. Sampler avec les macros du movement (depuis le runtime du movement)
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| format!("Movement '{movement_id}' not found"))?;
    let raw_samples =
        movement
            .runtime
            .sample_trajectory(object_index, n_samples.max(2), duration.max(0.1));
    drop(movements);

    // 2. Appliquer le post-process global (depuis le MergeRuntime)
    let mr = lock_or_recover(&state.merge_runtime);
    Ok(mr.apply_post_process_to_samples(raw_samples, object_index))
}
