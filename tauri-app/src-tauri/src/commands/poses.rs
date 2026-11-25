//! Pose commands — presets de positions nommés (design :
//! docs/position-presets-design.md). Les poses vivent dans
//! `AppState.poses` (backend = source de vérité — le scheduler score
//! et l'OSC y accèdent sans webview), persistées via la section
//! `poses` de l'enveloppe .hfg.
//!
//! Namespace : les poses sont **track_id-keyed** ; la conversion en
//! obj_index (position dans la liste osc_ids globale) se fait à
//! l'usage avec le mapping **courant** — jamais l'inverse (règle
//! namespace AGENTS.md).

use super::state::{lock_or_recover, Shared};
use crate::commands::error::IpcError;
use crate::AppState;
use stagespace_engines::Pose;
use tauri::State;

/// Résout un track_id en obj_index courant (position dans la liste
/// osc_ids globale du merge). None = track non patchée.
fn obj_of_track(merge: &stagespace_engines::MergeRuntime, track: u32) -> Option<usize> {
    merge.osc_ids().iter().position(|id| *id == track)
}

/// Liste toutes les poses (triées par nom — ordre stable pour l'UI).
#[tauri::command]
pub async fn pose_list(state: State<'_, AppState>) -> Result<Vec<Pose>, IpcError> {
    let poses = lock_or_recover(&state.poses);
    let mut out: Vec<Pose> = poses.values().cloned().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Upsert d'une pose (édition UI — table de positions, renommage par
/// delete+save). Le nom est l'identité.
#[tauri::command]
pub async fn pose_save(pose: Pose, state: State<'_, AppState>) -> Result<(), IpcError> {
    if pose.name.trim().is_empty() {
        return Err(IpcError::validation("Pose name cannot be empty"));
    }
    if pose
        .positions
        .values()
        .any(|p| !p.iter().all(|v| v.is_finite()))
    {
        return Err(IpcError::validation("Pose positions must be finite"));
    }
    lock_or_recover(&state.poses).insert(pose.name.clone(), pose);
    Ok(())
}

#[tauri::command]
pub async fn pose_delete(name: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    lock_or_recover(&state.poses).remove(&name);
    Ok(())
}

/// Capture les positions live dans une pose (upsert).
/// `track_ids` : None = toutes les tracks patchées ayant une position
/// connue ; Some = la sélection opérateur. La résolution lit
/// `last_position` (chaîne canonique → manuelle → trackpos) — les
/// tracks sans aucune position connue sont skippées et rapportées
/// dans le compte-rendu (jamais de position inventée).
#[tauri::command]
pub async fn pose_capture(
    name: String,
    track_ids: Option<Vec<u32>>,
    state: State<'_, AppState>,
) -> Result<Pose, IpcError> {
    if name.trim().is_empty() {
        return Err(IpcError::validation("Pose name cannot be empty"));
    }
    let sh = Shared::from_state(&state);
    let pose = tauri::async_runtime::spawn_blocking(move || capture_pose(&sh, name, track_ids))
        .await
        .map_err(|e| IpcError::io(format!("pose_capture task failed: {e}")))??;
    lock_or_recover(&state.poses).insert(pose.name.clone(), pose.clone());
    Ok(pose)
}

/// Rappel instantané : écrit les positions de la pose en positions
/// manuelles — même chemin que `/stagespace/position` (takeover
/// opérateur, persiste jusqu'à override/clear). Partiel : les tracks
/// hors de la pose ne sont pas touchées ; les tracks de la pose non
/// patchées sont skippées silencieusement (le warning UI/preflight
/// est une responsabilité de surface, pas du recall live).
#[tauri::command]
pub async fn pose_snap(name: String, state: State<'_, AppState>) -> Result<usize, IpcError> {
    let pose = lock_or_recover(&state.poses).get(&name).cloned();
    let Some(pose) = pose else {
        return Err(IpcError::not_found(format!("Pose '{name}' not found")));
    };
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || snap_pose(&sh, &pose))
        .await
        .map_err(|e| IpcError::io(format!("pose_snap task failed: {e}")))?
}

/// Remplace l'intégralité de la table de poses — utilisé par le load
/// d'enveloppe .hfg (sections vides = effacées, pattern oscMappings).
#[tauri::command]
pub async fn pose_replace_all(poses: Vec<Pose>, state: State<'_, AppState>) -> Result<(), IpcError> {
    let mut table = lock_or_recover(&state.poses);
    table.clear();
    for pose in poses {
        if !pose.name.trim().is_empty() {
            table.insert(pose.name.clone(), pose);
        }
    }
    Ok(())
}

// ─── Logique pure — testable sans `State` (pattern recall_tests) ─────

/// Capture les positions live dans une Pose. `track_ids` : None = toutes
/// les tracks patchées. Tracks non patchées ou sans position connue :
/// skippées (log) — jamais de position inventée.
pub(crate) fn capture_pose(
    sh: &Shared,
    name: String,
    track_ids: Option<Vec<u32>>,
) -> Result<Pose, IpcError> {
    let merge = lock_or_recover(&sh.merge_runtime);
    let ids = merge.osc_ids();
    let candidates: Vec<u32> = match track_ids {
        Some(ts) => ts,
        None => ids.clone(),
    };
    let mut positions = std::collections::HashMap::new();
    let mut skipped: Vec<u32> = Vec::new();
    for track in candidates {
        let Some(obj) = ids.iter().position(|id| *id == track) else {
            skipped.push(track); // non patchée
            continue;
        };
        match merge.last_position(obj) {
            Some(p) if p.iter().all(|v| v.is_finite()) => {
                positions.insert(track, p);
            }
            _ => {
                skipped.push(track); // jamais émis, pas de trackpos
            }
        }
    }
    if positions.is_empty() {
        return Err(IpcError::validation(format!(
            "Nothing to capture — no known position for the requested tracks{}",
            if skipped.is_empty() {
                String::new()
            } else {
                format!(" (skipped: {skipped:?})")
            }
        )));
    }
    if !skipped.is_empty() {
        eprintln!("[POSE] capture '{name}' — tracks skippées (pas de position connue): {skipped:?}");
    }
    Ok(Pose { name, positions })
}

/// Applique la pose en positions manuelles — retourne le nombre de
/// tracks effectivement appliquées (patchées). Erreur si aucune.
pub(crate) fn snap_pose(sh: &Shared, pose: &Pose) -> Result<usize, IpcError> {
    let merge = lock_or_recover(&sh.merge_runtime);
    let mut applied = 0usize;
    for (track, pos) in &pose.positions {
        if let Some(obj) = obj_of_track(&merge, *track) {
            merge.set_manual_position(obj, *pos);
            applied += 1;
        }
    }
    if applied == 0 {
        return Err(IpcError::validation(format!(
            "Pose '{}' — aucune track patchée : rien appliqué",
            pose.name
        )));
    }
    Ok(applied)
}
