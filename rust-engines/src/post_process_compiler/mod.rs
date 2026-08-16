//! Compiler pour le graph global (post-processing).
//!
//! Compile les nodes du graph global en une `PostProcessFn` qui sera appelée
//! par le MergeRuntime après le merge des positions.
//!
//! Nodes supportés :
//! - Scale, Rotate, Offset (déjà existants comme modifiers)
//! - RadiusScale, HeightOffset, PerTrackDepth, Barycenter, AudioFalloff, ManualPosition
//!
//! Le graph global est une chaîne linéaire : Input → [Transform nodes] → Output.
//! Chaque node transforme les positions et passe au suivant.

#[cfg(test)]
mod tests;
mod transforms;

use crate::graph::{Graph, Node, NodeId, NodeType};
use crate::runtime::{MacroState, PostProcessContext, PostProcessFn};
use crate::validator::{GraphContext, Validator};
use std::sync::Arc;

/// Erreur de compilation du graph global
#[derive(Debug, Clone)]
pub enum PostProcessCompileError {
    MissingOutputNode,
    OutputNotConnected,
    InvalidNode(String),
    MissingParameter(String),
    InvalidParameter(String),
    /// Le graph global a échoué la validation (cycles, connexions invalides,
    /// nodes de sub-graph placés en global, etc.).
    ValidationFailed(String),
}

/// Paramètres pour compiler le graph global
pub struct PostProcessCompileParams {
    /// Le graph global (nodes + edges)
    pub graph: Graph,
    /// MacroState partagé (fast path atomic) — les nodes Scale/Rotate/etc.
    /// lisent les valeurs depuis ici, pas depuis les params du node.
    /// Les params du node servent de valeurs par défaut / override.
    pub macros: Arc<MacroState>,
}

/// Compile le graph global en une PostProcessFn.
///
/// Le graph global est une chaîne : Input (positions mergées) → Transform nodes → Output.
/// On parcourt la chaîne depuis l'Output vers l'amont, en construisant une closure
/// qui applique chaque transformation en séquence.
pub fn compile_post_process(
    params: PostProcessCompileParams,
) -> Result<PostProcessFn, PostProcessCompileError> {
    let graph = &params.graph;

    // 0. Valider le graph global (cycles, connexions, compatibilité de contexte).
    //    Le sub-graph compiler valide déjà via Validator::validate ; le graph global
    //    ne le faisait pas — c'était une faille silencieuse.
    if let Err(errors) = Validator::validate_with_context(graph, GraphContext::Global) {
        let error_msg = errors
            .iter()
            .map(|e| format!("{e:?}"))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PostProcessCompileError::ValidationFailed(error_msg));
    }

    // Trouver le node Output
    let output_node = graph
        .nodes
        .values()
        .find(|n| n.node_type == NodeType::Output)
        .ok_or(PostProcessCompileError::MissingOutputNode)?;

    // Trouver la chaîne de nodes depuis Output vers l'amont
    let chain = build_transform_chain(graph, output_node.id)?;

    // Si la chaîne est vide, retourner une fonction identité
    if chain.is_empty() {
        return Ok(Box::new(|_ctx, positions| positions));
    }

    // Compiler chaque node en une closure de transformation
    // On construit la chaîne de l'amont vers l'aval (premier node = premier appliqué)
    let transforms = transforms::compile_chain(&chain)?;

    // La PostProcessFn applique les transformations en séquence
    Ok(Box::new(move |ctx: &PostProcessContext, positions| {
        let mut result = positions;
        for transform in &transforms {
            result = transform(ctx, result);
        }
        result
    }))
}

/// Construit la chaîne de nodes depuis l'Output vers l'amont.
/// Retourne les nodes dans l'ordre d'application (amont → aval).
fn build_transform_chain(
    graph: &Graph,
    output_id: NodeId,
) -> Result<Vec<Node>, PostProcessCompileError> {
    let inputs = graph.get_inputs(output_id);
    let first_node_id = inputs
        .first()
        .ok_or(PostProcessCompileError::OutputNotConnected)?;

    // Parcourir la chaîne depuis le premier node vers l'amont
    let mut chain: Vec<Node> = Vec::new();
    let mut current_id = *first_node_id;
    let mut visited = std::collections::HashSet::new();

    loop {
        if !visited.insert(current_id) {
            // Cycle détecté — arrêter
            break;
        }

        let node = match graph.nodes.get(&current_id) {
            Some(n) => n.clone(),
            None => break,
        };

        // Si c'est un node de post-processing, l'ajouter à la chaîne
        if transforms::is_post_process_node(&node.node_type) {
            chain.push(node.clone());

            // Remonter vers l'amont
            let upstream = graph.get_inputs(current_id);
            if let Some(upstream_id) = upstream.first() {
                current_id = *upstream_id;
            } else {
                break;
            }
        } else {
            // Node non post-processing dans le graph global.
            // Input/Merge/MoveRef sont les sources attendues en amont de la chaîne
            // → fin légitime de la chaîne.
            // Tout autre type (engine, Objects, Duration, falloff, source) est une
            // erreur — le validateur devrait l'avoir attrapé avant, mais on garde
            // cette garde défensive au cas où le validateur est contourné.
            match node.node_type {
                NodeType::Input | NodeType::Merge | NodeType::MoveRef => break,
                other => {
                    return Err(PostProcessCompileError::InvalidNode(format!(
                        "{other:?} is not a post-process node and cannot appear in the global graph chain"
                    )));
                }
            }
        }
    }

    // Inverser la chaîne : amont → aval
    chain.reverse();
    Ok(chain)
}
