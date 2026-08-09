use stagespace_engines::{AudioState, Edge, Graph, Node, NodeId, NodeType};
use std::collections::HashMap;

/// Helper : conversion graphe frontend → Rust Graph
pub fn build_graph_from_json(
    graph_json: &serde_json::Value,
    audio_state: &AudioState,
) -> Result<Graph, String> {
    let nodes = graph_json
        .get("nodes")
        .and_then(|v| v.as_array())
        .ok_or("Missing 'nodes' array")?;
    let edges = graph_json
        .get("edges")
        .and_then(|v| v.as_array())
        .ok_or("Missing 'edges' array")?;

    let mut graph = Graph::new();
    let mut id_map: HashMap<String, NodeId> = HashMap::new();

    for node in nodes {
        let frontend_id = node
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("Missing node id")?
            .to_string();

        // Priorité: data.type (le vrai type d'engine) > type (peut être "custom" en React Flow)
        let type_str = node
            .get("data")
            .and_then(|d| d.get("type"))
            .and_then(|v| v.as_str())
            .or_else(|| node.get("type").and_then(|v| v.as_str()))
            .ok_or("Missing node type")?;

        let node_type: NodeType = serde_json::from_value(serde_json::json!(type_str))
            .map_err(|e| format!("Invalid node type '{type_str}': {e}"))?;

        let mut params = node
            .get("data")
            .and_then(|d| d.get("params"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));

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

        let pos = node.get("position");
        let x = pos
            .and_then(|p| p.get("x"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let y = pos
            .and_then(|p| p.get("y"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;

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
        let source = edge
            .get("source")
            .and_then(|v| v.as_str())
            .ok_or("Missing edge source")?;
        let target = edge
            .get("target")
            .and_then(|v| v.as_str())
            .ok_or("Missing edge target")?;
        let from = *id_map
            .get(source)
            .ok_or_else(|| format!("Unknown source node id: {source}"))?;
        let to = *id_map
            .get(target)
            .ok_or_else(|| format!("Unknown target node id: {target}"))?;
        let from_port = edge
            .get("sourceHandle")
            .and_then(|v| v.as_str())
            .unwrap_or("output")
            .to_string();
        let to_port = edge
            .get("targetHandle")
            .and_then(|v| v.as_str())
            .unwrap_or("input")
            .to_string();
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
                // Debug log pour les nodes spline
                if matches!(node.node_type, NodeType::DrawSpline | NodeType::EvaluateSpline | NodeType::TrimSpline | NodeType::OffsetSpline) {
                    let pts = node.params.get("points").and_then(|v| v.as_str()).unwrap_or("");
                    eprintln!("[DBG-PARSER] {:?} id={:?} n_objects={} points_len={} points_preview={}", node.node_type, node.id, objects_n, pts.len(), &pts[..pts.len().min(100)]);
                }
            }
            _ => {}
        }
    }

    Ok(graph)
}
