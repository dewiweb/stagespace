use stagespace_engines::{AudioState, Edge, Graph, GraphJson, Node, NodeId, NodeType};
use std::collections::HashMap;

/// Helper : conversion graphe frontend → Rust Graph.
/// `graph_json` est le contrat wire typé (`GraphJson`) — la désérialisation a
/// déjà validé la structure (id/source/target présents).
///
/// `build_graph_from_value` est la porte d'entrée test/legacy pour les
/// payloads déjà matérialisés en `Value` (fixtures `json!`).
pub fn build_graph_from_json(
    graph_json: &GraphJson,
    audio_state: &AudioState,
) -> Result<Graph, String> {
    graph_json.check_version()?;

    let nodes = &graph_json.nodes;
    let edges = &graph_json.edges;

    // Bornes à la frontière IPC (audit B2) — rejet avant de construire le
    // Graph : le validator applique les mêmes limites, mais un payload
    // géant ne doit même pas être matérialisé.
    if nodes.len() > stagespace_engines::validator::MAX_GRAPH_NODES {
        return Err(format!(
            "Graph too large: {} nodes (max {})",
            nodes.len(),
            stagespace_engines::validator::MAX_GRAPH_NODES
        ));
    }
    if edges.len() > stagespace_engines::validator::MAX_GRAPH_EDGES {
        return Err(format!(
            "Graph too large: {} edges (max {})",
            edges.len(),
            stagespace_engines::validator::MAX_GRAPH_EDGES
        ));
    }

    let mut graph = Graph::new();
    let mut id_map: HashMap<String, NodeId> = HashMap::new();

    for node in nodes {
        let frontend_id = node.id.clone();

        // Priorité: data.type (le vrai type d'engine) > type (peut être "custom" en React Flow)
        let type_str = node
            .data
            .node_type
            .as_deref()
            .or(node.rf_type.as_deref())
            .ok_or("Missing node type")?;

        let node_type: NodeType = serde_json::from_value(serde_json::json!(type_str))
            .map_err(|e| format!("Invalid node type '{type_str}': {e}"))?;

        let mut params = if node.data.params.is_null() {
            serde_json::json!({})
        } else {
            node.data.params.clone()
        };

        // Injecter les valeurs audio
        if type_str == "BPM" {
            if let Some(bpm_data) = &audio_state.bpm {
                params["bpm"] = serde_json::json!(bpm_data.bpm);
            }
        }
        if type_str == "AudioAmplitude" {
            if let Some(amp_data) = &audio_state.amplitude {
                let band = params.get("band").and_then(|v| v.as_str()).unwrap_or("rms");
                let value = match band {
                    "bass" => amp_data.bass,
                    "mid" => amp_data.mid,
                    "high" => amp_data.high,
                    _ => amp_data.rms,
                };
                params["amplitude"] = serde_json::json!(value);
            }
        }

        // Convertir curve string pour les falloffs
        if type_str == "TimeFalloff"
            || type_str == "PointDistanceFalloff"
            || type_str == "DirectionalFalloff"
            || type_str == "AudioAmplitudeFalloff"
        {
            if let Some(curve_str) = params.get("curve").and_then(|v| v.as_str()) {
                let curve = match curve_str {
                    "ease_in" => "EaseIn",
                    "ease_out" => "EaseOut",
                    "ease_in_out" => "EaseInOut",
                    _ => "Linear",
                };
                params["curve"] = serde_json::json!(curve);
            }
        }

        let pos = node.position.as_ref();
        let x = pos.map(|p| p.x).unwrap_or(0.0) as f32;
        let y = pos.map(|p| p.y).unwrap_or(0.0) as f32;

        let new_id = NodeId::new();
        id_map.insert(frontend_id, new_id);
        graph.add_node(Node {
            id: new_id,
            node_type,
            params,
            position: (x, y),
        });
    }

    for edge in edges {
        let from = *id_map
            .get(edge.source.as_str())
            .ok_or_else(|| format!("Unknown source node id: {}", edge.source))?;
        let to = *id_map
            .get(edge.target.as_str())
            .ok_or_else(|| format!("Unknown target node id: {}", edge.target))?;
        let from_port = edge
            .sourceHandle
            .clone()
            .unwrap_or_else(|| "output".to_string());
        let to_port = edge
            .targetHandle
            .clone()
            .unwrap_or_else(|| "input".to_string());
        graph.add_edge(Edge {
            from,
            to,
            from_port,
            to_port,
        });
    }

    // Injecter n_objects du node Objects dans tous les engines qui ne l'ont pas
    // (ou qui ont une valeur différente) — évite les CountMismatch
    let objects_n = graph
        .nodes
        .values()
        .find(|n| n.node_type == NodeType::Objects)
        .and_then(|n| n.params.get("n_objects"))
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;

    for node in graph.nodes.values_mut() {
        match node.node_type {
            NodeType::Circular
            | NodeType::Elliptical
            | NodeType::Spiral
            | NodeType::Lissajous
            | NodeType::Figure8
            | NodeType::Linear
            | NodeType::Oscillation
            | NodeType::Formation
            | NodeType::PerlinNoise
            | NodeType::Converge
            | NodeType::Pendulum
            | NodeType::RoseCurve
            | NodeType::Helix
            | NodeType::Bouncing
            | NodeType::Spring
            | NodeType::Follow
            | NodeType::Swarm
            | NodeType::Avoidance
            | NodeType::CustomTrajectory
            | NodeType::DrawSpline
            | NodeType::EvaluateSpline
            | NodeType::TrimSpline
            | NodeType::OffsetSpline
            | NodeType::BPM
            | NodeType::AudioAmplitude
            | NodeType::AudioSpectrum
            | NodeType::OSCInput
            | NodeType::TimeFalloff
            | NodeType::PointDistanceFalloff
            | NodeType::DirectionalFalloff
            | NodeType::AudioAmplitudeFalloff => {
                // Forcer n_objects = objects_n pour tous les engines
                node.params["n_objects"] = serde_json::json!(objects_n);
            }
            _ => {}
        }
    }

    Ok(graph)
}

/// Compat test/legacy : désérialise un `Value` en `GraphJson` puis parse.
/// Les chemins de production passent par `build_graph_from_json` directement.
pub fn build_graph_from_value(
    graph_json: &serde_json::Value,
    audio_state: &AudioState,
) -> Result<Graph, String> {
    let typed: GraphJson = serde_json::from_value(graph_json.clone())
        .map_err(|e| format!("Invalid graph payload: {e}"))?;
    build_graph_from_json(&typed, audio_state)
}
