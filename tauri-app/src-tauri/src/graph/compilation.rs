use stagespace_engines::{Compiler, Graph, PositionFn, AudioState};
use std::sync::{Arc, Mutex};

/// Compile un Graph en PositionFn — wrapper autour de Compiler::compile
/// avec formatage d'erreur uniforme.
pub fn compile_graph(graph: &Graph) -> Result<PositionFn, String> {
    Compiler::compile(graph)
        .map_err(|e| format!("Compilation failed: {:?}", e))
}

/// Compile un Graph avec accès à l'audio state temps réel
/// Les engines audio (BPM, AudioAmplitude, AudioAmplitudeFalloff) liront
/// les valeurs audio live au lieu des paramètres statiques
pub fn compile_graph_with_audio(
    graph: &Graph,
    audio_state: Arc<Mutex<AudioState>>,
) -> Result<PositionFn, String> {
    Compiler::compile_with_audio(graph, audio_state)
        .map_err(|e| format!("Compilation failed: {:?}", e))
}
