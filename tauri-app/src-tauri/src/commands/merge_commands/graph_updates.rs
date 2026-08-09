//! Hot-swap de graphs : update_move_graph_merged (sub-graph) + update_global_graph (post-process)

use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use tauri::State;

use super::lock_or_recover;

/// Hot-swap le graphe d'un move (worker) en cours
#[tauri::command]
pub async fn update_move_graph_merged(
    movement_id: String,
    graph_json: serde_json::Value,
    fade_duration: Option<f64>,
    duration: Option<f64>,
    osc_ids: Option<Vec<u32>>,
    track_indices: Option<Vec<usize>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut movements = lock_or_recover(&state.movements);
    let movement = movements
        .get_mut(&movement_id)
        .ok_or_else(|| format!("Movement '{movement_id}' not found"))?;

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let overrides = movement.runtime.audio_param_overrides();
    let compiled =
        compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)?;

    // Hot-swap la duration si fournie
    if let Some(dur) = duration {
        movement.runtime.set_duration(dur);
    }

    // Mettre à jour les osc_ids et track_indices du move si fournis
    if let Some(ref ids) = osc_ids {
        movement.osc_ids = ids.clone();
    }
    if let Some(ref indices) = track_indices {
        movement.track_indices = indices.clone();
    }

    // Mettre à jour le MoveState dans le MergeRuntime (pour le merge)
    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        if let Some(ref ids) = osc_ids {
            merge_rt.update_move_osc_ids(&movement_id, ids.clone());
        }
        if let Some(ref indices) = track_indices {
            merge_rt.update_move_track_indices(&movement_id, indices.clone());
        }
    }

    let fade = fade_duration.unwrap_or(0.3);
    // IMPORTANT: recall_cue (swap position_fn) AVANT set_osc_ids.
    movement.runtime.recall_cue(compiled, fade);
    if let Some(ref ids) = osc_ids {
        movement.runtime.set_osc_ids(ids.clone());
    }

    Ok(format!("Move '{movement_id}' graph hot-swapped"))
}

/// Compile et hot-swap le graph global (post-processing)
#[tauri::command]
pub async fn update_global_graph(
    graph_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_state = {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt
            .audio_state_arc()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    };

    let graph = build_graph_from_json(&graph_json, &audio_state)
        .map_err(|e| format!("Failed to parse global graph: {e}"))?;

    let merge_rt = lock_or_recover(&state.merge_runtime);
    let macros = merge_rt.macros();

    let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

    let post_process_fn = stagespace_engines::compile_post_process(compile_params)
        .map_err(|e| format!("Failed to compile global graph: {e:?}"))?;

    merge_rt.swap_post_process_fn(post_process_fn);

    Ok(())
}
