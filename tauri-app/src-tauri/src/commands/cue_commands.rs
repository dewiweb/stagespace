//! Commands Tauri pour le cuelist (Phase 3 — cue system étendu).
//!
//! Store : snapshot complet (graph, macros, tracks, global graph, depths, manual positions)
//! Recall : désactiver/activer moves, hot-swap global graph, restaurer macros/depths/positions

use super::state::lock_or_recover;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use serde::Deserialize;
use stagespace_engines::{Cue, MacroSnapshot, SpatialMacroSnapshot};
use std::sync::atomic::AtomicBool;
use tauri::{Emitter, State};

/// RAII guard : remet recall_in_progress à false quand droppé (même si recall panique)
struct RecallGuard<'a>(&'a AtomicBool);
impl Drop for RecallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

// ─── Store Cue ───

/// Données pour stocker un cue (envoyées par le frontend)
#[derive(Debug, Deserialize)]
pub struct StoreCueRequest {
    pub name: String,
    pub description: String,
    /// Sub-graph du move (graph_json)
    pub graph: serde_json::Value,
    /// Macros per-move (speed, scale, shift, rotation)
    pub macros: Option<MacroSnapshot>,
    /// Macros spatiales étendues (radius_scale, height_offset)
    pub spatial_macros: Option<SpatialMacroSnapshot>,
    /// Indices des tracks ciblées
    pub track_indices: Vec<usize>,
    /// Durée du crossfade
    pub fade_duration: f64,
    /// Numéro de cue
    pub cue_number: Option<String>,
    // ─── Phase 3 : champs étendus ───
    /// Graph global (post-processing)
    pub global_graph: Option<serde_json::Value>,
    /// IDs des moves actifs
    pub active_move_ids: Vec<String>,
    /// Profondeurs par track
    pub per_track_depths: Vec<f64>,
    /// Positions manuelles (drag 3D)
    pub manual_positions: std::collections::HashMap<usize, [f64; 3]>,
}

/// Stocke un cue (snapshot complet)
#[tauri::command]
pub async fn store_cue(
    request: StoreCueRequest,
    state: State<'_, AppState>,
) -> Result<Cue, String> {
    let cue = Cue {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        description: request.description,
        graph: request.graph,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0),
        macros: request.macros,
        track_indices: request.track_indices,
        fade_duration: request.fade_duration,
        cue_number: request.cue_number,
        global_graph: request.global_graph,
        active_move_ids: request.active_move_ids,
        per_track_depths: request.per_track_depths,
        manual_positions: request.manual_positions,
        spatial_macros: request.spatial_macros,
    };

    // Émettre l'événement pour que le frontend persiste le cue
    state
        .app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|handle| handle.emit("cue-stored", &cue));

    Ok(cue)
}

// ─── Recall Cue ───

/// Rappelle un cue : désactiver/activer moves, hot-swap global graph, restaurer macros/depths/positions
#[tauri::command]
pub async fn recall_cue(cue: Cue, state: State<'_, AppState>) -> Result<(), String> {
    // Anti-recall concurrent : si un recall est déjà en cours, refuser
    if state
        .recall_in_progress
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return Err("A cue recall is already in progress — please wait.".to_string());
    }

    // Garantir que le flag est remis à false quoi qu'il arrive
    let _guard = RecallGuard(&state.recall_in_progress);

    // 1. Désactiver les moves qui ne sont pas dans active_move_ids
    {
        let movements = lock_or_recover(&state.movements);
        let active_ids: std::collections::HashSet<&str> =
            cue.active_move_ids.iter().map(|s| s.as_str()).collect();

        let to_deactivate: Vec<String> = movements
            .keys()
            .filter(|id| !active_ids.contains(id.as_str()))
            .cloned()
            .collect();

        drop(movements);

        for id in to_deactivate {
            // Stop le worker
            let mut movements = lock_or_recover(&state.movements);
            if let Some(movement) = movements.get_mut(&id) {
                movement.runtime.stop();
                if let Some(handle) = movement.thread_handle.take() {
                    drop(handle); // Le thread se terminera de lui-même
                }
            }
            // Unregister du merge runtime
            let merge_rt = lock_or_recover(&state.merge_runtime);
            merge_rt.unregister_move(&id);
        }
    }

    // 2. Hot-swap le graph global si présent
    if let Some(ref global_graph) = cue.global_graph {
        let audio_state = {
            let merge_rt = lock_or_recover(&state.merge_runtime);
            merge_rt
                .audio_state_arc()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };

        let graph = build_graph_from_json(global_graph, &audio_state)
            .map_err(|e| format!("Failed to parse global graph: {e}"))?;

        let merge_rt = lock_or_recover(&state.merge_runtime);
        let macros = merge_rt.macros();

        let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

        let post_process_fn = stagespace_engines::compile_post_process(compile_params)
            .map_err(|e| format!("Failed to compile global graph: {e:?}"))?;

        merge_rt.swap_post_process_fn(post_process_fn);
    }

    // 3. Restaurer les macros spatiales (fast path atomic)
    if let Some(ref macros) = cue.macros {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        let ms = merge_rt.macros();
        ms.set_scale(macros.scale);
        ms.set_shift(macros.shift_x, macros.shift_y, macros.shift_z);
        ms.set_rotation(macros.yaw, macros.pitch, macros.roll);
    }

    // 4. Restaurer les macros spatiales étendues
    if let Some(ref spatial) = cue.spatial_macros {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        let ms = merge_rt.macros();
        ms.set_radius_scale(spatial.radius_scale);
        ms.set_height_offset(spatial.height_offset);
    }

    // 5. Restaurer les per-track depths
    if !cue.per_track_depths.is_empty() {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt.set_track_depths(cue.per_track_depths.clone());
    }

    // 6. Restaurer les manual positions
    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt.clear_all_manual_positions();
        for (idx, pos) in &cue.manual_positions {
            merge_rt.set_manual_position(*idx, *pos);
        }
    }

    // 7. Activer les moves qui sont dans active_move_ids (avec fade)
    // Note: l'activation des moves est gérée par le frontend via activate_move,
    // car il faut compiler le sub-graph et créer un worker.
    // Le frontend écoutera l'événement "cue-recalled" et activera les moves.

    state
        .app_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|handle| handle.emit("cue-recalled", &cue));

    Ok(())
}

// ─── List / Delete ───

/// Liste les cues (depuis le frontend qui les persiste)
/// Note: les cues sont persistés côté frontend (localStorage), pas côté Rust.
/// Cette commande est un placeholder — le frontend gère la liste.
#[tauri::command]
pub async fn list_cues() -> Result<Vec<serde_json::Value>, String> {
    // Les cues sont gérés côté frontend (localStorage)
    // Cette commande existe pour compatibilité future
    Ok(vec![])
}

/// Supprime un cue (placeholder — géré côté frontend)
#[tauri::command]
pub async fn delete_cue(_cue_id: String) -> Result<(), String> {
    Ok(())
}
