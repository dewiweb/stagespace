use stagespace_engines::{AudioParamOverrides, AudioState, Compiler, Graph, PositionFn};
use std::sync::{Arc, Mutex};

/// Compile un Graph en PositionFn — wrapper autour de Compiler::compile
/// avec formatage d'erreur uniforme.
pub fn compile_graph(graph: &Graph) -> Result<PositionFn, String> {
    Compiler::compile(graph).map_err(|e| format!("Compilation failed: {e:?}"))
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
}
