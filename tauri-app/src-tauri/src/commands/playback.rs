use super::error::IpcError;
use super::state::lock_or_recover;
use crate::commands::merge_commands::{
    remove_move_now, resolve_track_indices, spawn_move, MoveSpec,
};
use crate::commands::state::Shared;
use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use serde::Deserialize;
use stagespace_engines::{LoopMode, PlayDirection};
use tauri::State;

/// Ids réservés aux moves du graphe "expert" (legacy play/preview).
/// Ce sont des workers MergeRuntime comme les autres — une seule stream OSC.
const GRAPH_MAIN_ID: &str = "graph-main";
const GRAPH_PREVIEW_ID: &str = "graph-preview";

/// Les champs osc_* sont conservés pour compat IPC mais ignorés — la cible
/// OSC appartient au MergeRuntime.
#[derive(Deserialize)]
#[allow(non_snake_case, dead_code)]
pub struct PlayGraphRequest {
    pub graph_json: serde_json::Value,
    #[serde(rename = "osc_address")]
    pub oscAddress: String,
    #[serde(rename = "osc_port")]
    pub oscPort: u16,
    #[serde(rename = "osc_ids")]
    pub oscIds: Vec<u32>,
    #[serde(rename = "osc_profile")]
    pub oscProfile: String,
}

/// Joue le graphe courant en live via `spawn_move` — l'OSC sort par le
/// MergeRuntime (une seule stream, fades/zones/post-processing couverts).
/// `oscAddress`/`oscPort`/`oscProfile` sont ignorés : la cible OSC
/// appartient au MergeRuntime.
#[tauri::command]
pub async fn play_graph(
    request: PlayGraphRequest,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        // Remplacement : un graph-main existant est stoppé proprement d'abord.
        remove_move_now(GRAPH_MAIN_ID, &sh);
        remove_move_now(GRAPH_PREVIEW_ID, &sh);
        let spec = MoveSpec {
            id: GRAPH_MAIN_ID.to_string(),
            name: "Graph".to_string(),
            graph_json: request.graph_json,
            osc_ids: request.oscIds.clone(),
            track_indices: resolve_track_indices(&sh.merge_runtime, &request.oscIds),
            is_preview: false,
            origin: None,
            duration: 4.0,
            loop_mode: LoopMode::Loop,
            direction: PlayDirection::Forward,
            fade: None,
            speed: None,
            spatial_macros: None,
            animation_state: None,
        };
        spawn_move(spec, &sh).map(|_| "Graph playback started".to_string())
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
    .map_err(IpcError::from)
}

/// Preview mode — joue la trajectoire SANS envoyer d'OSC (le merge route les
/// positions preview vers le callback display uniquement).
#[tauri::command]
pub async fn preview_graph(
    request: PlayGraphRequest,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        remove_move_now(GRAPH_PREVIEW_ID, &sh);
        let spec = MoveSpec {
            id: GRAPH_PREVIEW_ID.to_string(),
            name: "Graph preview".to_string(),
            graph_json: request.graph_json,
            osc_ids: request.oscIds.clone(),
            track_indices: resolve_track_indices(&sh.merge_runtime, &request.oscIds),
            is_preview: true,
            origin: None,
            duration: 4.0,
            loop_mode: LoopMode::Loop,
            direction: PlayDirection::Forward,
            fade: None,
            speed: None,
            spatial_macros: None,
            animation_state: None,
        };
        spawn_move(spec, &sh).map(|_| "Preview started (no OSC sent)".to_string())
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn stop_graph(state: State<'_, AppState>) -> Result<String, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let a = remove_move_now(GRAPH_MAIN_ID, &sh);
        let b = remove_move_now(GRAPH_PREVIEW_ID, &sh);
        if a || b {
            "Graph playback stopped".to_string()
        } else {
            "No graph playback active".to_string()
        }
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))
}

/// Hot-swap le graphe en cours de lecture — recompile et remplace la
/// position_fn avec crossfade pour éviter les sauts de position.
#[tauri::command]
pub async fn update_graph(
    graph_json: serde_json::Value,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    // Snapshot court sous le lock — la compilation se fait hors du lock
    // `movements` (sinon un edit de graphe pendant un show gèle stop/panic).
    let (target_id, generation, overrides) = {
        let movements = lock_or_recover(&state.movements);
        // Cible : le move graphe actif (live prioritaire, sinon preview)
        let target_id = if movements.contains_key(GRAPH_MAIN_ID) {
            GRAPH_MAIN_ID
        } else {
            GRAPH_PREVIEW_ID
        };
        let movement = movements
            .get(target_id)
            .ok_or_else(|| IpcError::not_found("No runtime active — call play_graph first"))?;
        (
            target_id,
            movement.generation,
            movement.runtime.audio_param_overrides(),
        )
    };

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state).map_err(IpcError::from)?;
    drop(audio_state);

    let compiled =
        compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)
            .map_err(IpcError::from)?;

    // Ré-application sous lock — si le move a été stoppé pendant la compile
    // on signale l'échec plutôt que d'appliquer en silence à un fantôme.
    let mut movements = lock_or_recover(&state.movements);
    let movement = movements
        .get_mut(target_id)
        .ok_or_else(|| IpcError::conflict("Graph playback stopped during recompile"))?;
    if movement.generation != generation {
        eprintln!("[WARN] update_graph: '{target_id}' respawned during compile");
    }

    // Crossfade smooth (défaut 0.5s) pour éviter les sauts
    let fade = fade_duration.unwrap_or(0.5);
    movement.runtime.recall_cue(compiled, fade);
    // Snapshot à jour pour les cues
    movement.graph_json = graph_json;

    Ok("Graph hot-swapped with crossfade".to_string())
}

// ── Live commands : macros, loop mode, cue recall ──────────────────────────

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct SetMacroRequest {
    pub speed: Option<f64>,
    pub scale: Option<f64>,
    pub shiftX: Option<f64>,
    pub shiftY: Option<f64>,
    pub shiftZ: Option<f64>,
    pub yaw: Option<f64>,
    pub pitch: Option<f64>,
    pub roll: Option<f64>,
    pub radius_scale: Option<f64>,
    pub height_offset: Option<f64>,
}

/// Macros du chemin "graphe expert" : appliquées au worker graph-main /
/// graph-preview s'il tourne, sinon aux macros globales du MergeRuntime
/// (les réglages survivront au prochain play).
#[tauri::command]
pub async fn set_macro(
    request: SetMacroRequest,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let macros = {
        let movements = lock_or_recover(&state.movements);
        movements
            .get(GRAPH_MAIN_ID)
            .or_else(|| movements.get(GRAPH_PREVIEW_ID))
            .map(|m| m.runtime.macros())
    };
    let macros = match macros {
        Some(m) => m,
        None => lock_or_recover(&state.merge_runtime).macros(),
    };
    if let Some(s) = request.speed {
        macros.set_speed(s);
    }
    if let Some(s) = request.scale {
        macros.set_scale(s);
    }
    // Shift: partial update
    let current_shift = macros.get_shift();
    macros.set_shift(
        request.shiftX.unwrap_or(current_shift.x),
        request.shiftY.unwrap_or(current_shift.y),
        request.shiftZ.unwrap_or(current_shift.z),
    );
    // Rotation: partial update
    let (cy, cp, cr) = macros.get_rotation();
    macros.set_rotation(
        request.yaw.unwrap_or(cy),
        request.pitch.unwrap_or(cp),
        request.roll.unwrap_or(cr),
    );
    // radius_scale + height_offset
    if let Some(v) = request.radius_scale {
        macros.set_radius_scale(v);
    }
    if let Some(v) = request.height_offset {
        macros.set_height_offset(v);
    }
    Ok(())
}
