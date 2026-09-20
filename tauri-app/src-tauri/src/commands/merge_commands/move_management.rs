//! Move management : activate, deactivate, deactivate_all, list, perf stats
//!
//! `spawn_move` est le chemin unique de création d'un worker move —
//! utilisé par `activate_move`, `launch_animation` et le recall de cue.
//! Il garantit : réservation d'id (anti-doublon/race), compile, worker
//! PositionBuffer, registration merge, démarrage du MergeRuntime, et
//! cleanup complet si une étape échoue.

use crate::commands::state::{lock_or_recover, Shared};
use crate::graph::compilation::compile_graph_with_audio_and_overrides;
use crate::graph::parser::build_graph_from_json;
use crate::{AppState, Movement, MAX_MOVEMENTS};
use serde::Deserialize;
use stagespace_engines::{
    AnimationState, EngineParams, LoopMode, OscSender, PlayDirection, PositionBuffer, Runtime,
};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize)]
#[allow(non_snake_case)]
pub struct ActivateMoveRequest {
    pub movement_id: String,
    pub name: String,
    pub graph_json: serde_json::Value,
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub is_preview: bool,
    /// Origin = isobarycentre des tracks ciblées [x, y, z]
    #[serde(default)]
    pub origin: Option<[f64; 3]>,
    /// Duration du move (pour loop)
    #[serde(default = "super::default_duration")]
    pub duration: f64,
    /// Loop mode : "loop" (défaut) ou "oneshot"
    #[serde(default = "super::default_loop_mode")]
    pub loop_mode: String,
    /// Direction : "forward" (défaut), "backward", ou "ping_pong"
    #[serde(default = "super::default_direction")]
    pub direction: String,
}

/// Spec complet pour créer un worker move — partagé entre activate_move,
/// launch_animation et recall_cue (restauration des snapshots).
pub(crate) struct MoveSpec {
    pub id: String,
    pub name: String,
    pub graph_json: serde_json::Value,
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub is_preview: bool,
    pub origin: Option<[f64; 3]>,
    pub duration: f64,
    pub loop_mode: LoopMode,
    pub direction: PlayDirection,
    /// Fades du worker (utilisé par launch_animation). NOTE: en mode worker
    /// (PositionBuffer) le runtime n'applique pas les fades — c'est le
    /// MergeRuntime qui fade via MoveState. Conservé pour compat/snapshot.
    pub fade: Option<(f64, f64)>,
    /// Macro speed per-move (appliquée dans le worker — effective en mode worker)
    pub speed: Option<f64>,
    /// AnimationState complet (animations — phase offsets + audio mods)
    pub animation_state: Option<AnimationState>,
}

pub(crate) fn loop_mode_label(mode: LoopMode) -> String {
    match mode {
        LoopMode::OneShot => "oneshot".to_string(),
        LoopMode::Loop => "loop".to_string(),
    }
}

pub(crate) fn direction_label(dir: PlayDirection) -> String {
    match dir {
        PlayDirection::Backward => "backward".to_string(),
        PlayDirection::PingPong => "ping_pong".to_string(),
        PlayDirection::Forward => "forward".to_string(),
    }
}

pub(crate) fn parse_loop_mode(s: &str) -> LoopMode {
    match s {
        "oneshot" => LoopMode::OneShot,
        _ => LoopMode::Loop,
    }
}

pub(crate) fn parse_direction(s: &str) -> PlayDirection {
    match s {
        "backward" => PlayDirection::Backward,
        "ping_pong" => PlayDirection::PingPong,
        _ => PlayDirection::Forward,
    }
}

/// RAII : retire l'id de `pending_move_ids` quand le guard est droppé
/// (succès ou échec — l'id est alors soit dans `movements`, soit nettoyé).
struct PendingGuard {
    id: String,
    pending: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        lock_or_recover(&self.pending).remove(&self.id);
    }
}

/// Crée et démarre un worker move : compile → Runtime → PositionBuffer →
/// movements.insert → merge.register_move → merge.start (si besoin).
///
/// Synchronous (lourd) — appeler depuis spawn_blocking ou un contexte bloquant.
///
/// Étapes de sécurité :
/// - l'id est réservé dans `pending_move_ids` avant la compile — les doublons
///   et les deactivate concurrents sont rejetés proprement ;
/// - si `merge_rt.start()` échoue, le worker est stoppé et l'entrée retirée
///   (pas de move fantôme qui streamerait dans le vide) ;
/// - si un recall de cue est en cours, l'activation est abandonnée avant
///   l'insertion (le recall est l'autorité sur la liste des moves).
pub(crate) fn spawn_move(spec: MoveSpec, sh: &Shared) -> Result<String, String> {
    spawn_move_inner(spec, sh, true)
}

/// Variante pour `recall_cue` : pendant un recall, `recall_in_progress` est
/// posé par le recall lui-même — le check "abort if recall in progress" ne
/// s'applique pas (le recall EST l'autorité sur la liste des moves).
pub(crate) fn spawn_move_for_recall(spec: MoveSpec, sh: &Shared) -> Result<String, String> {
    spawn_move_inner(spec, sh, false)
}

fn spawn_move_inner(spec: MoveSpec, sh: &Shared, abort_on_recall: bool) -> Result<String, String> {
    let id = spec.id.clone();
    eprintln!(
        "[ACTIVATE] id={} name={} tracks={:?}",
        id, spec.name, spec.track_indices
    );

    // 0. Réserver l'id — section critique pending → movements (ordre de locks).
    {
        let mut pending = lock_or_recover(&sh.pending_move_ids);
        let movements = lock_or_recover(&sh.movements);
        if pending.contains(&id) || movements.contains_key(&id) {
            return Err(format!(
                "Move '{id}' is already active or being activated — pick another id"
            ));
        }
        if movements.len() + pending.len() >= MAX_MOVEMENTS {
            return Err(format!(
                "Maximum {MAX_MOVEMENTS} movements reached — stop some first"
            ));
        }
        pending.insert(id.clone());
    }
    // Le guard libère l'id sur tous les chemins d'erreur qui suivent.
    let _guard = PendingGuard {
        id: id.clone(),
        pending: sh.pending_move_ids.clone(),
    };

    // 1. Compiler le sub-graph
    let graph = {
        let audio_state = lock_or_recover(&sh.audio_state);
        build_graph_from_json(&spec.graph_json, &audio_state).map_err(|e| {
            eprintln!("[ACTIVATE-ERROR] build_graph_from_json failed: {e}");
            e
        })?
    };

    // 2. Créer le worker Runtime (socket dédiée — jamais utilisée en mode
    //    worker : les positions partent dans le PositionBuffer, l'OSC est
    //    envoyé uniquement par le MergeRuntime).
    let runtime =
        Runtime::new("127.0.0.1".to_string(), 8000, OscSender::default()).map_err(|e| {
            eprintln!("[ACTIVATE-ERROR] Runtime::new failed: {e}");
            format!("Failed to create worker runtime: {e}")
        })?;

    // 3. Compiler avec audio + overrides
    let overrides = runtime.audio_param_overrides();
    let compiled =
        compile_graph_with_audio_and_overrides(&graph, sh.audio_state.clone(), overrides).map_err(
            |e| {
                eprintln!("[ACTIVATE-ERROR] compile_graph failed: {e}");
                e
            },
        )?;

    // 4. Configurer le worker
    runtime.set_preview_mode(spec.is_preview);
    runtime.set_loop_mode(spec.loop_mode);
    runtime.set_direction(spec.direction);
    if let Some((fade_in, fade_out)) = spec.fade {
        runtime.set_fade(fade_in, fade_out);
    }
    if let Some(speed) = spec.speed {
        runtime.macros().set_speed(speed);
    }
    if let Some(ref origin) = spec.origin {
        runtime.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
    }
    if let Some(anim_state) = spec.animation_state {
        runtime.set_animation_state(anim_state);
    }

    // 5. PositionBuffer → mode worker (le merge thread collecte les positions)
    let buffer = Arc::new(PositionBuffer::new());
    runtime.set_position_buffer(buffer.clone());

    let generation = sh.move_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let loop_mode_str = loop_mode_label(spec.loop_mode);
    let direction_str = direction_label(spec.direction);

    // 6. Démarrer le worker thread
    runtime
        .play_compiled(
            compiled,
            EngineParams {
                n_objects: spec.osc_ids.len(),
                duration: spec.duration,
                fps: 60.0,
                extra: serde_json::json!({}),
            },
            spec.osc_ids.clone(),
        )
        .map_err(|e| format!("Worker playback failed: {e}"))?;

    // 7. Un recall en cours est l'autorité sur la liste des moves —
    //    abandonner proprement plutôt que de ré-introduire un move que le
    //    recall vient de désactiver. Sauf si l'appel vient du recall
    //    lui-même (spawn_move_for_recall → abort_on_recall = false).
    if abort_on_recall && sh.recall_in_progress.load(Ordering::SeqCst) {
        runtime.stop();
        return Err("Cue recall in progress — activation aborted".to_string());
    }

    // 8. Enregistrer le movement
    {
        let mut movements = lock_or_recover(&sh.movements);
        movements.insert(
            id.clone(),
            Movement {
                id: id.clone(),
                name: spec.name.clone(),
                runtime,
                osc_ids: spec.osc_ids.clone(),
                is_preview: spec.is_preview,
                track_indices: spec.track_indices.clone(),
                graph_json: spec.graph_json.clone(),
                duration: spec.duration,
                loop_mode: loop_mode_str,
                direction: direction_str,
                origin: spec.origin,
                generation,
            },
        );
    }

    // 9. Enregistrer le move dans le MergeRuntime + le démarrer si besoin.
    //    Si le démarrage échoue → cleanup complet (unregister + remove + stop).
    {
        let mut merge_rt = lock_or_recover(&sh.merge_runtime);
        merge_rt.register_move(
            id.clone(),
            buffer,
            spec.osc_ids.clone(),
            spec.track_indices.clone(),
            spec.is_preview,
        );
        if let Some(ref origin) = spec.origin {
            merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));
        }

        if !merge_rt.is_running() {
            // Callback positions → event 'global-positions' (preview 3D).
            // Headless (tests/CLI) : pas d'app_handle → pas de callback, mais
            // le merge démarre quand même.
            if let Some(app_handle) = lock_or_recover(&sh.app_handle).as_ref().cloned() {
                merge_rt.set_position_callback(Box::new(
                    move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
                        let positions_data: Vec<(usize, [f64; 3])> = positions
                            .into_iter()
                            .map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z]))
                            .collect();
                        let _ = app_handle.emit(
                            "global-positions",
                            serde_json::json!({
                                "time": t,
                                "positions": positions_data,
                            }),
                        );
                    },
                ));
            }
            if let Err(e) = merge_rt.start() {
                merge_rt.unregister_move(&id);
                drop(merge_rt);
                let movement = lock_or_recover(&sh.movements).remove(&id);
                if let Some(movement) = movement {
                    movement.runtime.stop();
                }
                return Err(format!("Failed to start MergeRuntime: {e}"));
            }
        }
    }

    // 10. Emit active-moves-update
    if let Some(app_handle) = lock_or_recover(&sh.app_handle).clone() {
        let _ = app_handle.emit("active-moves-update", ());
    }

    Ok(format!(
        "Move '{}' activated ({})",
        spec.name,
        if spec.is_preview { "preview" } else { "live" }
    ))
}

/// Active un move : crée un worker Runtime, l'attache au MergeRuntime.
#[tauri::command]
pub async fn activate_move(
    request: ActivateMoveRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let spec = MoveSpec {
        id: request.movement_id,
        name: request.name,
        graph_json: request.graph_json,
        osc_ids: request.osc_ids,
        track_indices: request.track_indices,
        is_preview: request.is_preview,
        origin: request.origin,
        duration: request.duration,
        loop_mode: parse_loop_mode(&request.loop_mode),
        direction: parse_direction(&request.direction),
        fade: None,
        speed: None,
        animation_state: None,
    };
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || spawn_move(spec, &sh))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

/// Retire un move du merge + de la map + stoppe son worker, en vérifiant la
/// génération (un id réutilisé n'est pas touché) et les activations en cours.
/// Retourne true si quelque chose a été retiré.
fn remove_move_checked(
    movement_id: &str,
    expected_generation: u64,
    merge_runtime: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    movements: &Arc<Mutex<HashMap<String, Movement>>>,
    pending: &Arc<Mutex<std::collections::HashSet<String>>>,
) -> bool {
    // Section critique pending → movements : si l'id est en cours de
    // réactivation (pending) ou a été réutilisé (génération différente),
    // on ne touche à rien.
    let movement = {
        let pending = lock_or_recover(pending);
        let mut movements = lock_or_recover(movements);
        if pending.contains(movement_id) {
            return false;
        }
        match movements.get(movement_id) {
            Some(m) if m.generation == expected_generation => movements.remove(movement_id),
            _ => return false,
        }
    };
    {
        let merge_rt = lock_or_recover(merge_runtime);
        merge_rt.unregister_move(movement_id);
    }
    if let Some(movement) = movement {
        movement.runtime.stop(); // stop() join le thread proprement
    }
    true
}

fn deactivate_move_immediate_arc(
    movement_id: &str,
    generation: u64,
    merge_runtime: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    movements: &Arc<Mutex<HashMap<String, Movement>>>,
    pending: &Arc<Mutex<std::collections::HashSet<String>>>,
    app_handle: &Arc<Mutex<Option<AppHandle>>>,
) -> Result<String, String> {
    if !remove_move_checked(movement_id, generation, merge_runtime, movements, pending) {
        return Ok(format!("Move '{movement_id}' already gone"));
    }
    if let Some(app_handle) = lock_or_recover(app_handle).clone() {
        let _ = app_handle.emit("active-moves-update", ());
    }
    Ok(format!("Move '{movement_id}' deactivated"))
}

/// Désactive un move avec fade out.
///
/// NOTE: pour un id inconnu (déjà parti ou jamais existé), on renvoie Ok —
/// la désactivation est idempotent, safe à spammer en live. Un id en cours
/// d'activation (pending) renvoie Err pour éviter un no-op silencieux.
#[tauri::command]
pub async fn deactivate_move(
    movement_id: String,
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let fade = fade_duration.unwrap_or(0.5);

    // 1. Snapshot génération + existence (section critique pending → movements)
    let generation = {
        let pending = lock_or_recover(&state.pending_move_ids);
        let movements = lock_or_recover(&state.movements);
        if pending.contains(&movement_id) {
            return Err(format!(
                "Move '{movement_id}' is being activated — try again in a moment"
            ));
        }
        movements.get(&movement_id).map(|m| m.generation)
    };
    let Some(generation) = generation else {
        // Id inconnu : no-op documenté (idempotent).
        return Ok(format!("Move '{movement_id}' fading out"));
    };

    // 2. Démarrer le fade out dans le MergeRuntime
    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        merge_rt.start_fade_out(&movement_id, fade);
    }

    // 3. Si fade instantané, retirer immédiatement dans spawn_blocking
    if fade <= 0.0 {
        let merge_rt_arc = state.merge_runtime.clone();
        let movements_arc = state.movements.clone();
        let pending_arc = state.pending_move_ids.clone();
        let app_handle_arc = state.app_handle.clone();
        let mv_id = movement_id.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            deactivate_move_immediate_arc(
                &mv_id,
                generation,
                &merge_rt_arc,
                &movements_arc,
                &pending_arc,
                &app_handle_arc,
            )
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
    }

    // 4. Attendre la fin du fade dans un thread séparé. Le sleeper vérifie la
    //    génération : si l'id a été réutilisé par un nouveau move entre-temps,
    //    il ne touche à rien (le bug "sleeper kills reused id" est couvert).
    let mv_id = movement_id.clone();
    let app_state = state.app_handle.clone();
    let merge_rt = state.merge_runtime.clone();
    let movements = state.movements.clone();
    let pending = state.pending_move_ids.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(fade));
        remove_move_checked(&mv_id, generation, &merge_rt, &movements, &pending);
        if let Some(app_handle) = lock_or_recover(&app_state).clone() {
            let _ = app_handle.emit("active-moves-update", ());
        }
    });

    Ok(format!("Move '{movement_id}' fading out"))
}

/// Désactive tous les moves avec fade out
#[tauri::command]
pub async fn deactivate_all_moves(
    fade_duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let fade = fade_duration.unwrap_or(0.5);

    // Snapshot (id, génération) — le sleeper ne tuera que ces instances-là.
    let move_entries: Vec<(String, u64)> = {
        let movements = lock_or_recover(&state.movements);
        movements
            .iter()
            .map(|(id, m)| (id.clone(), m.generation))
            .collect()
    };

    if move_entries.is_empty() {
        return Ok("No active moves".to_string());
    }

    {
        let merge_rt = lock_or_recover(&state.merge_runtime);
        for (id, _) in &move_entries {
            merge_rt.start_fade_out(id, fade);
        }
    }

    let count = move_entries.len();
    if fade > 0.0 {
        let app_state = state.app_handle.clone();
        let merge_rt = state.merge_runtime.clone();
        let movements = state.movements.clone();
        let pending = state.pending_move_ids.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs_f64(fade));
            for (id, gen) in &move_entries {
                remove_move_checked(id, *gen, &merge_rt, &movements, &pending);
            }
            if let Some(app_handle) = lock_or_recover(&app_state).clone() {
                let _ = app_handle.emit("active-moves-update", ());
            }
        });
        Ok(format!("{count} moves fading out"))
    } else {
        let merge_rt_arc = state.merge_runtime.clone();
        let movements_arc = state.movements.clone();
        let pending_arc = state.pending_move_ids.clone();
        let app_handle_arc = state.app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for (id, gen) in &move_entries {
                let _ = deactivate_move_immediate_arc(
                    id,
                    *gen,
                    &merge_rt_arc,
                    &movements_arc,
                    &pending_arc,
                    &app_handle_arc,
                );
            }
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;
        Ok(format!("{count} moves deactivated"))
    }
}

/// Récupère les stats de performance du MergeRuntime
#[tauri::command]
pub async fn get_merge_perf_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let perf = merge_rt.get_perf_stats();
    Ok(serde_json::json!({
        "fps": perf.fps,
        "oscRate": perf.osc_rate,
        "latencyMs": perf.latency_ms,
        "cpuPercent": perf.cpu_percent,
        "oscErrorRate": perf.osc_error_rate,
        "oscRefusedRate": perf.osc_refused_rate,
    }))
}

/// Liste les moves actifs
#[tauri::command]
pub async fn list_active_moves(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let movements = lock_or_recover(&state.movements);
    Ok(movements
        .values()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "name": m.name,
                "osc_ids": m.osc_ids,
                "is_preview": m.is_preview,
                "is_playing": m.runtime.is_running(),
                "track_count": m.osc_ids.len(),
            })
        })
        .collect())
}
