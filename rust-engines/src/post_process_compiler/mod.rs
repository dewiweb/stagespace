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
use crate::kinematics::ChannelModulation;
use crate::runtime::{MacroState, PostProcessContext, PostProcessFn};
use crate::validator::{GraphContext, Validator};
use crate::zones::Zone;
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

/// Effets déclarés dans le graph global — les nodes `Zone` et `Velocity`
/// sont des capteurs (sinks) : ils observent les positions finales, leurs
/// paramètres sont extraits ici et installés dans le MergeRuntime pour
/// être évalués chaque frame avec les effets configurés manuellement.
#[derive(Debug, Default)]
pub struct GraphEffects {
    /// Zones déclarées par les nodes `Zone` du graph
    pub zones: Vec<Zone>,
    /// Modulations cinématiques déclarées par les nodes `Velocity`
    pub modulations: Vec<ChannelModulation>,
    /// Stratégie de merge déclarée par le node `Merge` en tête de chaîne
    /// (param `strategy`) — None si absent ou non en tête.
    pub strategy: Option<crate::merge_runtime::MergeStrategy>,
    /// Le head de chaîne est un `MoveRef` avec `move_id` non vide : la
    /// chaîne ne reçoit que les positions de CE move au lieu du merge.
    pub move_ref: Option<String>,
}

/// Extrait les effets déclarés dans le graph global.
///
/// `strategy`/`move_id` sont lus sur le HEAD de la chaîne `in` de l'Output
/// uniquement (une source ailleurs dans le graphe est rejetée par le
/// validateur). Les zones/modulations ne sont extraites que des capteurs
/// alimentés par le node qui alimente `Output.in` — un capteur branché
/// au milieu de la chaîne est une erreur de validation, pas un effet
/// silencieusement déplacé.
pub fn extract_graph_effects(graph: &Graph) -> Result<GraphEffects, PostProcessCompileError> {
    let mut effects = GraphEffects::default();

    let Some(output) = graph
        .nodes
        .values()
        .find(|n| n.node_type == NodeType::Output)
    else {
        return Ok(effects);
    };
    // Le node qui alimente `Output.in` — extrémité de la chaîne.
    let Some(feeder) = graph
        .edges
        .iter()
        .find(|e| e.to == output.id && e.to_port == "in")
        .map(|e| e.from)
    else {
        return Ok(effects);
    };

    // Head de chaîne = remonter les `in` jusqu'au node sans `in` entrant.
    let mut head = feeder;
    let mut visited = std::collections::HashSet::new();
    while visited.insert(head) {
        match graph
            .edges
            .iter()
            .find(|e| e.to == head && e.to_port == "in")
        {
            Some(e) => head = e.from,
            None => break,
        }
    }
    if let Some(head_node) = graph.nodes.get(&head) {
        match head_node.node_type {
            NodeType::Merge => {
                if let Some(s) = head_node.params.get("strategy").and_then(|v| v.as_str()) {
                    use std::str::FromStr;
                    let strat = crate::merge_runtime::MergeStrategy::from_str(s).map_err(|e| {
                        PostProcessCompileError::InvalidParameter(format!("Merge node: {e}"))
                    })?;
                    effects.strategy = Some(strat);
                }
            }
            NodeType::MoveRef => {
                // `move_id` vide = fallback sur le merge complet.
                if let Some(id) = head_node
                    .params
                    .get("move_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    effects.move_ref = Some(id.to_string());
                }
            }
            _ => {}
        }
    }

    // Capteurs alimentés par le node final de la chaîne uniquement.
    for node in graph.nodes.values() {
        let fed_by_final = graph
            .edges
            .iter()
            .any(|e| e.to == node.id && e.to_port == "in" && e.from == feeder);
        if !fed_by_final {
            continue;
        }
        match node.node_type {
            NodeType::Zone => {
                let zone = Zone::from_node_params(&node.params).map_err(|e| {
                    PostProcessCompileError::InvalidParameter(format!("Zone node: {e}"))
                })?;
                effects.zones.push(zone);
            }
            NodeType::Velocity => {
                let m = ChannelModulation::from_node_params(&node.params).map_err(|e| {
                    PostProcessCompileError::InvalidParameter(format!("Velocity node: {e}"))
                })?;
                effects.modulations.push(m);
            }
            _ => {}
        }
    }
    Ok(effects)
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
    let bary_flags: Vec<bool> = chain
        .iter()
        .map(|n| n.node_type == NodeType::Barycenter)
        .collect();

    // La PostProcessFn applique les transformations en séquence. Un node
    // `Barycenter` ne touche pas les positions : il bascule `ctx.origin`
    // sur l'isobarycentre des `track_positions` pour les transforms qui
    // le SUIVENT dans la chaîne — la position du node a donc un sens.
    Ok(Box::new(move |ctx: &PostProcessContext, positions| {
        let mut result = positions;
        let mut origin = ctx.origin;
        for (i, transform) in transforms.iter().enumerate() {
            if bary_flags[i] && !ctx.track_positions.is_empty() {
                let n = ctx.track_positions.len() as f64;
                origin = ctx
                    .track_positions
                    .values()
                    .fold(nalgebra::Vector3::zeros(), |acc, p| {
                        acc + nalgebra::Vector3::new(p[0], p[1], p[2])
                    })
                    / n;
            }
            let ctx_eff = PostProcessContext { origin, ..*ctx };
            result = transform(&ctx_eff, result);
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
                NodeType::Merge | NodeType::MoveRef => break,
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
