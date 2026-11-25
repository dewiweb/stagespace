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
use crate::commands::merge_commands::{spawn_move, MoveSpec};
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
pub async fn pose_replace_all(
    poses: Vec<Pose>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut table = lock_or_recover(&state.poses);
    table.clear();
    for pose in poses {
        if !pose.name.trim().is_empty() {
            table.insert(pose.name.clone(), pose);
        }
    }
    Ok(())
}

/// Résultat d'un goto — compte-rendu de distribution pour les
/// toasts/nacks (design §7 : les skips sont rapportés, jamais silencieux).
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct PoseGotoResult {
    pub movement_id: String,
    /// Nombre d'objets dans la rampe.
    pub objects: usize,
    /// Tracks de la pose exclues — non patchées, parkées ou sous PSN.
    pub skipped: Vec<u32>,
}

/// Goto animé : rampe les objets de leur position actuelle vers la pose
/// en `duration` secondes (défaut 2.0), easing `smooth` par défaut.
///
/// Mécanique (design §4.3/§6.9) : la commande spawne le graphe standard
/// `poseramp → output` en oneshot + end_mode hold — aucune voie
/// parallèle, le move résultat est un move comme un autre (merge,
/// panic, snapshots, reprise opérateur). Les positions manuelles des
/// objets membres sont effacées au spawn APRÈS capture (continuité
/// exacte à t=0 — sinon la rampe serait masquée puis l'objet sauterait
/// à la cible en fin de move).
///
/// La distribution est pré-filtrée : tracks de la pose ∩ patchées ∩
/// non parkées ∩ non-PSN — la résolution compile est alors totale,
/// les fallbacks freeze-in-place/appear-at-target ne concernent que
/// les slots hand-authored.
#[tauri::command]
pub async fn pose_goto(
    name: String,
    duration: Option<f64>,
    easing: Option<String>,
    state: State<'_, AppState>,
) -> Result<PoseGotoResult, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || goto_pose(&sh, &name, duration, easing))
        .await
        .map_err(|e| IpcError::io(format!("pose_goto task failed: {e}")))?
}

/// Morph animé pose A → pose B : chaque objet part de sa position dans
/// la pose A (fallback live si absent de A) et rampe vers sa position
/// dans la pose B. La distribution est définie par B.
#[tauri::command]
pub async fn pose_morph(
    from_pose: String,
    to_pose: String,
    duration: Option<f64>,
    easing: Option<String>,
    state: State<'_, AppState>,
) -> Result<PoseGotoResult, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        morph_pose(&sh, &from_pose, &to_pose, duration, easing)
    })
    .await
    .map_err(|e| IpcError::io(format!("pose_morph task failed: {e}")))?
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
        eprintln!(
            "[POSE] capture '{name}' — tracks skippées (pas de position connue): {skipped:?}"
        );
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

/// Construit le graphe standard `poseramp → output` d'un goto —
/// référentiel (`from: "live"`, `to: "pose:<name>"`), résolution au
/// compile. `n` = taille de la distribution pré-filtrée.
pub(crate) fn poseramp_graph_json(
    n: usize,
    from_spec: &str,
    pose_name: &str,
    duration: f64,
    easing: &str,
) -> stagespace_engines::GraphJson {
    let node =
        |id: &str, node_type: &str, params: serde_json::Value| stagespace_engines::GraphNodeJson {
            id: id.to_string(),
            rf_type: None,
            data: stagespace_engines::GraphNodeData {
                node_type: Some(node_type.to_string()),
                params,
            },
            position: None,
        };
    let edge = |source: &str, target: &str, sh: &str, th: &str| stagespace_engines::GraphEdgeJson {
        source: source.to_string(),
        target: target.to_string(),
        sourceHandle: Some(sh.to_string()),
        targetHandle: Some(th.to_string()),
    };
    stagespace_engines::GraphJson {
        schema_version: Some(stagespace_engines::GRAPH_JSON_SCHEMA_VERSION),
        nodes: vec![
            node("obj-1", "Objects", serde_json::json!({"n_objects": n})),
            node(
                "dur-1",
                "Duration",
                serde_json::json!({"duration": duration}),
            ),
            node(
                "ramp-1",
                "PoseRamp",
                serde_json::json!({
                    "n_objects": n,
                    "from": from_spec,
                    "to": format!("pose:{pose_name}"),
                    "easing": easing,
                }),
            ),
            node("out-1", "Output", serde_json::json!({})),
        ],
        edges: vec![
            edge("obj-1", "ramp-1", "objects", "objects"),
            edge("dur-1", "ramp-1", "duration", "duration"),
            edge("ramp-1", "out-1", "out", "in"),
        ],
    }
}

/// Goto animé vers une pose — logique pure testable. Pré-filtre la
/// distribution (pose ∩ patchée ∩ non parkée ∩ non-PSN), spawne le
/// graphe poseramp standard en oneshot+hold avec capture-then-clear.
pub(crate) fn goto_pose(
    sh: &Shared,
    name: &str,
    duration: Option<f64>,
    easing: Option<String>,
) -> Result<PoseGotoResult, IpcError> {
    spawn_pose_ramp(sh, "live", name, duration, easing, "goto")
}

/// Morph animé pose A → pose B (P3, design §4.4) : la distribution est
/// définie par la **cible** B (une track dans A mais pas B ne participe
/// pas). Les objets absents de A partent de leur position live —
/// fallback du resolver au compile (matrice §7). Même mécanique de
/// spawn que le goto : oneshot + hold + capture-then-clear.
pub(crate) fn morph_pose(
    sh: &Shared,
    from_pose: &str,
    to_pose: &str,
    duration: Option<f64>,
    easing: Option<String>,
) -> Result<PoseGotoResult, IpcError> {
    // La pose source doit exister — sinon le morph est une erreur de
    // config, pas un goto déguisé (l'opérateur a `pose_goto` pour ça).
    let src_exists = lock_or_recover(&sh.poses)
        .get(from_pose)
        .is_some_and(|p| !p.positions.is_empty());
    if !src_exists {
        return Err(IpcError::not_found(format!(
            "Pose source '{from_pose}' not found or empty"
        )));
    }
    spawn_pose_ramp(
        sh,
        &format!("pose:{from_pose}"),
        to_pose,
        duration,
        easing,
        "morph",
    )
}

/// Corps partagé goto/morph — spawn du graphe poseramp standard avec
/// `from_spec` ("live" ou "pose:<name>") vers la pose `name`. Le
/// graphe est référentiel : la résolution (live/pose, fallbacks) se
/// fait au compile via le resolver injecté par le chemin de spawn.
fn spawn_pose_ramp(
    sh: &Shared,
    from_spec: &str,
    name: &str,
    duration: Option<f64>,
    easing: Option<String>,
    kind: &str,
) -> Result<PoseGotoResult, IpcError> {
    let duration = duration.unwrap_or(2.0);
    if !(duration.is_finite() && duration > 0.0 && duration <= 3600.0) {
        return Err(IpcError::validation(format!(
            "goto duration must be in (0, 3600], got {duration}"
        )));
    }
    let easing = easing.unwrap_or_else(|| "smooth".to_string());
    let pose = lock_or_recover(&sh.poses).get(name).cloned();
    let Some(pose) = pose else {
        return Err(IpcError::not_found(format!("Pose '{name}' not found")));
    };
    if pose.positions.is_empty() {
        return Err(IpcError::validation(format!("Pose '{name}' is empty")));
    }

    // Pré-filtrage de la distribution (design §7) : tracks de la pose
    // ∩ patchées ∩ non parkées ∩ non-PSN — la résolution compile est
    // alors totale par construction.
    let (tracks, skipped) = {
        let merge = lock_or_recover(&sh.merge_runtime);
        let patched = merge.osc_ids();
        let parked = merge.parked_objects();
        let psn = merge.psn_objects();
        let mut tracks: Vec<u32> = Vec::new();
        let mut skipped: Vec<u32> = Vec::new();
        let mut sorted: Vec<u32> = pose.positions.keys().copied().collect();
        sorted.sort_unstable();
        for track in sorted {
            let Some(obj) = patched.iter().position(|id| *id == track) else {
                skipped.push(track); // non patchée
                continue;
            };
            if parked.contains(&obj) || psn.contains(&obj) {
                skipped.push(track); // intouchable — la priorité tranche
                continue;
            }
            tracks.push(track);
        }
        (tracks, skipped)
    };
    if tracks.is_empty() {
        return Err(IpcError::validation(format!(
            "Pose '{name}' — aucune track mobile (non patchées/parkées/PSN : {skipped:?})"
        )));
    }

    let n = tracks.len();
    let track_indices: Vec<usize> = {
        let merge = lock_or_recover(&sh.merge_runtime);
        let patched = merge.osc_ids();
        tracks
            .iter()
            .filter_map(|t| patched.iter().position(|id| id == t))
            .collect()
    };

    let movement_id = format!(
        "pose-{}-{}-{}",
        kind,
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let spec = MoveSpec {
        id: movement_id.clone(),
        name: format!("{kind} {name}"),
        graph_json: poseramp_graph_json(n, from_spec, name, duration, &easing),
        osc_ids: tracks,
        track_indices,
        is_preview: false,
        // Positions canoniques absolues — l'ancre monde du move doit
        // être nulle, sinon les cibles seraient translatées.
        origin: Some([0.0, 0.0, 0.0]),
        duration,
        loop_mode: stagespace_engines::LoopMode::OneShot,
        direction: stagespace_engines::PlayDirection::Forward,
        fade: None,
        speed: None,
        spatial_macros: None,
        animation_state: None,
        signal_graph: None,
        // Hold : la cible est tenue exactement à la fin — la pose est
        // atteinte et enchaînable (register_move consomme les holds).
        end_mode: stagespace_engines::EndMode::Hold,
        anchor_mode: stagespace_engines::AnchorMode::Origin,
        anchor_target: None,
        anchor_pose: None,
        // Takeover explicite (design §6.9) — sans ça la rampe serait
        // masquée par les positions manuelles puis l'objet sauterait.
        clear_manual_positions: true,
    };
    spawn_move(spec, sh)?;
    if !skipped.is_empty() {
        eprintln!(
            "[POSE] {kind} '{name}' — tracks exclues (non patchées/parkées/PSN): {skipped:?}"
        );
    }
    Ok(PoseGotoResult {
        movement_id,
        objects: n,
        skipped,
    })
}
