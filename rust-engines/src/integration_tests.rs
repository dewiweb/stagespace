use crate::graph::{Graph, Node, NodeType, NodeId, Edge};
use crate::osc_sender::OscSender;
use crate::osc_sender::OscProfile;

#[test]
fn test_osc_sender_profiles() {
    let profiles = vec![
        OscProfile::IEMMultiEncoder,
        OscProfile::Holophonix,
        OscProfile::IRCAMSpat,
        OscProfile::GenericCartesian,
        OscProfile::GenericPolar,
        OscProfile::ADMOSC,
    ];
    
    for profile in profiles {
        let sender = OscSender::new(profile.clone(), "127.0.0.1".to_string(), 9000);
        let pos = nalgebra::Vector3::new(1.0, 0.0, 0.0);
        let (addr, values) = sender.format_position(1, pos);
        assert!(!addr.is_empty(), "OSC address should not be empty for {:?}", profile);
        assert!(!values.is_empty(), "OSC values should not be empty for {:?}", profile);
    }
}

#[test]
fn test_graph_serialization() {
    let mut graph = Graph::new();
    
    let objects_id = NodeId::new();
    let circular_id = NodeId::new();
    
    graph.add_node(Node {
        id: objects_id,
        node_type: NodeType::Objects,
        params: serde_json::json!({ "n_objects": 8 }),
        position: (0.0, 0.0),
    });
    
    graph.add_node(Node {
        id: circular_id,
        node_type: NodeType::Circular,
        params: serde_json::json!({ "radius": 1.0, "speed": 1.0, "plane": "xz" }),
        position: (0.0, 0.0),
    });
    
    graph.add_edge(Edge {
        from: objects_id,
        to: circular_id,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });
    
    // Sérialiser
    let json = serde_json::to_string(&graph).unwrap();
    
    // Désérialiser
    let deserialized: Graph = serde_json::from_str(&json).unwrap();
    
    assert_eq!(graph.nodes.len(), deserialized.nodes.len());
    assert_eq!(graph.edges.len(), deserialized.edges.len());
}

#[test]
fn test_config_serialization() {
    use crate::config::Config;
    
    let config = Config::default();
    let json = serde_json::to_string(&config).unwrap();
    let deserialized: Config = serde_json::from_str(&json).unwrap();
    
    assert_eq!(config.runtime.default_fps, deserialized.runtime.default_fps);
    assert_eq!(config.osc.default_port, deserialized.osc.default_port);
}
