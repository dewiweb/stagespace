#[cfg(test)]
mod tests {
    use crate::graph::{Graph, Node, NodeType, Edge};
    use crate::validator::{Validator, ValidationError};

    #[test]
    fn test_valid_graph() {
        let mut graph = Graph::new();
        
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 9}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 9}));
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

        let result = Validator::validate(&graph);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cycle_detection() {
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

        let result = Validator::validate(&graph);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(e, ValidationError::CycleDetected)));
        }
    }

    #[test]
    fn test_missing_required_node() {
        let mut graph = Graph::new();
        
        let objects = Node::new(NodeType::Objects);
        let duration = Node::new(NodeType::Duration);
        // Missing Output

        graph.add_node(objects);
        graph.add_node(duration);

        let result = Validator::validate(&graph);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(e, ValidationError::MissingRequiredNode(_))));
        }
    }

    #[test]
    fn test_invalid_connection() {
        let mut graph = Graph::new();
        
        let objects = Node::new(NodeType::Objects);
        let output = Node::new(NodeType::Output);
        // Objects -> Output is invalid (should go through an engine first)

        let id_objects = objects.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate(&graph);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(e, ValidationError::InvalidConnection(_))));
        }
    }

    #[test]
    fn test_count_mismatch() {
        let mut graph = Graph::new();
        
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 9}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 5})); // Mismatch
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_circular = circular.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(circular);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
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

        let result = Validator::validate(&graph);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(e, ValidationError::CountMismatch(_))));
        }
    }
}
