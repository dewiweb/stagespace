#[cfg(test)]
mod tests {
    use crate::compiler::{CompilationError, Compiler};
    use crate::graph::{Edge, Graph, Node, NodeType};

    #[test]
    fn test_compile_valid_graph() {
        let mut graph = Graph::new();

        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 9}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(
            NodeType::Circular,
            serde_json::json!({"n_objects": 9, "radius": 1.5}),
        );
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(circular);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_circular,
            from_port: "objects".to_string(),
            to_port: "objects".to_string(),
        });
        graph.add_edge(Edge {
            from: id_duration,
            to: id_circular,
            from_port: "duration".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: id_circular,
            to: id_output,
            from_port: "out".to_string(),
            to_port: "in".to_string(),
        });

        let result = Compiler::compile(&graph);
        assert!(result.is_ok());

        let func = result.unwrap();
        let pos = func(0.0, 0);
        assert!((pos.x - 1.5).abs() < 0.01);
    }

    #[test]
    fn test_compile_invalid_graph_cycle() {
        let mut graph = Graph::new();

        let node1 = Node::new(NodeType::Circular);
        let node2 = Node::new(NodeType::Duration);
        let node3 = Node::new(NodeType::Output);

        let id1 = node1.id;
        let id2 = node2.id;
        let id3 = node3.id;

        graph.add_node(node1);
        graph.add_node(node2);
        graph.add_node(node3);

        graph.add_edge(Edge {
            from: id1,
            to: id2,
            from_port: "out".to_string(),
            to_port: "in".to_string(),
        });
        graph.add_edge(Edge {
            from: id2,
            to: id3,
            from_port: "duration".to_string(),
            to_port: "in".to_string(),
        });
        graph.add_edge(Edge {
            from: id3,
            to: id1,
            from_port: "out".to_string(),
            to_port: "in".to_string(),
        });

        let result = Compiler::compile(&graph);
        assert!(result.is_err());
        if let Err(CompilationError::ValidationFailed(_)) = result {
            // Expected
        } else {
            panic!("Expected ValidationFailed error");
        }
    }

    #[test]
    fn test_compile_missing_output() {
        let mut graph = Graph::new();

        let objects = Node::new(NodeType::Objects);
        let circular = Node::new(NodeType::Circular);
        // Missing Output

        graph.add_node(objects);
        graph.add_node(circular);

        let result = Compiler::compile(&graph);
        assert!(result.is_err());
    }

    #[test]
    fn test_compile_different_engines() {
        let engines = vec![
            (NodeType::Circular, "circular"),
            (NodeType::Spiral, "spiral"),
            (NodeType::Lissajous, "lissajous"),
            (NodeType::Figure8, "figure8"),
        ];

        for (node_type, _name) in engines {
            let mut graph = Graph::new();

            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let engine = Node::with_params(node_type.clone(), serde_json::json!({"n_objects": 3}));
            let output = Node::new(NodeType::Output);

            let id_objects = objects.id;
            let id_duration = duration.id;
            let id_engine = engine.id;
            let id_output = output.id;

            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(engine);
            graph.add_node(output);

            graph.add_edge(Edge {
                from: id_objects,
                to: id_engine,
                from_port: "objects".to_string(),
                to_port: "objects".to_string(),
            });
            graph.add_edge(Edge {
                from: id_duration,
                to: id_engine,
                from_port: "duration".to_string(),
                to_port: "duration".to_string(),
            });
            graph.add_edge(Edge {
                from: id_engine,
                to: id_output,
                from_port: "out".to_string(),
                to_port: "in".to_string(),
            });

            let result = Compiler::compile(&graph);
            assert!(result.is_ok(), "Failed to compile {node_type:?}");
        }
    }

    /// Les falloffs sont des engines autonomes : Objects → input et
    /// Duration → duration doivent compiler (n_objects/duration résolus
    /// via les edges, comme les autres moteurs).
    #[test]
    fn test_compile_falloffs_with_objects_duration() {
        // Falloffs riches → Output direct
        for node_type in [NodeType::TimeFalloff, NodeType::PointDistanceFalloff] {
            let mut graph = Graph::new();
            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            // Pas de n_objects/duration en param — résolution via les edges
            let falloff = Node::with_params(node_type.clone(), serde_json::json!({}));
            let output = Node::new(NodeType::Output);

            let (id_o, id_d, id_f, id_out) = (objects.id, duration.id, falloff.id, output.id);
            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(falloff);
            graph.add_node(output);
            graph.add_edge(Edge {
                from: id_o,
                to: id_f,
                from_port: "objects".to_string(),
                to_port: "objects".to_string(),
            });
            graph.add_edge(Edge {
                from: id_d,
                to: id_f,
                from_port: "duration".to_string(),
                to_port: "duration".to_string(),
            });
            graph.add_edge(Edge {
                from: id_f,
                to: id_out,
                from_port: "out".to_string(),
                to_port: "in".to_string(),
            });

            let result = Compiler::compile(&graph);
            assert!(
                result.is_ok(),
                "Failed to compile {node_type:?}: {:?}",
                result.err()
            );
        }

        // Falloffs limités → modifier (Scale/Rotate/Offset) → Output
        for node_type in [
            NodeType::DirectionalFalloff,
            NodeType::AudioAmplitudeFalloff,
        ] {
            let mut graph = Graph::new();
            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let falloff = Node::with_params(node_type.clone(), serde_json::json!({}));
            let rotate = Node::with_params(NodeType::Rotate, serde_json::json!({"angleZ": 0.3}));
            let output = Node::new(NodeType::Output);

            let (id_o, id_d, id_f, id_r, id_out) =
                (objects.id, duration.id, falloff.id, rotate.id, output.id);
            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(falloff);
            graph.add_node(rotate);
            graph.add_node(output);
            graph.add_edge(Edge {
                from: id_o,
                to: id_f,
                from_port: "objects".to_string(),
                to_port: "objects".to_string(),
            });
            graph.add_edge(Edge {
                from: id_d,
                to: id_f,
                from_port: "duration".to_string(),
                to_port: "duration".to_string(),
            });
            graph.add_edge(Edge {
                from: id_f,
                to: id_r,
                from_port: "out".to_string(),
                to_port: "in".to_string(),
            });
            graph.add_edge(Edge {
                from: id_r,
                to: id_out,
                from_port: "out".to_string(),
                to_port: "in".to_string(),
            });

            let result = Compiler::compile(&graph);
            assert!(
                result.is_ok(),
                "Failed to compile {node_type:?}: {:?}",
                result.err()
            );
        }
    }

    /// OSCInput est un engine live : la dernière valeur reçue à l'adresse
    /// du node est injectée à chaque frame via la OscValueMap partagée.
    #[test]
    fn test_compile_osc_input_live_values() {
        use crate::audio::AudioState;
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};

        let make_graph = || {
            let mut graph = Graph::new();
            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 1}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let osc = Node::with_params(
                NodeType::OSCInput,
                serde_json::json!({"address": "/track/1/xyz", "radius": 1.0}),
            );
            let output = Node::new(NodeType::Output);
            let (id_o, id_d, id_s, id_out) = (objects.id, duration.id, osc.id, output.id);
            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(osc);
            graph.add_node(output);
            for (from, to, from_port, to_port) in [
                (id_o, id_s, "objects", "objects"),
                (id_d, id_s, "duration", "duration"),
                (id_s, id_out, "out", "in"),
            ] {
                graph.add_edge(Edge {
                    from,
                    to,
                    from_port: from_port.to_string(),
                    to_port: to_port.to_string(),
                });
            }
            graph
        };

        let audio = Arc::new(Mutex::new(AudioState::new()));
        let overrides: crate::compiler::AudioParamOverrides = Arc::new(Mutex::new(HashMap::new()));
        let osc_values: crate::compiler::OscValueMap = Arc::new(Mutex::new(HashMap::new()));

        // 1. Sans valeur reçue → fallback cercle statique (x=radius à l'objet 0)
        let func = Compiler::compile_with_audio_osc(
            &make_graph(),
            audio.clone(),
            overrides.clone(),
            osc_values.clone(),
        )
        .expect("compile");
        let pos = func(0.0, 0);
        assert!((pos.x - 1.0).abs() < 1e-9, "fallback circle: {pos:?}");

        // 2. Valeur vectorielle → position XYZ directe
        osc_values
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("/track/1/xyz".to_string(), vec![3.0, 4.0, 5.0]);
        let func = Compiler::compile_with_audio_osc(
            &make_graph(),
            audio.clone(),
            overrides.clone(),
            osc_values.clone(),
        )
        .expect("compile");
        let pos = func(0.0, 0);
        assert!(
            (pos.x - 3.0).abs() < 1e-9 && (pos.y - 4.0).abs() < 1e-9 && (pos.z - 5.0).abs() < 1e-9,
            "vector value: {pos:?}"
        );

        // 3. Valeur scalaire → angle sur cercle (1.0 → angle π → x=-radius)
        osc_values
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert("/track/1/xyz".to_string(), vec![1.0]);
        let func = Compiler::compile_with_audio_osc(&make_graph(), audio, overrides, osc_values)
            .expect("compile");
        let pos = func(0.0, 0);
        assert!((pos.x + 1.0).abs() < 1e-9, "scalar→angle: {pos:?}");
    }

    /// AudioSpectrum compile comme un engine : Objects/Duration résolvent
    /// n_objects/duration via les edges (ports input/duration).
    #[test]
    fn test_compile_audio_spectrum_with_objects_duration() {
        for node_type in [NodeType::AudioSpectrum, NodeType::OSCInput] {
            let mut graph = Graph::new();
            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 2}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let engine = Node::with_params(node_type.clone(), serde_json::json!({}));
            let output = Node::new(NodeType::Output);
            let (id_o, id_d, id_e, id_out) = (objects.id, duration.id, engine.id, output.id);
            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(engine);
            graph.add_node(output);
            for (from, to, from_port, to_port) in [
                (id_o, id_e, "objects", "objects"),
                (id_d, id_e, "duration", "duration"),
                (id_e, id_out, "out", "in"),
            ] {
                graph.add_edge(Edge {
                    from,
                    to,
                    from_port: from_port.to_string(),
                    to_port: to_port.to_string(),
                });
            }
            let result = Compiler::compile(&graph);
            assert!(
                result.is_ok(),
                "Failed to compile {node_type:?}: {:?}",
                result.err()
            );
        }
    }

    // Mix/Group/Sequence sont testés dans les tests d'intégration de lib.rs
    // (test_sound_engineer_mix_circle_figure8, test_sound_engineer_group_partition,
    //  test_sound_engineer_sequence_circle_spiral)
}
