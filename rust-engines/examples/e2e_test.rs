//! Test end-to-end : lance une animation et vérifie que les messages OSC partent.
//! Usage: cargo run --example e2e_test
use stagespace_engines::{
    Animation, AnimationState, AudioState, Compiler, EngineParams, OscProfile, OscSender, Runtime,
    ShapeType, TrackAssignment,
};
use std::net::UdpSocket;
use std::time::Duration;

fn build_graph_from_shape(anim: &Animation, n_objects: usize) -> stagespace_engines::Graph {
    use stagespace_engines::{Edge, Graph, Node, NodeId, NodeType};
    let mut graph = Graph::new();

    let objects_id = NodeId::new();
    let duration_id = NodeId::new();
    let engine_id = NodeId::new();
    let output_id = NodeId::new();

    let n_objs = n_objects.max(1);

    graph.add_node(Node {
        id: objects_id,
        node_type: NodeType::Objects,
        params: serde_json::json!({ "n_objects": n_objs }),
        position: (50.0, 200.0),
    });
    graph.add_node(Node {
        id: duration_id,
        node_type: NodeType::Duration,
        params: serde_json::json!({ "duration": anim.duration }),
        position: (50.0, 50.0),
    });

    let engine_type = match anim.shape {
        ShapeType::Circle => NodeType::Circular,
        ShapeType::Elliptical => NodeType::Elliptical,
        ShapeType::Spiral => NodeType::Spiral,
        ShapeType::Figure8 => NodeType::Figure8,
        ShapeType::Helix => NodeType::Helix,
        _ => NodeType::Circular,
    };

    let mut engine_params = serde_json::Map::new();
    for (k, v) in &anim.shape_params {
        engine_params.insert(k.clone(), serde_json::json!(v));
    }
    engine_params.insert("n_objects".to_string(), serde_json::json!(n_objs));

    graph.add_node(Node {
        id: engine_id,
        node_type: engine_type,
        params: serde_json::json!(engine_params),
        position: (300.0, 150.0),
    });
    graph.add_node(Node {
        id: output_id,
        node_type: NodeType::Output,
        params: serde_json::json!({}),
        position: (550.0, 150.0),
    });

    graph.add_edge(Edge {
        from: objects_id,
        to: engine_id,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });
    graph.add_edge(Edge {
        from: duration_id,
        to: engine_id,
        from_port: "output".to_string(),
        to_port: "duration".to_string(),
    });
    graph.add_edge(Edge {
        from: engine_id,
        to: output_id,
        from_port: "output".to_string(),
        to_port: "input".to_string(),
    });

    graph
}

fn main() {
    println!("=== STAGESPACE E2E Test ===\n");

    // 1. Démarrer un listener UDP sur un port aléatoire
    let listener = UdpSocket::bind("127.0.0.1:0").expect("bind listener");
    let listener_addr = listener.local_addr().unwrap();
    let listener_port = listener_addr.port();
    println!("[1] UDP listener sur 127.0.0.1:{listener_port}");

    // Timeout court pour ne pas bloquer
    listener
        .set_read_timeout(Some(Duration::from_millis(500)))
        .unwrap();

    // 2. Créer une animation Circle
    let mut anim = Animation {
        name: "Test E2E Circle".to_string(),
        shape: ShapeType::Circle,
        duration: 4.0,
        speed: 1.0,
        ..Default::default()
    };
    anim.shape_params.insert("radius".to_string(), 2.0);
    anim.assignments = vec![
        TrackAssignment {
            track_id: 1,
            depth: 1.0,
            phase_offset: 0.0,
        },
        TrackAssignment {
            track_id: 2,
            depth: 0.5,
            phase_offset: 180.0,
        },
    ];
    println!(
        "[2] Animation: {:?} radius={} duration={}s tracks={}",
        anim.shape,
        anim.shape_params.get("radius").unwrap_or(&0.0),
        anim.duration,
        anim.assignments.len()
    );

    let osc_ids = vec![1u32, 2u32];

    // 3. Construire le graphe
    let graph = build_graph_from_shape(&anim, osc_ids.len());
    println!(
        "[3] Graphe construit: {} nodes, {} edges",
        graph.nodes.len(),
        graph.edges.len()
    );

    // 4. Compiler
    let compiled = Compiler::compile(&graph).expect("compile");
    println!("[4] Compilation OK");

    // 5. Créer le runtime qui envoie OSC au listener
    let osc_sender = OscSender::new(
        OscProfile::GenericCartesian,
        "127.0.0.1".to_string(),
        listener_port,
    );
    let runtime =
        Runtime::new("127.0.0.1".to_string(), listener_port, osc_sender).expect("runtime");
    println!("[5] Runtime créé");

    // 6. Set animation state (depth + phase_offset)
    let anim_state = AnimationState::from_animation(&anim, &osc_ids);
    runtime.set_animation_state(anim_state);
    runtime.macros().set_speed(anim.speed);
    runtime.macros().set_scale(anim.scale);
    runtime.set_origin(nalgebra::Vector3::zeros());
    println!(
        "[6] Animation state set: depths={:?} phases={:?}",
        AnimationState::from_animation(&anim, &osc_ids).track_depths,
        AnimationState::from_animation(&anim, &osc_ids).track_phase_offsets
    );

    // 7. Lancer le playback
    let params = EngineParams {
        n_objects: osc_ids.len(),
        duration: anim.duration,
        fps: 60.0,
        extra: serde_json::json!({}),
    };
    runtime
        .play_compiled(compiled, params, osc_ids)
        .expect("play");
    println!("[7] Playback lancé ! En attente de messages OSC...");

    // 8. Écouter les messages OSC pendant 1 seconde
    let mut messages_received = 0;
    let mut first_messages: Vec<String> = Vec::new();
    let start = std::time::Instant::now();

    while start.elapsed() < Duration::from_millis(1000) {
        let mut buf = [0u8; 1024];
        if let Ok((n, _addr)) = listener.recv_from(&mut buf) {
            messages_received += 1;
            if messages_received <= 5 {
                // Parser le message OSC
                if let Ok((_, rosc::OscPacket::Message(msg))) = rosc::decoder::decode_udp(&buf[..n])
                {
                    let args_str: Vec<String> = msg
                        .args
                        .iter()
                        .map(|a| match a {
                            rosc::OscType::Float(f) => format!("{f:.2}"),
                            rosc::OscType::Int(i) => i.to_string(),
                            _ => "?".to_string(),
                        })
                        .collect();
                    first_messages.push(format!("  {} {}", msg.addr, args_str.join(", ")));
                }
            }
        }
    }

    // 9. Arrêter
    runtime.stop();
    println!("[8] Playback arrêté");

    // 10. Résultats
    println!("\n=== RÉSULTATS ===");
    println!("Messages OSC reçus: {messages_received}");
    if messages_received > 0 {
        println!("Premiers messages:");
        for msg in &first_messages {
            println!("{msg}");
        }
        println!("\n✅ SUCCÈS — L'animation envoie bien des messages OSC !");
    } else {
        println!("\n❌ ÉCHEC — Aucun message OSC reçu");
    }

    // 11. Test avec audio mod
    println!("\n=== Test 2: Audio Mod ===");

    let listener2 = UdpSocket::bind("127.0.0.1:0").expect("bind listener2");
    let port2 = listener2.local_addr().unwrap().port();
    listener2
        .set_read_timeout(Some(Duration::from_millis(500)))
        .unwrap();

    let mut anim2 = Animation {
        shape: ShapeType::Circle,
        duration: 4.0,
        ..Default::default()
    };
    anim2.shape_params.insert("radius".to_string(), 2.0);
    anim2.audio_mods.push(stagespace_engines::AudioMod {
        source: stagespace_engines::AudioModSource::AmplitudeBass,
        target: stagespace_engines::AudioModTarget::RadiusScale,
        amount: 1.0,
        base_value: 2.0,
        smoothing: 0.0,
    });

    let osc_ids2 = vec![1u32, 2u32, 3u32];
    let graph2 = build_graph_from_shape(&anim2, osc_ids2.len());
    let compiled2 = Compiler::compile(&graph2).expect("compile2");

    let osc_sender2 = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), port2);
    let runtime2 = Runtime::new("127.0.0.1".to_string(), port2, osc_sender2).expect("runtime2");

    let anim_state2 = AnimationState::from_animation(&anim2, &osc_ids2);
    runtime2.set_animation_state(anim_state2);
    runtime2.macros().set_speed(1.0);
    runtime2.macros().set_scale(1.0);

    // Pousser un audio state avec bass=0.8
    let mut audio = AudioState::new();
    audio.amplitude = Some(stagespace_engines::AmplitudeData {
        rms: 0.5,
        bass: 0.8,
        mid: 0.3,
        high: 0.1,
    });
    runtime2.set_audio_state(audio);

    let params2 = EngineParams {
        n_objects: osc_ids2.len(),
        duration: anim2.duration,
        fps: 60.0,
        extra: serde_json::json!({}),
    };
    runtime2
        .play_compiled(compiled2, params2, osc_ids2)
        .expect("play2");
    println!("Playback avec audio mod (bass=0.8 → radius) lancé...");

    let mut msg_count2 = 0;
    let start2 = std::time::Instant::now();
    while start2.elapsed() < Duration::from_millis(500) {
        let mut buf = [0u8; 1024];
        if let Ok((n, _)) = listener2.recv_from(&mut buf) {
            msg_count2 += 1;
            if msg_count2 <= 3 {
                if let Ok((_, rosc::OscPacket::Message(msg))) = rosc::decoder::decode_udp(&buf[..n])
                {
                    let args_str: Vec<String> = msg
                        .args
                        .iter()
                        .map(|a| match a {
                            rosc::OscType::Float(f) => format!("{f:.2}"),
                            _ => "?".to_string(),
                        })
                        .collect();
                    println!("  {} {}", msg.addr, args_str.join(", "));
                }
            }
        }
    }

    runtime2.stop();

    if msg_count2 > 0 {
        println!("✅ Audio mod test: {msg_count2} messages OSC reçus avec Holophonix profile");
    } else {
        println!("❌ Audio mod test: aucun message");
    }

    println!("\n=== FIN ===");
}
