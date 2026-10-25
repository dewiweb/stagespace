use super::state::lock_or_recover;
use crate::commands::error::IpcError;
use crate::AppState;
use tauri::State;

/// Log un message depuis le frontend vers stderr (debug)
#[tauri::command]
pub fn frontend_log(message: String) {
    eprintln!("[FE] {message}");
}

/// Réponse de `get_perf_stats` — `PerfStats` du merge + liveness du thread.
/// `is_running`/`thread_died`/`merge_frames` : le fps reste figé si le merge
/// thread meurt — le frontend doit pouvoir détecter un blackout OSC silencieux.
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PerfStatsResponse {
    #[serde(flatten)]
    pub stats: stagespace_engines::PerfStats,
    pub is_running: bool,
    pub thread_died: bool,
    #[ts(type = "number")]
    pub merge_frames: u64,
    #[ts(type = "number")]
    pub dropped_positions: u64,
}

/// Récupère les stats de performance du runtime (FPS, OSC rate, latency)
#[tauri::command]
pub async fn get_perf_stats(state: State<'_, AppState>) -> Result<PerfStatsResponse, IpcError> {
    // Priorité au MergeRuntime (architecture hybride) — c'est lui qui tourne en live
    let mut merge_rt = lock_or_recover(&state.merge_runtime);
    // Auto-recovery : un panic contenu (catch_unwind) tue le merge thread et
    // coupe tout l'OSC — blackout silencieux jusqu'à la prochaine activation.
    // Le frontend poll cette commande toutes les ~500ms : on tente un respawn
    // ici si le thread est mort et que des moves sont encore enregistrés.
    if merge_rt.thread_died() && !merge_rt.is_running() && merge_rt.has_active_moves() {
        stagespace_engines::logging::log_osc_error(
            "MergeRuntime thread died — attempting automatic restart",
        );
        if merge_rt.start().is_ok() {
            stagespace_engines::logging::log_osc_error("MergeRuntime restarted after thread death");
        }
    }
    Ok(PerfStatsResponse {
        stats: merge_rt.get_perf_stats(),
        is_running: merge_rt.is_running(),
        thread_died: merge_rt.thread_died(),
        merge_frames: merge_rt.merge_frame_count(),
        dropped_positions: merge_rt.dropped_position_count(),
    })
}

/// Un chemin samplé d'une track d'un move — retourné par
/// `sample_movement_trajectories` (batch : 1 invoke pour tout le move
/// au lieu de N invokes séquentiels côté frontend).
#[derive(serde::Serialize)]
pub struct SampledPath {
    /// Index global de la track (index dans le .hol / pool de meshes frontend)
    pub track_index: usize,
    /// (t, x, y, z)
    pub points: Vec<(f64, f64, f64, f64)>,
}

/// Échantillonne les trajectoires de TOUTES les tracks d'un movement actif
/// en un seul appel — remplace la boucle frontend de `sample_movement_trajectory`
/// (qui en plus passait l'index global du mesh au sampler alors qu'il attend
/// l'index local du move → paths faux pour les moves ne commençant pas à 0).
#[tauri::command]
pub async fn sample_movement_trajectories(
    movement_id: String,
    n_samples: usize,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<Vec<SampledPath>, IpcError> {
    // Capturer le sampler + les track_indices puis relâcher le lock AVANT
    // d'échantillonner (pas de lock pendant l'évaluation).
    let (sampler, track_indices) = {
        let movements = lock_or_recover(&state.movements);
        let mv = movements
            .get(&movement_id)
            .ok_or_else(|| IpcError::not_found(format!("Movement '{movement_id}' not found")))?;
        (mv.runtime.sampler(), mv.track_indices.clone())
    };
    let post_process = lock_or_recover(&state.merge_runtime).sample_post_processor();
    let n = sample_count(n_samples, track_indices.len())?;
    let dur = sample_duration(duration)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::with_capacity(track_indices.len());
        for (object_index, &track_index) in track_indices.iter().enumerate() {
            // object_index = index LOCAL du move (0..n_objects) pour le sampler ;
            // track_index = index GLOBAL (.hol) pour le post-process et le frontend.
            let raw = sampler.sample(object_index, n, dur);
            let points = post_process(raw, track_index);
            if points.len() >= 2 {
                out.push(SampledPath {
                    track_index,
                    points,
                });
            }
        }
        out
    })
    .await
    .map_err(|e| IpcError::internal(format!("Sampling task failed: {e}")))
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
) -> Result<Vec<(f64, f64, f64, f64)>, IpcError> {
    // 1. Capturer le sampler puis relâcher le lock movements AVANT de
    //    sampler (idem sample_trajectory : pas de lock pendant l'évaluation).
    let sampler = {
        let movements = lock_or_recover(&state.movements);
        movements
            .get(&movement_id)
            .ok_or_else(|| IpcError::not_found(format!("Movement '{movement_id}' not found")))?
            .runtime
            .sampler()
    };
    let n = sample_count(n_samples, 1)?;
    let dur = sample_duration(duration)?;

    // 2. Appliquer le post-process global (depuis le MergeRuntime)
    let post_process = lock_or_recover(&state.merge_runtime).sample_post_processor();
    tauri::async_runtime::spawn_blocking(move || {
        let raw_samples = sampler.sample(object_index, n, dur);
        post_process(raw_samples, object_index)
    })
    .await
    .map_err(|e| IpcError::internal(format!("Sampling task failed: {e}")))
}

const MAX_SAMPLE_POINTS: usize = 131_072;

fn sample_count(requested: usize, tracks: usize) -> Result<usize, IpcError> {
    if tracks > MAX_SAMPLE_POINTS / 2 {
        return Err(IpcError::validation("Too many tracks to sample"));
    }
    Ok(requested
        .clamp(2, 10_000)
        .min(MAX_SAMPLE_POINTS / tracks.max(1)))
}

fn sample_duration(duration: f64) -> Result<f64, IpcError> {
    if !duration.is_finite() {
        return Err(IpcError::validation("Sampling duration must be finite"));
    }
    Ok(duration.max(0.1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_budget_bounds_total_points() {
        for tracks in [0, 1, 8, 1024, MAX_SAMPLE_POINTS / 2] {
            for requested in [0, 128, 10_000, usize::MAX] {
                let n = sample_count(requested, tracks).unwrap();
                assert!((2..=10_000).contains(&n));
                assert!(n * tracks <= MAX_SAMPLE_POINTS);
            }
        }
        assert!(sample_count(128, MAX_SAMPLE_POINTS / 2 + 1).is_err());
        assert!(sample_count(128, usize::MAX).is_err());
    }

    #[test]
    fn sample_duration_rejects_non_finite_values() {
        for duration in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(sample_duration(duration).is_err());
        }
        assert_eq!(sample_duration(-1.0).unwrap(), 0.1);
        assert_eq!(sample_duration(4.0).unwrap(), 4.0);
    }
}
