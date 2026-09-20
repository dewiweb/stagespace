#[cfg(test)]
mod tests {
    use crate::graph::{Edge, Graph, Node, NodeType};

    #[test]
    fn test_graph_creation() {
        let graph = Graph::new();
        assert_eq!(graph.nodes.len(), 0);
        assert_eq!(graph.edges.len(), 0);
    }

    #[test]
    fn test_add_remove_node() {
        let mut graph = Graph::new();
        let node = Node::new(NodeType::Circular);
        let id = node.id;

        graph.add_node(node);
        assert_eq!(graph.nodes.len(), 1);
        assert!(graph.nodes.contains_key(&id));

        graph.remove_node(id);
        assert_eq!(graph.nodes.len(), 0);
    }

    #[test]
    fn test_add_remove_edge() {
        let mut graph = Graph::new();
        let node1 = Node::new(NodeType::Circular);
        let node2 = Node::new(NodeType::Duration);
        let id1 = node1.id;
        let id2 = node2.id;

        graph.add_node(node1);
        graph.add_node(node2);

        let edge = Edge {
            from: id1,
            to: id2,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        };

        graph.add_edge(edge);
        assert_eq!(graph.edges.len(), 1);

        graph.remove_edge(id1, id2, None);
        assert_eq!(graph.edges.len(), 0);
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

        // Pas de cycle
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
        assert!(!graph.has_cycle());

        // Ajouter un cycle
        graph.add_edge(Edge {
            from: id3,
            to: id1,
            from_port: "output".to_string(),
            to_port: "input".to_string(),
        });
        assert!(graph.has_cycle());
    }

    #[test]
    fn test_get_inputs_outputs() {
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

        let outputs1 = graph.get_outputs(id1);
        assert_eq!(outputs1.len(), 1);
        assert!(outputs1.contains(&id2));

        let inputs2 = graph.get_inputs(id2);
        assert_eq!(inputs2.len(), 1);
        assert!(inputs2.contains(&id1));
    }
}
