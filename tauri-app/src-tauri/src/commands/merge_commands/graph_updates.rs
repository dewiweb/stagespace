//! Hot-swap de graphs : update_move_graph_merged (sub-graph) + update_global_graph (post-process)

use crate::commands::state::Shared;
use crate::graph::compilation::compile_graph_live;
use crate::graph::parser::build_graph_from_json;
use crate::AppState;
use tauri::State;

use super::lock_or_recover;
use crate::commands::error::IpcError;

/// Hot-swap le graphe d'un move (worker) en cours
#[tauri::command]
pub async fn update_move_graph_merged(
    movement_id: String,
    graph_json: stagespace_engines::GraphJson,
    fade_duration: Option<f64>,
    duration: Option<f64>,
    osc_ids: Option<Vec<u32>>,
    track_indices: Option<Vec<usize>>,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    // spawn_blocking : la compilation est un travail CPU lourd — inline elle
    // bloquerait un thread de l'executor async (dispatch IPC gelé).
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        // Snapshot court sous le lock — la compilation (lourde) se fait ensuite
        // SANS tenir `movements`, sinon tout edit live gèle stop/panic/recall.
        let (generation, param_overrides) = {
            let movements = lock_or_recover(&sh.movements);
            let movement = movements.get(&movement_id).ok_or_else(|| {
                IpcError::not_found(format!("Movement '{movement_id}' not found"))
            })?;
            let generation = movement.generation;
            let param_overrides = movement.runtime.param_overrides();
            (generation, param_overrides)
        };

        let audio_state = lock_or_recover(&sh.audio_state);
        let graph =
            build_graph_from_json(&graph_json, &audio_state).map_err(IpcError::validation)?;
        drop(audio_state);

        // Compile avec toutes les entrées live (audio + OSC reçus + plugins).
        let compiled =
            compile_graph_live(&graph, &sh, Some(param_overrides)).map_err(IpcError::validation)?;

        // Ré-application sous lock, avec check de génération — le move a pu être
        // stoppé puis respawné pendant la compile : dans ce cas on applique au
        // worker ACTUEL (même id, nouvelle génération) plutôt qu'au fantôme.
        let mut movements = lock_or_recover(&sh.movements);
        let movement = movements.get_mut(&movement_id).ok_or_else(|| {
            IpcError::conflict(format!("Movement '{movement_id}' stopped during recompile"))
        })?;
        if movement.generation != generation {
            // Le graphe a été compilé pour l'ANCIEN contexte (n_objects,
            // tracks) — l'appliquer au worker respawné donnerait des objets
            // muets ou des agents fantômes, silencieusement (audit I13).
            // On refuse : le frontend peut relancer l'edit.
            return Err(IpcError::conflict(format!(
                "Movement '{movement_id}' was respawned during compile — retry the edit"
            )));
        }

        // Hot-swap la duration si fournie — ET le snapshot, sinon store_cue
        // capture la durée d'avant l'edit et recall_cue la ressuscite.
        if let Some(dur) = duration {
            if !dur.is_finite() || dur <= 0.0 {
                return Err(IpcError::validation(
                    "duration must be a finite positive number",
                ));
            }
            movement.runtime.set_duration(dur);
            movement.duration = dur;
        }
        // Même invariant pour le graphe : le snapshot sert à store_cue/recall_cue.
        movement.graph_json = graph_json;

        // Mettre à jour les osc_ids et track_indices du move si fournis
        if let Some(ref ids) = osc_ids {
            movement.osc_ids = ids.clone();
        }
        if let Some(ref indices) = track_indices {
            movement.track_indices = indices.clone();
        }

        // Mettre à jour le MoveState dans le MergeRuntime — update atomique
        // des deux côtés du routage quand ils sont fournis ensemble.
        {
            let merge_rt = lock_or_recover(&sh.merge_runtime);
            match (&osc_ids, &track_indices) {
                (Some(ids), Some(indices)) => {
                    merge_rt.update_move_routing(&movement_id, ids.clone(), indices.clone())
                }
                (Some(ids), None) => merge_rt.update_move_osc_ids(&movement_id, ids.clone()),
                (None, Some(indices)) => {
                    merge_rt.update_move_track_indices(&movement_id, indices.clone())
                }
                (None, None) => {}
            }
        }

        let fade = fade_duration.unwrap_or(0.3);
        if !fade.is_finite() || fade < 0.0 {
            return Err(IpcError::validation(
                "fade_duration must be a finite non-negative number",
            ));
        }
        // IMPORTANT: recall_cue (swap position_fn) AVANT set_osc_ids.
        movement.runtime.recall_cue(compiled, fade);
        if let Some(ref ids) = osc_ids {
            movement.runtime.set_osc_ids(ids.clone());
        }

        Ok(format!("Move '{movement_id}' graph hot-swapped"))
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
}

/// Compile et hot-swap le graph de modulation (domaine signal → deltas
/// de macros). `movement_id = None` → scope global (MergeRuntime) ;
/// `Some(id)` → scope per-move (worker du move). Dans les deux cas le
/// swap est atomique : la frame suivante évalue la nouvelle SignalFn.
/// La validation `GraphContext::Signal` rejette tout node non-signal.
/// Un graph vide (aucun node) reset la modulation — `empty_signal_fn`.
#[tauri::command]
pub async fn update_signal_graph(
    graph_json: stagespace_engines::GraphJson,
    movement_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let signal_fn = if graph_json.nodes.is_empty() {
            stagespace_engines::signal_compiler::empty_signal_fn()
        } else {
            let audio_state = lock_or_recover(&sh.audio_state);
            let graph = build_graph_from_json(&graph_json, &audio_state)
                .map_err(|e| IpcError::validation(format!("Failed to parse signal graph: {e}")))?;
            drop(audio_state);

            stagespace_engines::compile_signal_graph(&graph).map_err(|e| {
                IpcError::validation(format!("Failed to compile signal graph: {e:?}"))
            })?
        };

        match movement_id {
            None => {
                lock_or_recover(&sh.merge_runtime).swap_signal_fn(signal_fn);
                Ok("Global signal graph hot-swapped".to_string())
            }
            Some(id) => {
                let movements = lock_or_recover(&sh.movements);
                let movement = movements
                    .get(&id)
                    .ok_or_else(|| IpcError::not_found(format!("Movement '{id}' not found")))?;
                movement.runtime.swap_signal_fn(signal_fn);
                Ok(format!("Signal graph hot-swapped on move '{id}'"))
            }
        }
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
}

/// Compile et hot-swap le graph global (post-processing)
#[tauri::command]
pub async fn update_global_graph(
    graph_json: stagespace_engines::GraphJson,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let audio_state = {
            let merge_rt = lock_or_recover(&sh.merge_runtime);
            merge_rt
                .audio_state_arc()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };

        let graph = build_graph_from_json(&graph_json, &audio_state)
            .map_err(|e| IpcError::validation(format!("Failed to parse global graph: {e}")))?;

        // Extraire les effets déclarés dans le graph (nodes Zone/Velocity)
        // avant que le graph soit consommé par la compilation.
        let effects = stagespace_engines::extract_graph_effects(&graph)
            .map_err(|e| IpcError::internal(format!("Failed to extract graph effects: {e:?}")))?;

        // Snapshot des macros (Arc clonable) sous lock court — la compilation du
        // post-process se fait SANS tenir `merge_runtime` (le thread merge lit
        // les macros par Arc à chaque frame, pas besoin du lock pendant la compile).
        let macros = lock_or_recover(&sh.merge_runtime).macros();

        let compile_params = stagespace_engines::PostProcessCompileParams { graph, macros };

        let post_process_fn = stagespace_engines::compile_post_process(compile_params)
            .map_err(|e| IpcError::internal(format!("Failed to compile global graph: {e:?}")))?;

        let merge_rt = lock_or_recover(&sh.merge_runtime);
        merge_rt.swap_post_process_fn(post_process_fn);
        merge_rt.set_graph_effects(
            effects.zones,
            effects.modulations,
            effects.barycenter,
            effects.move_ref,
        );
        // Le node Merge peut déclarer la stratégie de résolution de conflit
        // (param `strategy`) — appliquée à chaque push du graphe global.
        if let Some(strategy) = effects.strategy {
            merge_rt.set_merge_strategy(strategy);
        }

        Ok(())
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
}
