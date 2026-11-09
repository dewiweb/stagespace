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
        let (generation, held_positions, signal_graph_json) = {
            let movements = lock_or_recover(&sh.movements);
            let movement = movements.get(&movement_id).ok_or_else(|| {
                IpcError::not_found(format!("Movement '{movement_id}' not found"))
            })?;
            (
                movement.generation,
                movement.runtime.held_positions(),
                movement.signal_graph.clone(),
            )
        };

        let audio_state = lock_or_recover(&sh.audio_state);
        let graph =
            build_graph_from_json(&graph_json, &audio_state).map_err(IpcError::validation)?;

        // Compile avec toutes les entrées live (audio + OSC reçus + plugins).
        // Une table de slots par recompile : position_fn + sample_fn +
        // signal_fn la partagent (swap_compiled atomique — jamais de
        // signal_fn appariée à une position_fn d'un autre compile).
        let slots = stagespace_engines::param_slots::ParamSlots::build(&graph);
        let compiled = compile_graph_live(
            &graph,
            &sh,
            Some(slots.clone()),
            Some(held_positions.clone()),
        )
        .map_err(IpcError::validation)?;
        // Instance jetable pour le TrajectorySampler — même table de slots.
        let sample_fn = compile_graph_live(&graph, &sh, Some(slots.clone()), Some(held_positions))
            .map_err(IpcError::validation)?;

        // Le signal graph du move est recompilé avec le graphe — les
        // cibles `param:` sont re-liées à la nouvelle table de slots.
        let signal_fn = match signal_graph_json {
            Some(ref sig_json) if !sig_json.nodes.is_empty() => {
                let sig_graph = build_graph_from_json(sig_json, &audio_state)
                    .map_err(|e| IpcError::validation(format!("Signal graph parse failed: {e}")))?;
                stagespace_engines::compile_move_signal_graph(&sig_graph, &graph, &slots).map_err(
                    |e| IpcError::validation(format!("Signal graph compile failed: {e:?}")),
                )?
            }
            _ => stagespace_engines::empty_signal_fn(),
        };
        drop(audio_state);

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
        // Swap atomique position_fn + sample_fn + signal_fn + slots (avec
        // crossfade — feature live) : le worker n'apparie jamais une
        // signal_fn avec une position_fn d'un autre compile. AVANT set_osc_ids.
        movement
            .runtime
            .swap_compiled_with_fade(compiled, sample_fn, signal_fn, slots, fade);
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
        match movement_id {
            None => {
                // Scope global : cibles macros uniquement — `param:` est une
                // erreur de compile (pas de nodes de move à moduler).
                let signal_fn = if graph_json.nodes.is_empty() {
                    stagespace_engines::signal_compiler::empty_signal_fn()
                } else {
                    let audio_state = lock_or_recover(&sh.audio_state);
                    let graph = build_graph_from_json(&graph_json, &audio_state).map_err(|e| {
                        IpcError::validation(format!("Failed to parse signal graph: {e}"))
                    })?;
                    drop(audio_state);
                    stagespace_engines::compile_signal_graph(&graph).map_err(|e| {
                        IpcError::validation(format!("Failed to compile signal graph: {e:?}"))
                    })?
                };
                lock_or_recover(&sh.merge_runtime).swap_signal_fn(signal_fn);
                Ok("Global signal graph hot-swapped".to_string())
            }
            Some(id) => {
                // Scope per-move : le graphe du move est recompilé AVEC le
                // signal — une table de slots commune, swap_compiled
                // atomique (les cibles `param:` se re-lient à la nouvelle
                // table, aucun stale possible).
                let (generation, held_positions, move_graph_json) = {
                    let movements = lock_or_recover(&sh.movements);
                    let movement = movements
                        .get(&id)
                        .ok_or_else(|| IpcError::not_found(format!("Movement '{id}' not found")))?;
                    (
                        movement.generation,
                        movement.runtime.held_positions(),
                        movement.graph_json.clone(),
                    )
                };
                let audio_state = lock_or_recover(&sh.audio_state);
                let move_graph = build_graph_from_json(&move_graph_json, &audio_state)
                    .map_err(|e| IpcError::validation(format!("Move graph parse failed: {e}")))?;
                let slots = stagespace_engines::param_slots::ParamSlots::build(&move_graph);
                let compiled = compile_graph_live(
                    &move_graph,
                    &sh,
                    Some(slots.clone()),
                    Some(held_positions.clone()),
                )
                .map_err(IpcError::validation)?;
                let sample_fn =
                    compile_graph_live(&move_graph, &sh, Some(slots.clone()), Some(held_positions))
                        .map_err(IpcError::validation)?;
                let signal_fn = if graph_json.nodes.is_empty() {
                    stagespace_engines::signal_compiler::empty_signal_fn()
                } else {
                    let sig_graph =
                        build_graph_from_json(&graph_json, &audio_state).map_err(|e| {
                            IpcError::validation(format!("Failed to parse signal graph: {e}"))
                        })?;
                    stagespace_engines::compile_move_signal_graph(&sig_graph, &move_graph, &slots)
                        .map_err(|e| {
                        IpcError::validation(format!("Failed to compile signal graph: {e:?}"))
                    })?
                };
                drop(audio_state);

                let mut movements = lock_or_recover(&sh.movements);
                let movement = movements.get_mut(&id).ok_or_else(|| {
                    IpcError::conflict(format!("Movement '{id}' stopped during recompile"))
                })?;
                if movement.generation != generation {
                    return Err(IpcError::conflict(format!(
                        "Movement '{id}' was respawned during compile — retry the edit"
                    )));
                }
                movement.signal_graph = Some(graph_json);
                movement
                    .runtime
                    .swap_compiled(compiled, sample_fn, signal_fn, slots);
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
        merge_rt.set_graph_effects(effects.zones, effects.modulations, effects.move_ref);
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

/// Diagnostics live du graphe — la source de vérité des règles reste le
/// backend (le frontend interroge en continu pour surligner les nodes).
/// Un échec de parse n'est pas une erreur IPC : c'est un seul issue Error.
#[tauri::command]
pub async fn diagnose_graph(
    graph_json: stagespace_engines::GraphJson,
    context: String,
    move_graph_json: Option<stagespace_engines::GraphJson>,
    state: State<'_, AppState>,
) -> Result<Vec<stagespace_engines::GraphIssue>, IpcError> {
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        diagnose_graph_inner(graph_json, &context, move_graph_json, &sh)
    })
    .await
    .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
}

/// Corps synchrone de `diagnose_graph` — testable hors Tauri.
pub fn diagnose_graph_inner(
    graph_json: stagespace_engines::GraphJson,
    context: &str,
    move_graph_json: Option<stagespace_engines::GraphJson>,
    sh: &crate::commands::state::Shared,
) -> Result<Vec<stagespace_engines::GraphIssue>, IpcError> {
    {
        let audio_state = lock_or_recover(&sh.audio_state);
        let ctx = match context {
            "sub" => stagespace_engines::GraphContext::SubGraph,
            "global" => stagespace_engines::GraphContext::Global,
            "signal" => stagespace_engines::GraphContext::Signal,
            other => {
                return Err(IpcError::validation(format!(
                    "unknown graph context '{other}' (sub|global|signal)"
                )))
            }
        };
        let move_graph = match move_graph_json {
            Some(mg) => match build_graph_from_json(&mg, &audio_state) {
                Ok(g) => Some(g),
                Err(e) => {
                    return Ok(vec![stagespace_engines::GraphIssue {
                        severity: stagespace_engines::IssueSeverity::Error,
                        message: format!("move graph parse failed: {e}"),
                        node_ids: vec![],
                    }])
                }
            },
            None => None,
        };
        let graph = match build_graph_from_json(&graph_json, &audio_state) {
            Ok(g) => g,
            Err(e) => {
                return Ok(vec![stagespace_engines::GraphIssue {
                    severity: stagespace_engines::IssueSeverity::Error,
                    message: format!("graph parse failed: {e}"),
                    node_ids: vec![],
                }])
            }
        };
        Ok(stagespace_engines::diagnose(
            &graph,
            ctx,
            move_graph.as_ref(),
        ))
    }
}
