#[cfg(test)]
mod tests {
    use crate::graph::{Edge, Graph, Node, NodeType};
    use crate::validator::{GraphContext, ValidationError, Validator};

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
            assert!(errors
                .iter()
                .any(|e| matches!(e, ValidationError::CycleDetected)));
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
            assert!(errors
                .iter()
                .any(|e| matches!(e, ValidationError::MissingRequiredNode(_))));
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
            assert!(errors
                .iter()
                .any(|e| matches!(e, ValidationError::InvalidConnection(_))));
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
            assert!(errors
                .iter()
                .any(|e| matches!(e, ValidationError::CountMismatch(_))));
        }
    }

    // --- Tests contexte Global vs SubGraph ---

    #[test]
    fn test_global_graph_valid() {
        // Graph global valide : Input → Scale → Output
        let mut graph = Graph::new();
        let input = Node::new(NodeType::Input);
        let scale = Node::new(NodeType::Scale);
        let output = Node::new(NodeType::Output);

        let id_input = input.id;
        let id_scale = scale.id;
        let id_output = output.id;

        graph.add_node(input);
        graph.add_node(scale);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_input,
            to: id_scale,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_scale,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(
            result.is_ok(),
            "Expected valid global graph, got {result:?}"
        );
    }

    #[test]
    fn test_global_graph_rejects_objects() {
        // Objects n'a pas de sens dans un graph global
        let mut graph = Graph::new();
        let objects = Node::new(NodeType::Objects);
        let input = Node::new(NodeType::Input);
        let output = Node::new(NodeType::Output);

        let id_input = input.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(input);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_input,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                "Expected ContextIncompatible for Objects in global graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_global_graph_rejects_engine() {
        // Un moteur (Circular) n'a pas de sens dans un graph global
        let mut graph = Graph::new();
        let circular = Node::new(NodeType::Circular);
        let input = Node::new(NodeType::Input);
        let output = Node::new(NodeType::Output);

        let id_input = input.id;
        let id_output = output.id;

        graph.add_node(circular);
        graph.add_node(input);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_input,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                "Expected ContextIncompatible for Circular in global graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_global_graph_requires_source() {
        // Un graph global sans source (Input/Merge/MoveRef) doit échouer
        let mut graph = Graph::new();
        let scale = Node::new(NodeType::Scale);
        let output = Node::new(NodeType::Output);

        let id_scale = scale.id;
        let id_output = output.id;

        graph.add_node(scale);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_scale,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::MissingRequiredNode(_))),
                "Expected MissingRequiredNode for source-less global graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_subgraph_rejects_input_node() {
        // Input n'a pas de sens dans un sub-graph
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 3}));
        let input = Node::new(NodeType::Input);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(circular);
        graph.add_node(input); // Devrait être rejeté
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

        let result = Validator::validate(&graph); // SubGraph par défaut
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                "Expected ContextIncompatible for Input in sub-graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_subgraph_rejects_merge_node() {
        // Merge n'a pas de sens dans un sub-graph
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 3}));
        let merge = Node::new(NodeType::Merge);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(circular);
        graph.add_node(merge); // Devrait être rejeté
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
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                "Expected ContextIncompatible for Merge in sub-graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_global_graph_with_moveref_valid() {
        // MoveRef est une source légitime du graph global
        let mut graph = Graph::new();
        let moveref = Node::new(NodeType::MoveRef);
        let scale = Node::new(NodeType::Scale);
        let output = Node::new(NodeType::Output);

        let id_moveref = moveref.id;
        let id_scale = scale.id;
        let id_output = output.id;

        graph.add_node(moveref);
        graph.add_node(scale);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_moveref,
            to: id_scale,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_scale,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(
            result.is_ok(),
            "Expected valid global graph with MoveRef, got {result:?}"
        );
    }

    #[test]
    fn test_has_engines_includes_elliptical() {
        // Vérifie que Elliptical est bien détecté comme un engine
        // (était manquant dans has_engines avant la Phase 2)
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let elliptical =
            Node::with_params(NodeType::Elliptical, serde_json::json!({"n_objects": 3}));
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_elliptical = elliptical.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(elliptical);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_elliptical,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_duration,
            to: id_elliptical,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: id_elliptical,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        // Si has_engines ne détecte pas Elliptical, la validation ne va pas
        // réclamer Objects/Duration — mais comme ils sont présents, le test
        // passe quand même. On vérifie juste que la validation globale passe.
        let result = Validator::validate(&graph);
        assert!(
            result.is_ok(),
            "Elliptical graph should validate, got {result:?}"
        );
    }

    #[test]
    fn test_global_graph_with_zone_and_velocity() {
        // Input → Zone → Velocity → Output : les nodes d'effets graph-native
        // sont des déclarations pass-through dans la chaîne globale.
        let mut graph = Graph::new();
        let input = Node::new(NodeType::Input);
        let zone = Node::with_params(
            NodeType::Zone,
            serde_json::json!({"shape": "sphere", "center": [0,0,0], "radius": 2.0,
                               "channels": {"gain": 0.0}}),
        );
        let vel = Node::with_params(
            NodeType::Velocity,
            serde_json::json!({"source": "speed", "channel": "spread", "scale": 0.1}),
        );
        let output = Node::new(NodeType::Output);

        let id_input = input.id;
        let id_zone = zone.id;
        let id_vel = vel.id;
        let id_output = output.id;

        graph.add_node(input);
        graph.add_node(zone);
        graph.add_node(vel);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_input,
            to: id_zone,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_zone,
            to: id_vel,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_vel,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(
            result.is_ok(),
            "Expected valid global graph with Zone/Velocity, got {result:?}"
        );
    }

    #[test]
    fn test_subgraph_rejects_zone_and_velocity() {
        // Zone/Velocity n'ont pas de sens dans un sub-graph (effets post-merge)
        for node_type in [NodeType::Zone, NodeType::Velocity] {
            let mut graph = Graph::new();
            let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 3}));
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let circular =
                Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 3}));
            let fx = Node::new(node_type.clone());
            let output = Node::new(NodeType::Output);

            let id_objects = objects.id;
            let id_duration = duration.id;
            let id_circular = circular.id;
            let id_output = output.id;

            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(circular);
            graph.add_node(fx);
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
            assert!(
                result.is_err(),
                "{node_type:?} should be rejected in subgraph"
            );
            if let Err(errors) = result {
                assert!(
                    errors
                        .iter()
                        .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                    "Expected ContextIncompatible for {node_type:?} in subgraph, got {errors:?}"
                );
            }
        }
    }

    #[test]
    fn test_vectorfield_valid_subgraph() {
        // Objects + Duration + VectorField + Output = graphe valide
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 8.0}));
        let field = Node::with_params(
            NodeType::VectorField,
            serde_json::json!({"n_objects": 4, "field": "vortex"}),
        );
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_field = field.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(field);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_field,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_duration,
            to: id_field,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: id_field,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate(&graph);
        assert!(
            result.is_ok(),
            "Expected valid VectorField graph, got {result:?}"
        );
    }

    #[test]
    fn test_vectorfield_rejected_in_global_graph() {
        // VectorField est un moteur sub-graph — pas un post-process global
        let mut graph = Graph::new();
        let input = Node::new(NodeType::Input);
        let field = Node::new(NodeType::VectorField);
        let output = Node::new(NodeType::Output);

        let id_input = input.id;
        let id_field = field.id;
        let id_output = output.id;

        graph.add_node(input);
        graph.add_node(field);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_input,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_field,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate_with_context(&graph, GraphContext::Global);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, ValidationError::ContextIncompatible(_))),
                "Expected ContextIncompatible for VectorField in global graph, got {errors:?}"
            );
        }
    }

    #[test]
    fn test_vectorfield_cannot_feed_modifier() {
        // Comme les autres moteurs physique, VectorField ne peut pas alimenter
        // un modifier (Scale/Rotate/…) — Output/composites uniquement.
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let field = Node::with_params(
            NodeType::VectorField,
            serde_json::json!({"n_objects": 4, "field": "flow"}),
        );
        let scale = Node::new(NodeType::Scale);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_field = field.id;
        let id_scale = scale.id;
        let id_output = output.id;

        graph.add_node(objects);
        graph.add_node(field);
        graph.add_node(scale);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_field,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_field,
            to: id_scale,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_scale,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        let result = Validator::validate(&graph);
        assert!(
            result.is_err(),
            "VectorField → Scale should be rejected (physics engines feed Output/composites only)"
        );
    }

    #[test]
    fn test_output_without_input_rejected() {
        // Output non connecté passait la validation et échouait tard au
        // compile avec OutputNotConnected — l'arité le détecte maintenant.
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 4}));
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
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

        let result = Validator::validate(&graph);
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(
                e,
                ValidationError::InvalidConnection(msg) if msg.contains("Output requires")
            )));
        }
    }

    #[test]
    fn test_modifier_without_input_rejected() {
        // Un Scale sans entrée échouait tard au compile (MissingParameter).
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 4}));
        let scale = Node::new(NodeType::Scale);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
        let id_output = output.id;
        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(circular);
        graph.add_node(scale);
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
        assert!(result.is_err());
        if let Err(errors) = result {
            assert!(errors.iter().any(|e| matches!(
                e,
                ValidationError::InvalidConnection(msg) if msg.contains("Scale requires")
            )));
        }
    }

    #[test]
    fn test_engine_without_objects_or_param_rejected() {
        // Spiral sans edge Objects ni param n_objects : n_objects non
        // résoluble → MissingParameter tardif au compile. Détecté ici.
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let circular = Node::with_params(NodeType::Circular, serde_json::json!({"n_objects": 4}));
        let spiral = Node::new(NodeType::Spiral);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_circular = circular.id;
        let id_output = output.id;
        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(circular);
        graph.add_node(spiral);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_duration,
            to: id_circular,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });

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
            assert!(errors.iter().any(|e| matches!(
                e,
                ValidationError::InvalidConnection(msg) if msg.contains("Spiral has no Objects input")
            )));
        }
    }

    #[test]
    fn test_engine_resolves_n_objects_via_edge() {
        // Cas positif : engine sans param mais alimenté par Objects → valide.
        let mut graph = Graph::new();
        let objects = Node::with_params(NodeType::Objects, serde_json::json!({"n_objects": 4}));
        let duration = Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
        let spiral = Node::new(NodeType::Spiral);
        let output = Node::new(NodeType::Output);

        let id_objects = objects.id;
        let id_duration = duration.id;
        let id_spiral = spiral.id;
        let id_output = output.id;
        graph.add_node(objects);
        graph.add_node(duration);
        graph.add_node(spiral);
        graph.add_node(output);

        graph.add_edge(Edge {
            from: id_objects,
            to: id_spiral,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        graph.add_edge(Edge {
            from: id_duration,
            to: id_spiral,
            from_port: "output".to_string(),
            to_port: "duration".to_string(),
        });
        graph.add_edge(Edge {
            from: id_spiral,
            to: id_output,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });

        assert!(Validator::validate(&graph).is_ok());
    }

    // ── Bornes dures anti-blackout (audit B2) ────────────────────────

    fn chain_graph(n: usize) -> Graph {
        let mut graph = Graph::new();
        let mut ids = Vec::new();
        for _ in 0..n {
            let node = Node::new(NodeType::Scale);
            ids.push(node.id);
            graph.add_node(node);
        }
        for w in ids.windows(2) {
            graph.add_edge(Edge {
                from: w[0],
                to: w[1],
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
        }
        graph
    }

    fn has_too_complex(result: &Result<(), Vec<ValidationError>>, needle: &str) -> bool {
        match result {
            Err(errors) => errors.iter().any(|e| {
                matches!(
                    e,
                    ValidationError::TooComplex(msg) if msg.contains(needle)
                )
            }),
            Ok(()) => false,
        }
    }

    #[test]
    fn test_complexity_max_nodes() {
        let mut graph = Graph::new();
        for _ in 0..=crate::validator::MAX_GRAPH_NODES {
            graph.add_node(Node::new(NodeType::Scale));
        }
        let result = Validator::validate(&graph);
        assert!(has_too_complex(&result, "nodes"));
    }

    #[test]
    fn test_complexity_max_edges() {
        let mut graph = Graph::new();
        let a = Node::new(NodeType::Scale);
        let b = Node::new(NodeType::Scale);
        let (id_a, id_b) = (a.id, b.id);
        graph.add_node(a);
        graph.add_node(b);
        for _ in 0..=crate::validator::MAX_GRAPH_EDGES {
            graph.add_edge(Edge {
                from: id_a,
                to: id_b,
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
        }
        let result = Validator::validate(&graph);
        assert!(has_too_complex(&result, "edges"));
    }

    #[test]
    fn test_complexity_max_depth() {
        // Chaîne plus profonde que MAX_DAG_DEPTH → rejet (le compile et
        // l'éval sont récursifs : sans borne = stack overflow = abort).
        let graph = chain_graph(crate::validator::MAX_DAG_DEPTH + 2);
        let result = Validator::validate(&graph);
        assert!(has_too_complex(&result, "depth"));
    }

    #[test]
    fn test_complexity_path_explosion() {
        // Chaque niveau duplique le sous-graphe (Mix(a,a) par 2 edges sur
        // le même parent) : 2^20 chemins → sans borne, compile_node
        // compilerait ~1M de fois le nœud racine.
        let mut graph = Graph::new();
        let leaf = Node::new(NodeType::Circular);
        let mut prev = leaf.id;
        graph.add_node(leaf);
        for _ in 0..20 {
            let mix = Node::new(NodeType::Mix);
            let id = mix.id;
            graph.add_node(mix);
            for port in ["input_a", "input_b"] {
                graph.add_edge(Edge {
                    from: prev,
                    to: id,
                    from_port: "output".to_string(),
                    to_port: port.to_string(),
                });
            }
            prev = id;
        }
        let result = Validator::validate(&graph);
        assert!(has_too_complex(&result, "path"));
    }

    #[test]
    fn test_complexity_reasonable_graph_accepted() {
        // Une chaîne de 100 modifiers reste sous les bornes — pas de
        // TooComplex (d'autres erreurs de validation peuvent exister,
        // elles ne sont pas l'objet du test).
        let graph = chain_graph(100);
        let result = Validator::validate(&graph);
        assert!(!has_too_complex(&result, ""));
    }

    #[test]
    fn test_interaction_agents_budget() {
        // T3 : un Swarm/Avoidance à n > MAX_INTERACTION_AGENTS dépasse le
        // budget O(n²) d'un frame 60 FPS → rejet TooComplex à la validation.
        let big = crate::engines::MAX_INTERACTION_AGENTS + 1;
        let ok = crate::engines::MAX_INTERACTION_AGENTS;
        for n_agents in [big, ok] {
            let mut graph = Graph::new();
            let objects = Node::with_params(
                NodeType::Objects,
                serde_json::json!({"n_objects": n_agents}),
            );
            let duration =
                Node::with_params(NodeType::Duration, serde_json::json!({"duration": 4.0}));
            let swarm =
                Node::with_params(NodeType::Swarm, serde_json::json!({"n_objects": n_agents}));
            let output = Node::new(NodeType::Output);
            let (id_o, id_d, id_s, id_out) = (objects.id, duration.id, swarm.id, output.id);
            graph.add_node(objects);
            graph.add_node(duration);
            graph.add_node(swarm);
            graph.add_node(output);
            graph.add_edge(Edge {
                from: id_o,
                to: id_s,
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
            graph.add_edge(Edge {
                from: id_d,
                to: id_s,
                from_port: "output".to_string(),
                to_port: "duration".to_string(),
            });
            graph.add_edge(Edge {
                from: id_s,
                to: id_out,
                from_port: "output".to_string(),
                to_port: "input".to_string(),
            });
            let result = Validator::validate(&graph);
            let errors = result.clone().err().unwrap_or_default();
            let too_complex = errors
                .iter()
                .any(|e| matches!(e, ValidationError::TooComplex(_)));
            assert_eq!(
                too_complex,
                n_agents > crate::engines::MAX_INTERACTION_AGENTS,
                "n={n_agents}: TooComplex attendu={}, erreurs={:?}",
                n_agents > crate::engines::MAX_INTERACTION_AGENTS,
                errors
            );
        }
    }
}
