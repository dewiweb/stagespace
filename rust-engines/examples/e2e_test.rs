//! Test end-to-end : lance une animation via la chaîne de production réelle
//! (worker Runtime → PositionBuffer → MergeRuntime → OscSink → UDP) et
//! vérifie que les messages OSC partent.
//! Usage: cargo run --example e2e_test
use stagespace_engines::{
    Animation, AnimationState, AudioState, Compiler, EngineParams, MergeRuntime, OscProfile,
    OscSender, PositionBuffer, Runtime, ShapeType, TrackAssignment,
};
use std::net::UdpSocket;
use std::sync::Arc;
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

/// Écoute les paquets OSC sur `listener` pendant `window_ms` et retourne
/// (count, premiers messages formatés).
fn collect_osc(listener: &UdpSocket, window_ms: u64, max_logged: usize) -> (usize, Vec<String>) {
    let mut count = 0;
    let mut first: Vec<String> = Vec::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_millis(window_ms) {
        let mut buf = [0u8; 1024];
        if let Ok((n, _)) = listener.recv_from(&mut buf) {
            count += 1;
            if first.len() < max_logged {
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
                    first.push(format!("  {} {}", msg.addr, args_str.join(", ")));
                }
            }
        }
    }
    (count, first)
}

fn main() {
    println!("=== STAGESPACE E2E Test ===\n");

    // 1. Listener UDP sur un port aléatoire (simule le spatializer)
    let listener = UdpSocket::bind("127.0.0.1:0").expect("bind listener");
    let listener_port = listener.local_addr().unwrap().port();
    listener
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    println!("[1] UDP listener sur 127.0.0.1:{listener_port}");

    // 2. Animation Circle sur 2 tracks (depth + phase_offset par track)
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
    let osc_ids = vec![1u32, 2u32];
    println!(
        "[2] Animation: {:?} radius={} duration={}s tracks={}",
        anim.shape,
        anim.shape_params.get("radius").unwrap_or(&0.0),
        anim.duration,
        anim.assignments.len()
    );

    // 3. Graphe + compilation
    let graph = build_graph_from_shape(&anim, osc_ids.len());
    let compiled = Compiler::compile(&graph).expect("compile");
    println!("[3] Graphe compilé");

    // 4. MergeRuntime (sink OSC vers le listener) + worker + buffer
    let osc_sender = OscSender::new(
        OscProfile::GenericCartesian,
        "127.0.0.1".to_string(),
        listener_port,
    );
    let mut merge = MergeRuntime::new("127.0.0.1".to_string(), listener_port, osc_sender, 60.0)
        .expect("merge runtime");
    merge.set_osc_ids(osc_ids.clone());
    merge.start().expect("merge start");

    let buffer = Arc::new(PositionBuffer::new());
    let runtime = Runtime::new();
    runtime.set_position_buffer(buffer.clone());
    merge.register_move(
        "e2e-move".to_string(),
        buffer,
        osc_ids.clone(),
        vec![0, 1], // track_indices dans la liste globale
        false,
    );

    let anim_state = AnimationState::from_animation(&anim, &osc_ids);
    runtime.set_animation_state(anim_state);
    runtime.macros().set_speed(anim.speed);
    runtime.macros().set_scale(anim.scale);
    println!("[4] Merge + worker enregistré");

    // 5. Playback
    let params = EngineParams {
        n_objects: osc_ids.len(),
        duration: anim.duration,
        fps: 60.0,
        extra: serde_json::json!({}),
    };
    runtime
        .play_compiled(compiled.into(), params, osc_ids)
        .expect("play");
    println!("[5] Playback lancé — écoute OSC 1s...");

    let (received, first) = collect_osc(&listener, 1000, 5);

    runtime.stop();
    merge.stop();
    println!("[6] Playback arrêté");

    println!("\n=== RÉSULTATS ===");
    println!("Messages OSC reçus: {received}");
    if received > 0 {
        for msg in &first {
            println!("{msg}");
        }
        println!("\nSUCCÈS — la chaîne worker→merge→sink envoie de l'OSC");
    } else {
        println!("\nÉCHEC — aucun message OSC reçu");
    }

    // Test 2 : audio mod (bass → radius_scale) sur le profil Holophonix
    println!("\n=== Test 2: Audio Mod ===");

    let listener2 = UdpSocket::bind("127.0.0.1:0").expect("bind listener2");
    let port2 = listener2.local_addr().unwrap().port();
    listener2
        .set_read_timeout(Some(Duration::from_millis(100)))
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

    // AudioState partagé : merge + worker lisent le même Arc
    let audio_state = Arc::new(std::sync::Mutex::new(AudioState::new()));
    {
        let mut audio = audio_state.lock().unwrap_or_else(|e| e.into_inner());
        audio.amplitude = Some(stagespace_engines::AmplitudeData {
            rms: 0.5,
            bass: 0.8,
            mid: 0.3,
            high: 0.1,
        });
    }

    let osc_sender2 = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), port2);
    let mut merge2 = MergeRuntime::new_with_audio_state(
        "127.0.0.1".to_string(),
        port2,
        osc_sender2,
        60.0,
        audio_state.clone(),
    )
    .expect("merge2");
    merge2.set_osc_ids(osc_ids2.clone());
    merge2.start().expect("merge2 start");

    let buffer2 = Arc::new(PositionBuffer::new());
    let runtime2 = Runtime::new_with_audio_state(audio_state);
    runtime2.set_position_buffer(buffer2.clone());
    merge2.register_move(
        "e2e-move-2".to_string(),
        buffer2,
        osc_ids2.clone(),
        vec![0, 1, 2],
        false,
    );

    let anim_state2 = AnimationState::from_animation(&anim2, &osc_ids2);
    runtime2.set_animation_state(anim_state2);
    runtime2.macros().set_speed(1.0);
    runtime2.macros().set_scale(1.0);

    let params2 = EngineParams {
        n_objects: osc_ids2.len(),
        duration: anim2.duration,
        fps: 60.0,
        extra: serde_json::json!({}),
    };
    runtime2
        .play_compiled(compiled2.into(), params2, osc_ids2)
        .expect("play2");
    println!("Playback avec audio mod (bass=0.8 → radius) lancé...");

    let (msg_count2, first2) = collect_osc(&listener2, 500, 3);
    for msg in &first2 {
        println!("{msg}");
    }

    runtime2.stop();
    merge2.stop();

    if msg_count2 > 0 {
        println!("Audio mod test: {msg_count2} messages OSC reçus (Holophonix)");
    } else {
        println!("Audio mod test: aucun message");
    }

    println!("\n=== FIN ===");
}
