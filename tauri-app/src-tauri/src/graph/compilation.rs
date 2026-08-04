use stagespace_engines::{Compiler, Graph, PositionFn};

/// Compile un Graph en PositionFn — wrapper autour de Compiler::compile
/// avec formatage d'erreur uniforme.
pub fn compile_graph(graph: &Graph) -> Result<PositionFn, String> {
    Compiler::compile(graph)
        .map_err(|e| format!("Compilation failed: {:?}", e))
}
