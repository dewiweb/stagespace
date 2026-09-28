use super::transforms::is_post_process_node;
use super::*;
use crate::audio::AudioState;
use crate::graph::{Edge, Graph, Node, NodeId};
use crate::runtime::MacroState;
use std::collections::HashMap;
use std::sync::Arc;

fn make_graph(nodes: Vec<(NodeType, serde_json::Value)>, edges: Vec<(usize, usize)>) -> Graph {
    let mut graph = Graph::new();
    let ids: Vec<NodeId> = (0..nodes.len()).map(|_| NodeId::new()).collect();
    for (i, (nt, params)) in nodes.into_iter().enumerate() {
        graph.add_node(Node {
            id: ids[i],
            node_type: nt,
            params,
            position: (0.0, 0.0),
        });
    }
    for (from, to) in edges {
        graph.add_edge(Edge {
            from: ids[from],
            to: ids[to],
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
    let result = run_test(
        graph,
        positions.clone(),
        HashMap::new(),
        nalgebra::Vector3::zeros(),
    );
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
    let result = run_test(
        graph,
        positions,
        manual_positions,
        nalgebra::Vector3::zeros(),
    );
    // Object 0 should be overridden to [5, 5, 5]
    assert!((result[0].1.x - 5.0).abs() < 1e-10);
    assert!((result[0].1.y - 5.0).abs() < 1e-10);
    // Object 1 should be unchanged
    assert!((result[1].1.y - 1.0).abs() < 1e-10);
}

/// Test: Offset node adds shift only — positions are world-space, the move
/// origin is already applied by the worker transform (no +origin here).
#[test]
fn test_compile_offset_with_origin() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Offset,
                serde_json::json!({"x": 1.0, "y": 0.0, "z": 0.0}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );

    let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
    let origin = nalgebra::Vector3::new(2.0, 0.0, 0.0);
    let result = run_test(graph, positions, HashMap::new(), origin);
    // pos + shift = 1.0 + 1.0 = 2.0 (origin est un pivot, pas une translation)
    assert!((result[0].1.x - 2.0).abs() < 1e-10);
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
    let fn_compiled = compile_post_process(PostProcessCompileParams {
        graph,
        macros: macros_arc,
    })
    .unwrap();

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
            (
                NodeType::RadiusScale,
                serde_json::json!({"radius_scale": 2.0}),
            ),
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
            (
                NodeType::HeightOffset,
                serde_json::json!({"height_offset": 1.5}),
            ),
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
    let result = run_test_full(
        graph,
        positions,
        HashMap::new(),
        origin,
        HashMap::new(),
        track_depths,
    );
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
    let result = run_test_full(
        graph,
        positions,
        HashMap::new(),
        origin,
        track_positions,
        vec![],
    );
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
            (
                NodeType::RadiusScale,
                serde_json::json!({"radius_scale": 2.0}),
            ),
            (
                NodeType::HeightOffset,
                serde_json::json!({"height_offset": 1.0}),
            ),
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

/// Test: compile_post_process rejette un graph global contenant un engine
/// (Circular) — la validation de contexte doit l'attraper.
#[test]
fn test_compile_rejects_engine_in_global_graph() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (NodeType::Circular, serde_json::json!({"n_objects": 3})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );

    let macros = Arc::new(MacroState::new());
    let result = compile_post_process(PostProcessCompileParams { graph, macros });
    assert!(result.is_err());
    match result {
        Err(PostProcessCompileError::ValidationFailed(msg)) => {
            assert!(
                msg.contains("ContextIncompatible"),
                "Expected ContextIncompatible, got: {msg}"
            );
        }
        Err(other) => panic!("Expected ValidationFailed, got {other:?}"),
        Ok(_) => panic!("Expected error, got Ok"),
    }
}

/// Test: compile_post_process rejette un graph global sans source
/// (Input/Merge/MoveRef) — doit échouer avec MissingRequiredNode.
#[test]
fn test_compile_rejects_global_without_source() {
    let graph = make_graph(
        vec![
            (NodeType::Scale, serde_json::json!({"scale": 2.0})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1)],
    );

    let macros = Arc::new(MacroState::new());
    let result = compile_post_process(PostProcessCompileParams { graph, macros });
    assert!(result.is_err());
    match result {
        Err(PostProcessCompileError::ValidationFailed(msg)) => {
            assert!(
                msg.contains("MissingRequiredNode"),
                "Expected MissingRequiredNode, got: {msg}"
            );
        }
        Err(other) => panic!("Expected ValidationFailed, got {other:?}"),
        Ok(_) => panic!("Expected error, got Ok"),
    }
}

/// Test: build_transform_chain lève une erreur explicite si on rencontre
/// un node non-post-process qui n'est pas Input/Merge/MoveRef.
/// Ce test bypass la validation pour tester la garde défensive.
#[test]
fn test_build_transform_chain_rejects_engine() {
    let mut graph = Graph::new();
    let input = Node::new(NodeType::Input);
    let circular = Node::new(NodeType::Circular);
    let output = Node::new(NodeType::Output);

    let id_input = input.id;
    let id_circular = circular.id;
    let id_output = output.id;

    graph.add_node(input);
    graph.add_node(circular);
    graph.add_node(output);

    graph.add_edge(Edge {
        from: id_input,
        to: id_circular,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });
    graph.add_edge(Edge {
        from: id_circular,
        to: id_output,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });

    // On appelle build_transform_chain directement (sans validation)
    let result = build_transform_chain(
        &graph,
        graph
            .nodes
            .values()
            .find(|n| n.node_type == NodeType::Output)
            .unwrap()
            .id,
    );
    assert!(result.is_err());
    match result {
        Err(PostProcessCompileError::InvalidNode(msg)) => {
            assert!(
                msg.contains("Circular"),
                "Expected mention of Circular, got: {msg}"
            );
        }
        other => panic!("Expected InvalidNode, got {other:?}"),
    }
}

#[test]
fn test_extract_graph_effects_zone_and_velocity() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Zone,
                serde_json::json!({
                    "shape": "sphere", "center": [0, 0, 0], "radius": 2.0,
                    "falloff": 0.5, "channels": {"gain": 0.0, "spread": 1.0}
                }),
            ),
            (
                NodeType::Velocity,
                serde_json::json!({
                    "source": "speed", "channel": "distance", "scale": 0.1, "max": 2.0
                }),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2), (2, 3)],
    );

    let effects = extract_graph_effects(&graph).unwrap();
    assert_eq!(effects.zones.len(), 1);
    assert_eq!(effects.modulations.len(), 1);
    assert_eq!(effects.zones[0].channels.gain, Some(0.0));
    assert_eq!(
        effects.modulations[0].channel,
        crate::SpatialChannel::Distance
    );
    assert_eq!(effects.modulations[0].max, 2.0);
}

#[test]
fn test_extract_graph_effects_empty_and_invalid() {
    // Pas de nodes d'effets → listes vides
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (NodeType::Scale, serde_json::json!({"scale": 2.0})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let effects = extract_graph_effects(&graph).unwrap();
    assert!(effects.zones.is_empty());
    assert!(effects.modulations.is_empty());

    // Zone sans channels → erreur (mieux vaut échouer que perdre l'effet)
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (NodeType::Zone, serde_json::json!({"shape": "sphere"})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    assert!(extract_graph_effects(&graph).is_err());
}

#[test]
fn test_extract_graph_effects_merge_strategy() {
    use crate::merge_runtime::MergeStrategy;

    // Merge avec strategy explicite → extraite
    let graph = make_graph(
        vec![
            (NodeType::Merge, serde_json::json!({"strategy": "blend"})),
            (NodeType::Scale, serde_json::json!({"scale": 1.0})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let effects = extract_graph_effects(&graph).unwrap();
    assert_eq!(effects.strategy, Some(MergeStrategy::Blend));

    // Merge sans param → None : la stratégie courante est conservée
    let graph = make_graph(
        vec![
            (NodeType::Merge, serde_json::json!({})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1)],
    );
    let effects = extract_graph_effects(&graph).unwrap();
    assert_eq!(effects.strategy, None);

    // Strategy invalide → erreur (pas de fallback silencieux)
    let graph = make_graph(
        vec![
            (NodeType::Merge, serde_json::json!({"strategy": "bogus"})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1)],
    );
    assert!(extract_graph_effects(&graph).is_err());
}

#[test]
fn test_compile_graph_with_zone_velocity_passthrough() {
    // Zone/Velocity dans la chaîne : pass-through pour les positions,
    // la compilation du graphe complet reste valide.
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Zone,
                serde_json::json!({"shape": "sphere", "channels": {"gain": 0.0}}),
            ),
            (
                NodeType::Velocity,
                serde_json::json!({"source": "speed", "channel": "spread"}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2), (2, 3)],
    );
    let positions = vec![(0, nalgebra::Vector3::new(1.0, 2.0, 3.0))];
    let out = run_test(
        graph,
        positions.clone(),
        HashMap::new(),
        nalgebra::Vector3::zeros(),
    );
    assert_eq!(out, positions, "Zone/Velocity must not modify positions");
}

// ── Audit T2 : clés du schema UI unifiées sub-graph/global ────────────

/// Le schema UI envoie x/y/z (comme le modifier sub-graph) — avant T2 le
/// post-process ne lisait que `scale` et les paramètres étaient ignorés.
#[test]
fn test_compile_scale_node_per_axis() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Scale,
                serde_json::json!({"x": 2.0, "y": 3.0, "z": 0.5}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let positions = vec![(0, nalgebra::Vector3::new(1.0, 1.0, 1.0))];
    let result = run_test(graph, positions, HashMap::new(), nalgebra::Vector3::zeros());
    assert!((result[0].1.x - 2.0).abs() < 1e-10);
    assert!((result[0].1.y - 3.0).abs() < 1e-10);
    assert!((result[0].1.z - 0.5).abs() < 1e-10);
}

/// Mirror global : le schema canonique est `plane` (xy/xz/yz) + `offset`
/// — l'ancienne impl lisait `axis` et cassait silencieusement. Le legacy
/// `axis` reste accepté en alias.
#[test]
fn test_compile_mirror_plane_schema() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Mirror,
                serde_json::json!({"plane": "yz", "offset": 1.0}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    // plan yz à offset 1 dans le repère origin : x' = 2*1 - x
    let positions = vec![(0, nalgebra::Vector3::new(4.0, 5.0, 6.0))];
    let result = run_test(graph, positions, HashMap::new(), nalgebra::Vector3::zeros());
    assert!((result[0].1.x - (-2.0)).abs() < 1e-10);
    assert!((result[0].1.y - 5.0).abs() < 1e-10);
    assert!((result[0].1.z - 6.0).abs() < 1e-10);

    // Alias legacy : axis "x" ⇔ plane "yz" (offset 0)
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (NodeType::Mirror, serde_json::json!({"axis": "x"})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let positions = vec![(0, nalgebra::Vector3::new(4.0, 5.0, 6.0))];
    let result = run_test(graph, positions, HashMap::new(), nalgebra::Vector3::zeros());
    assert!((result[0].1.x - (-4.0)).abs() < 1e-10);
}

/// Ordre de rotation unifié avec le modifier sub-graph : X puis Y puis Z
/// (rot = rz·ry·rx). pitch=90° puis yaw=90° sur +X : pitch ne change pas
/// +X, yaw l'envoie sur -Z. L'ancien ordre (rz·rx·ry) donnait +Y.
#[test]
fn test_compile_rotate_unified_order() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Rotate,
                serde_json::json!({"yaw": 90.0, "pitch": 90.0, "roll": 0.0}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
    let result = run_test(graph, positions, HashMap::new(), nalgebra::Vector3::zeros());
    assert!((result[0].1.x).abs() < 1e-10, "x={}", result[0].1.x);
    assert!((result[0].1.y).abs() < 1e-10, "y={}", result[0].1.y);
    assert!((result[0].1.z + 1.0).abs() < 1e-10, "z={}", result[0].1.z);
}

/// extract_graph_effects remonte Barycenter et MoveRef.move_id — ils
/// n'étaient pas lus du tout (audit T2).
#[test]
fn test_extract_effects_barycenter_and_moveref() {
    let graph = make_graph(
        vec![
            (NodeType::MoveRef, serde_json::json!({"move_id": "slot-2"})),
            (NodeType::Barycenter, serde_json::json!({})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let effects = extract_graph_effects(&graph).unwrap();
    assert!(effects.barycenter);
    assert_eq!(effects.move_ref.as_deref(), Some("slot-2"));

    // MoveRef sans move_id → None (fallback merge complet)
    let graph = make_graph(
        vec![
            (NodeType::MoveRef, serde_json::json!({"move_id": ""})),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1)],
    );
    let effects = extract_graph_effects(&graph).unwrap();
    assert!(!effects.barycenter);
    assert!(effects.move_ref.is_none());
}

/// LFO en post-process : l'oscillation anime les positions mergées dans
/// le temps (ctx.t). Régression — LFO était SubOnly et rejeté du graph
/// global alors que le ctx transporte t.
#[test]
fn test_lfo_oscillates_in_global_graph() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::LFO,
                serde_json::json!({
                    "waveform": "sine", "frequency": 1.0,
                    "amplitude": 0.5, "axis": "y", "phase": 0.0
                }),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let macros = Arc::new(MacroState::new());
    let f = compile_post_process(PostProcessCompileParams { graph, macros }).unwrap();

    let positions = vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
    let eval = |t: f64| {
        let m = MacroState::new();
        let audio = AudioState::new();
        let tp = HashMap::new();
        let mp = HashMap::new();
        let td: Vec<f64> = vec![];
        let ctx = PostProcessContext {
            t,
            macros: &m,
            audio_state: &audio,
            track_positions: &tp,
            manual_positions: &mp,
            origin: nalgebra::Vector3::zeros(),
            track_depths: &td,
        };
        f(&ctx, positions.clone())
    };

    // sine(2π·t) : t=0 → 0, t=0.25 → +0.5, t=0.75 → −0.5 sur Y
    assert!((eval(0.0)[0].1.y).abs() < 1e-10);
    assert!((eval(0.25)[0].1.y - 0.5).abs() < 1e-10);
    assert!((eval(0.75)[0].1.y + 0.5).abs() < 1e-10);
    // x/z inchangés
    assert!((eval(0.25)[0].1.x - 1.0).abs() < 1e-10);
}

/// Jitter en post-process : bruit déterministe par track (idx = seed-stable),
/// positions non statiques dans le temps.
#[test]
fn test_jitter_in_global_graph() {
    let graph = make_graph(
        vec![
            (NodeType::Input, serde_json::json!({})),
            (
                NodeType::Jitter,
                serde_json::json!({"intensity": 0.3, "frequency": 2.0, "seed": 7.0}),
            ),
            (NodeType::Output, serde_json::json!({})),
        ],
        vec![(0, 1), (1, 2)],
    );
    let macros = Arc::new(MacroState::new());
    let f = compile_post_process(PostProcessCompileParams { graph, macros }).unwrap();

    let positions = vec![
        (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
        (3, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
    ];
    let eval = |t: f64| {
        let m = MacroState::new();
        let audio = AudioState::new();
        let tp = HashMap::new();
        let mp = HashMap::new();
        let td: Vec<f64> = vec![];
        let ctx = PostProcessContext {
            t,
            macros: &m,
            audio_state: &audio,
            track_positions: &tp,
            manual_positions: &mp,
            origin: nalgebra::Vector3::zeros(),
            track_depths: &td,
        };
        f(&ctx, positions.clone())
    };

    let a1 = eval(1.0);
    let b1 = eval(1.0);
    assert_eq!(a1, b1, "jitter must be deterministic at same t");
    let a2 = eval(1.37);
    assert_ne!(a1, a2, "jitter must vary with t");
    // Bruit par objet : deux tracks différentes → offsets différents
    assert_ne!(
        a1[0].1 - nalgebra::Vector3::new(1.0, 0.0, 0.0),
        a1[1].1 - nalgebra::Vector3::new(2.0, 0.0, 0.0),
        "per-object seeds must decorrelate tracks"
    );
}

/// is_post_process_node reconnaît LFO/Jitter (sinon la chaîne s'arrête
/// sur eux et ils échouent en InvalidNode).
#[test]
fn test_lfo_jitter_are_post_process_nodes() {
    assert!(is_post_process_node(&NodeType::LFO));
    assert!(is_post_process_node(&NodeType::Jitter));
}
