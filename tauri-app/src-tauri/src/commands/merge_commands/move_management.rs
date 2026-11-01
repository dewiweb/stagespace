//! Move management : activate, deactivate, deactivate_all, list, perf stats
//!
//! `spawn_move` est le chemin unique de création d'un worker move —
//! utilisé par `activate_move`, `launch_animation` et le recall de cue.
//! Il garantit : réservation d'id (anti-doublon/race), compile, worker
//! PositionBuffer, registration merge, démarrage du MergeRuntime, et
//! cleanup complet si une étape échoue.

use crate::commands::error::IpcError;
use crate::commands::state::{lock_or_recover, Shared};
use crate::graph::compilation::compile_graph_live;
use crate::graph::parser::build_graph_from_json;
use crate::{AppState, Movement, MAX_MOVEMENTS};
use serde::Deserialize;
use stagespace_engines::{
    Animation, AnimationState, EngineParams, LoopMode, PlayDirection, PositionBuffer, Runtime,
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
    pub graph_json: stagespace_engines::GraphJson,
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
    /// Animation complète (optionnel) — quand présente, fournit au worker :
    /// fade (enveloppe de cycle), speed (macro per-move) et AnimationState
    /// (track depths, phase offsets, audio mods). Les macros spatiales de
    /// l'animation (scale/shift/rotation) NE sont PAS reprises ici : pour les
    /// slots elles vont au merge global via `set_global_macro` (sémantique
    /// "appliquées au lancement" — un double report créerait un transform ×2).
    pub animation: Option<Animation>,
    /// Fin de one-shot : "revert" (défaut) ou "hold" (fige la dernière
    /// position en position manuelle — sémantique continue).
    #[serde(default)]
    pub end_mode: stagespace_engines::EndMode,
    /// Ancre : "origin" (défaut) ou "current" (capture la position
    /// courante de chaque objet — chaînage sans saut).
    #[serde(default)]
    pub anchor_mode: stagespace_engines::AnchorMode,
    /// Cible du mode "follow" — la track dont l'origine suit la position.
    #[serde(default)]
    pub anchor_target: Option<u32>,
}

/// Spec complet pour créer un worker move — partagé entre activate_move,
/// launch_animation et recall_cue (restauration des snapshots).
pub struct MoveSpec {
    pub id: String,
    pub name: String,
    pub graph_json: stagespace_engines::GraphJson,
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub is_preview: bool,
    pub origin: Option<[f64; 3]>,
    pub duration: f64,
    pub loop_mode: LoopMode,
    pub direction: PlayDirection,
    /// Fades du worker (utilisé par launch_animation) : enveloppe temporelle
    /// du cycle (fade-in au début, fade-out en fin de boucle) — appliquée
    /// par le worker dans move_transform. Distinct du fade MoveState du
    /// merge (fade d'activation/désactivation wall-clock).
    pub fade: Option<(f64, f64)>,
    /// Macro speed per-move (appliquée dans le worker — effective en mode worker)
    pub speed: Option<f64>,
    /// Macros spatiales initiales du worker (animations : scale/shift/rotation)
    pub spatial_macros: Option<SpatialMacroInit>,
    /// AnimationState complet (animations — phase offsets + audio mods)
    pub animation_state: Option<AnimationState>,
    /// Graph de modulation per-move (domaine signal → deltas de macros).
    /// Compilé au spawn puis swappé sur le worker (`runtime.swap_signal_fn`).
    pub signal_graph: Option<stagespace_engines::GraphJson>,
    /// Fin de one-shot : Revert (défaut) ou Hold (fige en position manuelle).
    pub end_mode: stagespace_engines::EndMode,
    /// Ancre : Origin (défaut) ou Current (capture la position courante).
    pub anchor_mode: stagespace_engines::AnchorMode,
    /// Cible du mode Follow — la track suivie (None = pas de follow).
    pub anchor_target: Option<u32>,
}

/// Macros spatiales initiales d'un worker (système Animation).
/// Scope = `MacroScope::PerMove` : appliquées par le worker en espace
/// local ; les macros live `set_macro` (`MacroScope::Global`) restent
/// au merge — ne jamais pousser la même valeur aux deux (transform ×2).
pub struct SpatialMacroInit {
    pub scale: f64,
    pub shift: (f64, f64, f64),
    pub rotation: (f64, f64, f64),
}

/// Résout les track_indices globaux d'un move à partir de ses osc_ids :
/// position de chaque id dans la liste `osc_ids` globale du merge. Les ids
/// absents sont ajoutés à la liste globale (sinon leurs positions
/// tomberaient sur les mauvaises tracks via le fallback identité du merge).
pub fn resolve_track_indices(
    merge_runtime: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    osc_ids: &[u32],
) -> Vec<usize> {
    let merge_rt = lock_or_recover(merge_runtime);
    let mut global = merge_rt.osc_ids();
    let mut extended = false;
    let indices: Vec<usize> = osc_ids
        .iter()
        .map(|id| match global.iter().position(|g| g == id) {
            Some(i) => i,
            None => {
                global.push(*id);
                extended = true;
                global.len() - 1
            }
        })
        .collect();
    if extended {
        merge_rt.set_osc_ids(global);
    }
    indices
}

/// Retire un move du merge + de la map + stoppe son worker, sans connaître
/// la génération à l'avance (snapshot interne). Idempotent.
pub fn remove_move_now(movement_id: &str, sh: &Shared) -> bool {
    let generation = {
        let movements = lock_or_recover(&sh.movements);
        match movements.get(movement_id) {
            Some(m) => m.generation,
            None => return false,
        }
    };
    remove_move_checked(
        movement_id,
        generation,
        &sh.merge_runtime,
        &sh.movements,
        &sh.pending_move_ids,
    )
}

pub fn loop_mode_label(mode: LoopMode) -> String {
    match mode {
        LoopMode::OneShot => "oneshot".to_string(),
        LoopMode::Loop => "loop".to_string(),
    }
}

pub fn direction_label(dir: PlayDirection) -> String {
    match dir {
        PlayDirection::Backward => "backward".to_string(),
        PlayDirection::PingPong => "ping_pong".to_string(),
        PlayDirection::Forward => "forward".to_string(),
    }
}

pub fn parse_loop_mode(s: &str) -> LoopMode {
    match s {
        "oneshot" => LoopMode::OneShot,
        _ => LoopMode::Loop,
    }
}

pub fn parse_direction(s: &str) -> PlayDirection {
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
pub fn spawn_move(spec: MoveSpec, sh: &Shared) -> Result<String, IpcError> {
    spawn_move_inner(spec, sh, true)
}

/// Variante pour `recall_cue` : pendant un recall, `recall_in_progress` est
/// posé par le recall lui-même — le check "abort if recall in progress" ne
/// s'applique pas (le recall EST l'autorité sur la liste des moves).
pub fn spawn_move_for_recall(spec: MoveSpec, sh: &Shared) -> Result<String, IpcError> {
    spawn_move_inner(spec, sh, false)
}

fn spawn_move_inner(
    spec: MoveSpec,
    sh: &Shared,
    abort_on_recall: bool,
) -> Result<String, IpcError> {
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
            return Err(IpcError::conflict(format!(
                "Move '{id}' is already active or being activated — pick another id"
            )));
        }
        if movements.len() + pending.len() >= MAX_MOVEMENTS {
            return Err(IpcError::validation(format!(
                "Maximum {MAX_MOVEMENTS} movements reached — stop some first"
            )));
        }
        pending.insert(id.clone());
    }
    // Le guard libère l'id sur tous les chemins d'erreur qui suivent.
    let _guard = PendingGuard {
        id: id.clone(),
        pending: sh.pending_move_ids.clone(),
    };

    // 0b. Valider track_indices AVANT tout travail lourd : le merge skippe
    //     silencieusement tout move dont la longueur ne correspond pas aux
    //     positions produites, et un index hors de la liste OSC globale
    //     mapperait les positions sur une track inexistante.
    if !spec.track_indices.is_empty() {
        if spec.track_indices.len() != spec.osc_ids.len() {
            return Err(IpcError::validation(format!(
                "Move '{id}': track_indices.len()={} != osc_ids.len()={} — \
                 le merge skipperait ce move (silent)",
                spec.track_indices.len(),
                spec.osc_ids.len()
            )));
        }
        let global_len = lock_or_recover(&sh.merge_runtime).osc_ids().len();
        if let Some(&bad) = spec.track_indices.iter().find(|&&i| i >= global_len) {
            return Err(IpcError::validation(format!(
                "Move '{id}': track_index {bad} hors de la liste OSC globale \
                 ({global_len} entrées) — mapping stale, re-sélectionner les tracks"
            )));
        }
    }

    // 1. Compiler le sub-graph
    let graph = {
        let audio_state = lock_or_recover(&sh.audio_state);
        build_graph_from_json(&spec.graph_json, &audio_state).map_err(|e| {
            eprintln!("[ACTIVATE-ERROR] build_graph_from_json failed: {e}");
            IpcError::validation(e)
        })?
    };

    // 1b. Engines stateful (physique) : un t décroissant force un reset +
    //    re-simulation à chaque frame (O(t·n²)) → le worker rampe puis meurt
    //    en stale-kill. Backward/PingPong et le phase spread (t différent
    //    par objet) déclenchent ce re-sim — refus explicite au spawn.
    if graph
        .nodes
        .values()
        .any(|n| stagespace_engines::node_spec::node_spec(&n.node_type).stateful)
    {
        let spread = spec
            .animation_state
            .as_ref()
            .map(|a| a.track_phase_offsets.iter().any(|o| o.abs() > 1e-9))
            .unwrap_or(false);
        if spec.direction != PlayDirection::Forward || spread {
            return Err(IpcError::validation(
                "Physics engines (stateful) cannot run backward, ping-pong or with phase spread — every backward eval re-simulates from t=0".to_string(),
            ));
        }
    }

    // 1c. spec.duration (durée du wrap du worker) vs durée résolue du
    //    graphe (param propre > node Duration > propagation composites) :
    //    si le graphe demande plus (ex. Sequence a+b), le wrap tronquait
    //    la branche B — on prend le max.
    let mut spec = spec;
    if let Some(resolved) = stagespace_engines::Compiler::resolved_cycle_duration(&graph) {
        if resolved > spec.duration {
            spec.duration = resolved;
        }
    }

    // 2. Créer le worker Runtime — pas de socket propre : les positions
    //    partent dans le PositionBuffer, l'OSC est envoyé uniquement par
    //    le MergeRuntime via son PositionSink.
    // L'AudioState maître est injecté — le worker lit l'état audio à jour à
    // chaque frame sans propagation par polling (une seule source de vérité).
    let mut runtime = Runtime::new_with_audio_state(sh.audio_state.clone());

    // 3. Compiler avec toutes les entrées live : audio, valeurs OSC reçues
    //    (nodes OSCInput lisent extra["osc_value"] — sans handle ils
    //    produisent un cercle statique) et registry de plugins WASM
    //    (nodes Plugin → params.plugin_id).
    // Table de slots de params modulables — une seule par compile, partagée
    // entre position_fn, sample_fn et la signal_fn du move (binding
    // compile-time des cibles `param:`).
    let slots = stagespace_engines::param_slots::ParamSlots::build(&graph);
    let compiled = compile_graph_live(
        &graph,
        sh,
        Some(slots.clone()),
        Some(runtime.held_positions()),
    )
    .map_err(|e| {
        eprintln!("[ACTIVATE-ERROR] compile_graph failed: {e}");
        IpcError::validation(e)
    })?;
    // Instance jetable pour le TrajectorySampler — les evals de preview
    // n'avancent pas sim_t des engines stateful de la fn live. Partage la
    // même table de slots (read-only) : le preview reflète la modulation.
    if let Ok(sample_fn) = compile_graph_live(
        &graph,
        sh,
        Some(slots.clone()),
        Some(runtime.held_positions()),
    ) {
        runtime.set_sample_fn(sample_fn);
    }

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
    if let Some(ref m) = spec.spatial_macros {
        runtime.macros().set_scale(m.scale);
        runtime.macros().set_shift(m.shift.0, m.shift.1, m.shift.2);
        runtime
            .macros()
            .set_rotation(m.rotation.0, m.rotation.1, m.rotation.2);
    }
    // Origin du move : explicite (centroïde des tracks du move, envoyé par le
    // frontend) ou fallback sur l'origin globale courante du merge — le worker
    // l'applique dans son transform per-move avant l'écriture du buffer.
    let move_origin = match spec.origin {
        Some(ref o) => nalgebra::Vector3::new(o[0], o[1], o[2]),
        None => lock_or_recover(&sh.merge_runtime).origin(),
    };
    runtime.set_origin(move_origin);
    // AnchorMode::Current — capture par index LOCAL : last_position du
    // track global correspondant (le worker émet en index local, le merge
    // remappe vers les tracks via track_indices).
    if spec.anchor_mode == stagespace_engines::AnchorMode::Current {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        let captured: std::collections::HashMap<usize, nalgebra::Vector3<f64>> = spec
            .track_indices
            .iter()
            .enumerate()
            .filter_map(|(local, &global)| {
                merge_rt
                    .last_position(global)
                    .map(|p| (local, nalgebra::Vector3::new(p[0], p[1], p[2])))
            })
            .collect();
        if !captured.is_empty() {
            runtime.set_anchor_capture(captured);
        }
    }
    // AnchorMode::Follow — l'origine suit la dernière position émise de la
    // track cible à chaque frame. Injecte le handle last_out du merge.
    if spec.anchor_mode == stagespace_engines::AnchorMode::Follow {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        runtime.set_last_positions_handle(merge_rt.last_positions_handle());
        runtime.set_anchor_follow(spec.anchor_target.map(|t| t as usize));
    }
    if let Some(anim_state) = spec.animation_state {
        runtime.set_animation_state(anim_state);
    }

    // Signal graph per-move : branche le cache OSC (source SignalOsc —
    // l'Arc interne peut être re-pointé après un rebind du receiver) puis
    // compile + swap la SignalFn liée à la table de slots (les cibles
    // `param:` sont résolues à la compile — erreurs explicites).
    runtime.set_osc_values_handle(lock_or_recover(&sh.osc_receiver).address_values_handle());
    {
        let sig_fn = match spec.signal_graph {
            Some(ref sig_json) => {
                let audio_state = lock_or_recover(&sh.audio_state);
                let sig_graph = build_graph_from_json(sig_json, &audio_state)
                    .map_err(|e| IpcError::validation(format!("Signal graph parse failed: {e}")))?;
                drop(audio_state);
                stagespace_engines::compile_move_signal_graph(&sig_graph, &graph, &slots).map_err(
                    |e| IpcError::validation(format!("Signal graph compile failed: {e:?}")),
                )?
            }
            None => stagespace_engines::empty_signal_fn(),
        };
        runtime.swap_signal_fn(sig_fn, slots);
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
        .map_err(|e| IpcError::internal(format!("Worker playback failed: {e}")))?;

    // 7. Un recall en cours est l'autorité sur la liste des moves —
    //    abandonner proprement plutôt que de ré-introduire un move que le
    //    recall vient de désactiver. Sauf si l'appel vient du recall
    //    lui-même (spawn_move_for_recall → abort_on_recall = false).
    if abort_on_recall && sh.recall_in_progress.load(Ordering::SeqCst) {
        runtime.stop();
        return Err(IpcError::busy(
            "Cue recall in progress — activation aborted".to_string(),
        ));
    }

    // 8. Enregistrer le movement — le check recall est refait SOUS le lock :
    //    entre le check de l'étape 7 et cet insert, un recall peut avoir
    //    sweep la map (il ne voit pas ce move) → ghost. Comme le sweep du
    //    recall tient aussi ce lock, vérifier le flag ici ferme la fenêtre.
    {
        let mut movements = lock_or_recover(&sh.movements);
        if abort_on_recall && sh.recall_in_progress.load(Ordering::SeqCst) {
            drop(movements);
            runtime.stop();
            return Err(IpcError::busy(
                "Cue recall in progress — activation aborted".to_string(),
            ));
        }
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
                signal_graph: spec.signal_graph.clone(),
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
            spec.end_mode,
        );
        // L'origin du move est passée au WORKER (runtime.set_origin, étape 4)
        // — le merge garde SON origin globale (set_global_origin, centroïde
        // de toutes les tracks). Écrire l'origin du move ici faisait du
        // last-writer-wins : deux moves avec des centroïdes différents
        // écrasaient l'origin du post-process global.

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
                return Err(IpcError::internal(format!(
                    "Failed to start MergeRuntime: {e}"
                )));
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
) -> Result<String, IpcError> {
    // Extrait AVANT le move des champs de request dans spec.
    let animation_state = request
        .animation
        .as_ref()
        .map(|a| AnimationState::from_animation(a, &request.osc_ids));
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
        fade: request.animation.as_ref().map(|a| (a.fade_in, a.fade_out)),
        speed: request.animation.as_ref().map(|a| a.speed),
        spatial_macros: None,
        animation_state,
        signal_graph: request
            .animation
            .as_ref()
            .and_then(|a| a.signal_graph.clone()),
        end_mode: request.end_mode,
        anchor_mode: request.anchor_mode,
        anchor_target: request.anchor_target,
    };
    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || spawn_move(spec, &sh))
        .await
        .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
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
) -> Result<String, IpcError> {
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
) -> Result<String, IpcError> {
    let fade = fade_duration.unwrap_or(0.5);

    // 1. Snapshot génération + existence (section critique pending → movements)
    let generation = {
        let pending = lock_or_recover(&state.pending_move_ids);
        let movements = lock_or_recover(&state.movements);
        if pending.contains(&movement_id) {
            return Err(IpcError::busy(format!(
                "Move '{movement_id}' is being activated — try again in a moment"
            )));
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
        .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?;
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
) -> Result<String, IpcError> {
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
        .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?;
        Ok(format!("{count} moves deactivated"))
    }
}

/// Récupère les stats de performance du MergeRuntime
#[tauri::command]
pub async fn get_merge_perf_stats(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, IpcError> {
    let merge_rt = lock_or_recover(&state.merge_runtime);
    let perf = merge_rt.get_perf_stats();
    Ok(serde_json::json!({
        "fps": perf.fps,
        "oscRate": perf.osc_rate,
        "latencyMs": perf.latency_ms,
        "cpuPercent": perf.cpu_percent,
        "oscErrorRate": perf.osc_error_rate,
        "oscRefusedRate": perf.osc_refused_rate,
        "oscSuspended": perf.osc_suspended,
        // Liveness du merge thread — perf.fps reste figé à la dernière
        // fenêtre si le thread meurt ; ces compteurs trahissent un blackout.
        "isRunning": merge_rt.is_running(),
        "threadDied": merge_rt.thread_died(),
        "mergeFrames": merge_rt.merge_frame_count(),
        "droppedPositions": merge_rt.dropped_position_count(),
    }))
}

/// Projection `Movement` → `MovementInfo` — extraite pour être testable
/// sans `State<AppState>` (le `is_playing` honnête est critique en live).
pub(crate) fn collect_movement_infos(
    movements: &HashMap<String, Movement>,
    merge_runtime: &stagespace_engines::MergeRuntime,
) -> Vec<crate::MovementInfo> {
    movements
        .values()
        .map(|m| {
            // `is_running` seul ment : un worker stale-killé par le merge (ou
            // mort par panic hors catch_unwind) garde running=true alors que
            // le merge ne stream plus ses positions.
            let alive_in_merge = merge_runtime.has_move(&m.id);
            crate::MovementInfo {
                id: m.id.clone(),
                name: m.name.clone(),
                osc_ids: m.osc_ids.clone(),
                is_preview: m.is_preview,
                is_playing: m.runtime.is_running() && alive_in_merge,
                track_count: m.osc_ids.len(),
            }
        })
        .collect()
}

/// Liste les moves actifs
#[tauri::command]
pub async fn list_active_moves(
    state: State<'_, AppState>,
) -> Result<Vec<crate::MovementInfo>, IpcError> {
    let movements = lock_or_recover(&state.movements);
    let merge_rt = lock_or_recover(&state.merge_runtime);
    Ok(collect_movement_infos(&movements, &merge_rt))
}
