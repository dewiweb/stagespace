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
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_duration,
            to: id_circular,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: id_circular,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
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
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id2,
            to: id3,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id3,
            to: id1,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
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
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
            graph.add_edge(Edge {
                from: id_duration,
                to: id_engine,
                from_port: "output".to_string(),
                to_port: "duration".to_string(),
            });
            graph.add_edge(Edge {
                from: id_engine,
                to: id_output,
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });

            let result = Compiler::compile(&graph);
            assert!(result.is_ok(), "Failed to compile {node_type:?}");
        }
    }

    // Mix/Group/Sequence sont testés dans les tests d'intégration de lib.rs
    // (test_sound_engineer_mix_circle_figure8, test_sound_engineer_group_partition,
    //  test_sound_engineer_sequence_circle_spiral)
}
