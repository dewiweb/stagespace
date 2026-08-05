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

use crate::graph::{Graph, Node, NodeId, NodeType};
use crate::runtime::{PostProcessFn, PostProcessContext, MacroState};
use crate::validator::{GraphContext, Validator};
use nalgebra::Vector3;
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
            .map(|e| format!("{:?}", e))
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
    let transforms = compile_chain(&chain)?;

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
        if is_post_process_node(&node.node_type) {
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
                        "{:?} is not a post-process node and cannot appear in the global graph chain",
                        other
                    )));
                }
            }
        }
    }

    // Inverser la chaîne : amont → aval
    chain.reverse();
    Ok(chain)
}

/// Vrai si le node est un node de post-processing
fn is_post_process_node(node_type: &NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Scale
            | NodeType::Rotate
            | NodeType::Offset
            | NodeType::RadiusScale
            | NodeType::HeightOffset
            | NodeType::PerTrackDepth
            | NodeType::Barycenter
            | NodeType::AudioFalloff
            | NodeType::ManualPosition
            | NodeType::Mirror
            | NodeType::Clamp
    )
}

/// Une transformation compilée
type TransformFn = Box<
    dyn Fn(&PostProcessContext, Vec<(usize, Vector3<f64>)>) -> Vec<(usize, Vector3<f64>)>
        + Send
        + Sync,
>;

/// Compile la chaîne de nodes en une liste de transformations
fn compile_chain(chain: &[Node]) -> Result<Vec<TransformFn>, PostProcessCompileError> {
    chain
        .iter()
        .map(|node| compile_transform_node(node))
        .collect()
}

/// Compile un node de post-processing en une transformation
fn compile_transform_node(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    match node.node_type {
        NodeType::Scale => compile_scale(node),
        NodeType::Rotate => compile_rotate(node),
        NodeType::Offset => compile_offset(node),
        NodeType::RadiusScale => compile_radius_scale(node),
        NodeType::HeightOffset => compile_height_offset(node),
        NodeType::PerTrackDepth => compile_per_track_depth(node),
        NodeType::Barycenter => compile_barycenter(node),
        NodeType::AudioFalloff => compile_audio_falloff(node),
        NodeType::ManualPosition => compile_manual_position(node),
        NodeType::Mirror => compile_mirror(node),
        NodeType::Clamp => compile_clamp(node),
        _ => Err(PostProcessCompileError::InvalidNode(format!(
            "{:?} is not a post-process node",
            node.node_type
        ))),
    }
}

// ─── Helpers pour lire les params ───

#[allow(dead_code)]
fn get_param_f64(node: &Node, key: &str) -> Result<f64, PostProcessCompileError> {
    node.params
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| PostProcessCompileError::MissingParameter(key.to_string()))
}

fn get_param_f64_or(node: &Node, key: &str, default: f64) -> f64 {
    node.params.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

fn get_param_array_f64(node: &Node, key: &str) -> Vec<f64> {
    node.params
        .get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_f64())
                .collect()
        })
        .unwrap_or_default()
}

// ─── Compilations des nodes ───

fn compile_scale(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default_scale = get_param_f64_or(node, "scale", 1.0);
    Ok(Box::new(move |_ctx, positions| {
        // Si le MacroState a un scale != 1.0, l'utiliser ; sinon utiliser le param du node
        let macro_scale = _ctx.macros.get_scale();
        let scale = if (macro_scale - 1.0).abs() > 1e-10 {
            macro_scale
        } else {
            default_scale
        };
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, pos * scale))
            .collect()
    }))
}

fn compile_rotate(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default_yaw = get_param_f64_or(node, "yaw", 0.0);
    let _default_pitch = get_param_f64_or(node, "pitch", 0.0);
    let _default_roll = get_param_f64_or(node, "roll", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let (yaw, pitch, roll) = ctx.macros.get_rotation();
        let has_rotation = yaw != 0.0 || pitch != 0.0 || roll != 0.0;
        if !has_rotation {
            return positions;
        }
        use nalgebra::Rotation3;
        let ry = Rotation3::from_axis_angle(&nalgebra::Vector3::y_axis(), yaw.to_radians());
        let rx = Rotation3::from_axis_angle(&nalgebra::Vector3::x_axis(), pitch.to_radians());
        let rz = Rotation3::from_axis_angle(&nalgebra::Vector3::z_axis(), roll.to_radians());
        let rot = rz * rx * ry;
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, rot * pos))
            .collect()
    }))
}

fn compile_offset(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default_x = get_param_f64_or(node, "x", 0.0);
    let default_y = get_param_f64_or(node, "y", 0.0);
    let default_z = get_param_f64_or(node, "z", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let shift = ctx.macros.get_shift();
        let dx = if shift.x != 0.0 { shift.x } else { default_x };
        let dy = if shift.y != 0.0 { shift.y } else { default_y };
        let dz = if shift.z != 0.0 { shift.z } else { default_z };
        // Comme default_post_process_fn : pos + origin + shift
        // (les positions des engines sont relatives à l'origin)
        let offset = ctx.origin + Vector3::new(dx, dy, dz);
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, pos + offset))
            .collect()
    }))
}

fn compile_radius_scale(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default = get_param_f64_or(node, "radius_scale", 1.0);
    Ok(Box::new(move |ctx, positions| {
        let radius_scale = ctx.macros.get_radius_scale();
        if (radius_scale - 1.0).abs() <= 1e-10 {
            return positions;
        }
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| (idx, origin + (pos - origin) * radius_scale))
            .collect()
    }))
}

fn compile_height_offset(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let _default = get_param_f64_or(node, "height_offset", 0.0);
    Ok(Box::new(move |ctx, positions| {
        let height_offset = ctx.macros.get_height_offset();
        if height_offset.abs() <= 1e-10 {
            return positions;
        }
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    Vector3::new(pos.x, pos.y + height_offset, pos.z),
                )
            })
            .collect()
    }))
}

fn compile_per_track_depth(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let default_depths = get_param_array_f64(node, "depths");
    Ok(Box::new(move |ctx, positions| {
        // Priorité : track_depths du contexte > param du node
        let depths = if !ctx.track_depths.is_empty() {
            ctx.track_depths
        } else {
            &default_depths
        };
        if depths.is_empty() {
            return positions;
        }
        let origin = ctx.origin;
        positions
            .into_iter()
            .map(|(idx, pos)| {
                let depth = depths.get(idx).copied().unwrap_or(1.0);
                (idx, origin + (pos - origin) * depth)
            })
            .collect()
    }))
}

fn compile_barycenter(_node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    // Le node Barycenter calcule l'origin depuis les track_positions
    // et l'utilise comme centre pour les transformations ultérieures.
    // Il ne modifie pas les positions lui-même — il met à jour l'origin.
    // Note : dans l'architecture actuelle, l'origin est déjà calculée
    // par l'app et passée dans le contexte. Ce node est un no-op pour l'instant.
    Ok(Box::new(|_ctx, positions| positions))
}

fn compile_audio_falloff(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let amount = get_param_f64_or(node, "amount", 1.0);
    let target = node
        .params
        .get("target")
        .and_then(|v| v.as_str())
        .unwrap_or("scale")
        .to_string();
    Ok(Box::new(move |ctx, positions| {
        // Lire l'amplitude audio depuis l'AudioState
        let amplitude = ctx.audio_state.amplitude.as_ref().map(|a| a.rms).unwrap_or(0.0);
        // Appliquer un facteur basé sur l'amplitude
        let factor = 1.0 + (amplitude - 0.5) * amount;
        match target.as_str() {
            "scale" => {
                positions
                    .into_iter()
                    .map(|(idx, pos)| (idx, pos * factor))
                    .collect()
            }
            "height" => {
                let offset = (amplitude - 0.5) * amount;
                positions
                    .into_iter()
                    .map(|(idx, pos)| {
                        (idx, Vector3::new(pos.x, pos.y + offset, pos.z))
                    })
                    .collect()
            }
            _ => positions,
        }
    }))
}

fn compile_manual_position(_node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    Ok(Box::new(move |ctx, positions| {
        if ctx.manual_positions.is_empty() {
            return positions;
        }
        positions
            .into_iter()
            .map(|(idx, pos)| {
                if let Some(manual) = ctx.manual_positions.get(&idx) {
                    (idx, Vector3::new(manual[0], manual[1], manual[2]))
                } else {
                    (idx, pos)
                }
            })
            .collect()
    }))
}

fn compile_mirror(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let axis = node
        .params
        .get("axis")
        .and_then(|v| v.as_str())
        .unwrap_or("x")
        .to_string();
    Ok(Box::new(move |_ctx, positions| {
        match axis.as_str() {
            "x" => positions
                .into_iter()
                .map(|(idx, pos)| (idx, Vector3::new(-pos.x, pos.y, pos.z)))
                .collect(),
            "y" => positions
                .into_iter()
                .map(|(idx, pos)| (idx, Vector3::new(pos.x, -pos.y, pos.z)))
                .collect(),
            "z" => positions
                .into_iter()
                .map(|(idx, pos)| (idx, Vector3::new(pos.x, pos.y, -pos.z)))
                .collect(),
            _ => positions,
        }
    }))
}

fn compile_clamp(node: &Node) -> Result<TransformFn, PostProcessCompileError> {
    let min = get_param_f64_or(node, "min", -10.0);
    let max = get_param_f64_or(node, "max", 10.0);
    Ok(Box::new(move |_ctx, positions| {
        positions
            .into_iter()
            .map(|(idx, pos)| {
                (
                    idx,
                    Vector3::new(
                        pos.x.clamp(min, max),
                        pos.y.clamp(min, max),
                        pos.z.clamp(min, max),
                    ),
                )
            })
            .collect()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{Graph, Node, Edge, NodeId};
    use crate::runtime::MacroState;
    use crate::audio::AudioState;
    use std::sync::Arc;
    use std::collections::HashMap;

    fn make_graph(nodes: Vec<(NodeType, serde_json::Value)>, edges: Vec<(usize, usize)>) -> Graph {
        let mut graph = Graph::new();
        let ids: Vec<NodeId> = (0..nodes.len()).map(|_| NodeId::new()).collect();
        for (i, (nt, params)) in nodes.into_iter().enumerate() {
            graph.add_node(Node {
                id: ids[i].clone(),
                node_type: nt,
                params,
                position: (0.0, 0.0),
            });
        }
        for (from, to) in edges {
            graph.add_edge(Edge {
                from: ids[from].clone(),
                to: ids[to].clone(),
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
        }
        graph
    }

    fn run_test(
        graph: Graph,
        positions: Vec<(usize, nalgebra::Vector3<f64>)>,
        manual_positions: HashMap<usize, [f64; 3]>,
        origin: nalgebra::Vector3<f64>,
    ) -> Vec<(usize, nalgebra::Vector3<f64>)> {
        let macros = Arc::new(MacroState::new());
        let fn_compiled = compile_post_process(PostProcessCompileParams { graph, macros }).unwrap();

        let macros_ref = MacroState::new();
        let audio = AudioState::new();
        let track_positions = HashMap::new();
        let track_depths: Vec<f64> = vec![];
        let ctx = PostProcessContext {
            t: 0.0,
            macros: &macros_ref,
            audio_state: &audio,
            track_positions: &track_positions,
            manual_positions: &manual_positions,
            origin,
            track_depths: &track_depths,
        };
        fn_compiled(&ctx, positions)
    }

    /// Test: compiled identity graph (Input → Output) returns positions unchanged
    #[test]
    fn test_compile_identity_graph() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1)],
        );

        let positions = vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(0.0, 1.0, 0.0)),
        ];
        let result = run_test(graph, positions.clone(), HashMap::new(), nalgebra::Vector3::zeros());
        assert_eq!(result.len(), 2);
        assert!((result[0].1.x - 1.0).abs() < 1e-10);
    }

    /// Test: compiled Scale node scales positions (node param, not macros)
    #[test]
    fn test_compile_scale_node() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Scale, serde_json::json!({"scale": 2.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let result = run_test(graph, positions, HashMap::new(), nalgebra::Vector3::zeros());
        // macros scale = 1.0 (default), so node param scale = 2.0 should be used
        assert!((result[0].1.x - 2.0).abs() < 1e-10);
    }

    /// Test: ManualPosition node overrides positions
    #[test]
    fn test_compile_manual_position_node() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::ManualPosition, serde_json::json!({})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let mut manual_positions = HashMap::new();
        manual_positions.insert(0usize, [5.0, 5.0, 5.0]);

        let positions = vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(0.0, 1.0, 0.0)),
        ];
        let result = run_test(graph, positions, manual_positions, nalgebra::Vector3::zeros());
        // Object 0 should be overridden to [5, 5, 5]
        assert!((result[0].1.x - 5.0).abs() < 1e-10);
        assert!((result[0].1.y - 5.0).abs() < 1e-10);
        // Object 1 should be unchanged
        assert!((result[1].1.y - 1.0).abs() < 1e-10);
    }

    /// Test: Offset node adds origin + shift (matching default_post_process_fn)
    #[test]
    fn test_compile_offset_with_origin() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Offset, serde_json::json!({"x": 1.0, "y": 0.0, "z": 0.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(2.0, 0.0, 0.0);
        let result = run_test(graph, positions, HashMap::new(), origin);
        // pos + origin + shift = 1.0 + 2.0 + 1.0 = 4.0
        assert!((result[0].1.x - 4.0).abs() < 1e-10);
    }

    /// Helper étendu : permet de spécifier track_positions, track_depths, et macros
    fn run_test_full(
        graph: Graph,
        positions: Vec<(usize, nalgebra::Vector3<f64>)>,
        manual_positions: HashMap<usize, [f64; 3]>,
        origin: nalgebra::Vector3<f64>,
        track_positions: HashMap<u32, [f64; 3]>,
        track_depths: Vec<f64>,
    ) -> Vec<(usize, nalgebra::Vector3<f64>)> {
        let macros = Arc::new(MacroState::new());
        let fn_compiled = compile_post_process(PostProcessCompileParams { graph, macros }).unwrap();

        let macros_ref = MacroState::new();
        let audio = AudioState::new();
        let ctx = PostProcessContext {
            t: 0.0,
            macros: &macros_ref,
            audio_state: &audio,
            track_positions: &track_positions,
            manual_positions: &manual_positions,
            origin,
            track_depths: &track_depths,
        };
        fn_compiled(&ctx, positions)
    }

    /// Helper avec macros personnalisées (pour tester RadiusScale, HeightOffset, etc.)
    fn run_test_with_macros(
        graph: Graph,
        positions: Vec<(usize, nalgebra::Vector3<f64>)>,
        origin: nalgebra::Vector3<f64>,
        macros: MacroState,
    ) -> Vec<(usize, nalgebra::Vector3<f64>)> {
        let macros_arc = Arc::new(MacroState::new());
        let fn_compiled = compile_post_process(PostProcessCompileParams { graph, macros: macros_arc }).unwrap();

        let audio = AudioState::new();
        let track_positions = HashMap::new();
        let track_depths: Vec<f64> = vec![];
        let ctx = PostProcessContext {
            t: 0.0,
            macros: &macros,
            audio_state: &audio,
            track_positions: &track_positions,
            manual_positions: &HashMap::new(),
            origin,
            track_depths: &track_depths,
        };
        fn_compiled(&ctx, positions)
    }

    /// Test: RadiusScale node scales distance from origin (uses macro live value)
    #[test]
    fn test_compile_radius_scale() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::RadiusScale, serde_json::json!({"radius_scale": 2.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let macros = MacroState::new();
        macros.set_radius_scale(2.0);
        let result = run_test_with_macros(graph, positions, origin, macros);
        // (pos - origin) * 2.0 + origin = 1.0 * 2.0 = 2.0
        assert!((result[0].1.x - 2.0).abs() < 1e-10);
    }

    /// Test: HeightOffset node adds offset to z (uses macro live value)
    #[test]
    fn test_compile_height_offset() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::HeightOffset, serde_json::json!({"height_offset": 1.5})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(0.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let macros = MacroState::new();
        macros.set_height_offset(1.5);
        let result = run_test_with_macros(graph, positions, origin, macros);
        // y + height_offset = 0.0 + 1.5 = 1.5
        assert!((result[0].1.y - 1.5).abs() < 1e-10);
    }

    /// Test: PerTrackDepth node scales positions by per-track depth factor
    #[test]
    fn test_compile_per_track_depth() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::PerTrackDepth, serde_json::json!({})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![
            (0, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(4.0, 0.0, 0.0)),
        ];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let track_depths = vec![0.5, 1.5];
        let result = run_test_full(graph, positions, HashMap::new(), origin, HashMap::new(), track_depths);
        // obj 0: (pos - origin) * 0.5 = 2.0 * 0.5 = 1.0
        assert!((result[0].1.x - 1.0).abs() < 1e-10);
        // obj 1: (pos - origin) * 1.5 = 4.0 * 1.5 = 6.0
        assert!((result[1].1.x - 6.0).abs() < 1e-10);
    }

    /// Test: Barycenter node is a no-op (origin is computed by the app, not the node)
    #[test]
    fn test_compile_barycenter() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Barycenter, serde_json::json!({"weight": 1.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(10.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let mut track_positions = HashMap::new();
        track_positions.insert(0u32, [1.0, 0.0, 0.0]);
        track_positions.insert(1u32, [3.0, 0.0, 0.0]);
        let result = run_test_full(graph, positions, HashMap::new(), origin, track_positions, vec![]);
        // Barycenter is a no-op — positions unchanged
        assert!((result[0].1.x - 10.0).abs() < 1e-10);
    }

    /// Test: MoveRef node is NOT a post-process node — build_transform_chain stops at it
    #[test]
    fn test_moveref_not_post_process() {
        assert!(!is_post_process_node(&NodeType::MoveRef));
    }

    /// Test: Merge node is NOT a post-process node — it's a source like Input
    #[test]
    fn test_merge_not_post_process() {
        assert!(!is_post_process_node(&NodeType::Merge));
    }

    /// Test: Input node is NOT a post-process node — it's the source
    #[test]
    fn test_input_not_post_process() {
        assert!(!is_post_process_node(&NodeType::Input));
    }

    /// Test: Output node is NOT a post-process node — it's the sink
    #[test]
    fn test_output_not_post_process() {
        assert!(!is_post_process_node(&NodeType::Output));
    }

    /// Test: chained post-process nodes (Input → RadiusScale → HeightOffset → Output)
    #[test]
    fn test_compile_chained_transforms() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::RadiusScale, serde_json::json!({"radius_scale": 2.0})),
                (NodeType::HeightOffset, serde_json::json!({"height_offset": 1.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2), (2, 3)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let macros = MacroState::new();
        macros.set_radius_scale(2.0);
        macros.set_height_offset(1.0);
        let result = run_test_with_macros(graph, positions, origin, macros);
        // After RadiusScale: x = 1.0 * 2.0 = 2.0
        // After HeightOffset: y = 0.0 + 1.0 = 1.0
        assert!((result[0].1.x - 2.0).abs() < 1e-10);
        assert!((result[0].1.y - 1.0).abs() < 1e-10);
    }

    /// Test: Rotate node rotates positions around origin (uses macro live value)
    #[test]
    fn test_compile_rotate() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Rotate, serde_json::json!({"yaw": 90.0})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let macros = MacroState::new();
        macros.set_rotation(90.0, 0.0, 0.0);
        let result = run_test_with_macros(graph, positions, origin, macros);
        // 90° yaw (around Y axis): (1,0,0) → (0, 0, -1)
        assert!((result[0].1.x).abs() < 1e-10);
        assert!((result[0].1.z + 1.0).abs() < 1e-10);
    }

    /// Test: Mirror node mirrors positions
    #[test]
    fn test_compile_mirror() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::Mirror, serde_json::json!({"axis": "x"})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 2.0, 3.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let result = run_test(graph, positions, HashMap::new(), origin);
        // Mirror x: x → -x
        assert!((result[0].1.x - (-1.0)).abs() < 1e-10);
        assert!((result[0].1.y - 2.0).abs() < 1e-10);
    }

    /// Test: ManualPosition node with empty manual_positions → no change
    #[test]
    fn test_compile_manual_position_empty() {
        let graph = make_graph(
            vec![
                (NodeType::Input, serde_json::json!({})),
                (NodeType::ManualPosition, serde_json::json!({})),
                (NodeType::Output, serde_json::json!({})),
            ],
            vec![(0, 1), (1, 2)],
        );

        let positions = vec![(0, nalgebra::Vector3::new(1.0, 2.0, 3.0))];
        let origin = nalgebra::Vector3::new(0.0, 0.0, 0.0);
        let result = run_test(graph, positions, HashMap::new(), origin);
        // No manual positions → unchanged
        assert!((result[0].1.x - 1.0).abs() < 1e-10);
        assert!((result[0].1.y - 2.0).abs() < 1e-10);
        assert!((result[0].1.z - 3.0).abs() < 1e-10);
    }
}
