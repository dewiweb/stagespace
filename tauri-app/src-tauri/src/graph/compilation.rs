use crate::commands::state::{lock_or_recover, Shared};
use stagespace_engines::{
    AudioParamOverrides, AudioState, Compiler, Graph, LiveInputs, PositionFn,
};
use std::sync::{Arc, Mutex};

/// Compile un Graph en PositionFn — wrapper autour de Compiler::compile
/// avec formatage d'erreur uniforme.
pub fn compile_graph(graph: &Graph) -> Result<PositionFn, String> {
    Compiler::compile(graph)
        .map_err(|e| format!("Compilation failed: {e:?}"))
        .map(std::sync::Arc::from)
}

/// Compile un Graph avec accès à l'audio state temps réel
/// Les engines audio (BPM, AudioAmplitude, AudioAmplitudeFalloff) liront
/// les valeurs audio live au lieu des paramètres statiques
pub fn compile_graph_with_audio(
    graph: &Graph,
    audio_state: Arc<Mutex<AudioState>>,
) -> Result<PositionFn, String> {
    Compiler::compile_with_audio(graph, audio_state)
        .map_err(|e| format!("Compilation failed: {e:?}"))
        .map(std::sync::Arc::from)
}

/// Compile un Graph avec audio state + overrides de paramètres audio
/// Les overrides (radius, height, turns, offset, rotation) sont mis à jour
/// par le runtime à chaque frame et injectés dans tous les engines.
pub fn compile_graph_with_audio_and_overrides(
    graph: &Graph,
    audio_state: Arc<Mutex<AudioState>>,
    overrides: AudioParamOverrides,
) -> Result<PositionFn, String> {
    Compiler::compile_with_audio_and_overrides(graph, audio_state, overrides)
        .map_err(|e| format!("Compilation failed: {e:?}"))
        .map(std::sync::Arc::from)
}

/// Compile un Graph avec audio + cache des valeurs OSC reçues.
/// Sans ça, les nodes `OSCInput` produisent un cercle statique.
pub fn compile_graph_with_audio_osc(
    graph: &Graph,
    audio_state: Arc<Mutex<AudioState>>,
    overrides: AudioParamOverrides,
    osc_values: stagespace_engines::OscValueMap,
) -> Result<PositionFn, String> {
    Compiler::compile_with_audio_osc(graph, audio_state, overrides, osc_values)
        .map_err(|e| format!("Compilation failed: {e:?}"))
        .map(std::sync::Arc::from)
}

/// Compile un graphe avec toutes les entrées live : audio state, cache des
/// valeurs OSC reçues et registry de plugins WASM. **Chemin de production** —
/// activate_move / update_move_graph / respawn de cue doivent passer par ici
/// pour que les nodes `Plugin` résolvent leur `plugin_id` (sinon le compile
/// échoue avec "requires a plugin registry").
///
/// `param_slots` : table partagée entre la position_fn compilée, la
/// sample_fn et la signal_fn du move (construite une fois par recompile
/// via `ParamSlots::build(&graph)`). `None` → compile sans modulation.
///
/// `pose_ctx` : contexte du move pour les nodes PoseRamp — `(osc_ids,
/// track_indices)` du spawn/hot-swap. Si le graphe contient un PoseRamp,
/// le resolver est construit ici : capture des positions live par index
/// local (chaîne `last_position`) + snapshot des poses. `None` → un
/// PoseRamp échouerait la compile (graphes sans PoseRamp : aucun effet).
/// `engine_states` : store des caches d'engines à état du move —
/// `Some(runtime.engine_states())` pour la position_fn live (warm-start
/// au hot-swap : la nouvelle instance adopte le cache de la précédente,
/// pas de resim 0→t). `None` OBLIGATOIRE pour la sample_fn — ses evals
/// ne doivent jamais avancer le sim_t partagé avec la live.
#[allow(clippy::too_many_arguments)]
pub fn compile_graph_live(
    graph: &Graph,
    sh: &Shared,
    param_slots: Option<std::sync::Arc<stagespace_engines::param_slots::ParamSlots>>,
    held_positions: Option<stagespace_engines::compiler::HeldPositions>,
    pose_ctx: Option<(&[u32], &[usize])>,
    engine_states: Option<stagespace_engines::compiler::EngineStateStore>,
) -> Result<PositionFn, String> {
    let osc_values = lock_or_recover(&sh.osc_receiver).address_values_handle();
    let pose_resolver = pose_ctx.and_then(|(ids, idx)| build_pose_resolver(graph, ids, idx, sh));
    let live = LiveInputs {
        audio: Some(sh.audio_state.clone()),
        osc_values: Some(osc_values),
        plugins: sh.plugin_registry.clone(),
        param_slots,
        held_positions,
        pose_resolver: pose_resolver.clone(),
        engine_states,
    };
    let result = Compiler::compile_with_live_inputs(graph, live)
        .map_err(|e| format!("Compilation failed: {e:?}"))
        .map(std::sync::Arc::from);
    // Warnings de résolution PoseRamp — collectés au compile, remontés
    // en log (les fallbacks des commandes goto sont pré-filtrés en amont ;
    // ici les cas hand-authored : freeze-in-place, appear-at-target).
    if result.is_ok() {
        if let Some(resolver) = pose_resolver {
            let warnings = resolver
                .warnings
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            for w in warnings {
                eprintln!("[POSE] {w}");
            }
        }
    }
    result
}

/// Construit le resolver PoseRamp d'un move — `None` si le graphe n'en
/// contient pas (coût de capture évité). Capture par index LOCAL : la
/// position live du track global correspondant (`track_indices[local]`),
/// même pattern que la capture d'ancre `Current`. Les warnings de
/// résolution sont collectés dans le resolver au compile — le spawn les
/// lit ensuite (logs ; les fallbacks goto sont pré-filtrés en amont).
pub fn build_pose_resolver(
    graph: &Graph,
    osc_ids: &[u32],
    track_indices: &[usize],
    sh: &Shared,
) -> Option<std::sync::Arc<stagespace_engines::PoseResolver>> {
    let has_poseramp = graph
        .nodes
        .values()
        .any(|n| n.node_type == stagespace_engines::NodeType::PoseRamp);
    if !has_poseramp {
        return None;
    }
    let live_positions: Vec<Option<[f64; 3]>> = {
        let merge_rt = lock_or_recover(&sh.merge_runtime);
        track_indices
            .iter()
            .map(|&global| merge_rt.last_position(global))
            .collect()
    };
    let poses = lock_or_recover(&sh.poses).clone();
    Some(std::sync::Arc::new(stagespace_engines::PoseResolver {
        track_ids: osc_ids.to_vec(),
        live_positions,
        poses,
        warnings: std::sync::Mutex::new(Vec::new()),
    }))
}
