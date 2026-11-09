use super::*;

fn recv() -> OscReceiver {
    OscReceiver::new(8001)
}

fn channel_mapping(addr: &str, ch: SpatialChannel, obj: ObjectRef) -> OscMapping {
    OscMapping {
        address: addr.to_string(),
        destination: MappingDestination::Channel {
            channel: ch,
            object: obj,
        },
        transform: Transform::default(),
        enabled: true,
    }
}

// ── match_address ──

#[test]
fn test_match_exact() {
    let c = match_address("/track/1/x", "/track/1/x").unwrap();
    assert!(c.is_empty());
    assert!(match_address("/track/1/x", "/track/2/x").is_none());
    assert!(match_address("/track/1/x", "/track/1").is_none());
}

#[test]
fn test_match_wildcard() {
    let c = match_address("/track/*/gain", "/track/7/gain").unwrap();
    assert_eq!(c, vec!["7".to_string()]);
    let c = match_address("/*/*/x", "/a/b/x").unwrap();
    assert_eq!(c, vec!["a".to_string(), "b".to_string()]);
    assert!(match_address("/track/*/gain", "/track/1/freq").is_none());
}

// ── Transform ──

#[test]
fn test_transform_affine_clamp() {
    let t = Transform {
        scale: 2.0,
        offset: 1.0,
        min: Some(0.0),
        max: Some(5.0),
        ..Default::default()
    };
    assert_eq!(t.apply(1.0), 3.0);
    assert_eq!(t.apply(10.0), 5.0);
    assert_eq!(t.apply(-10.0), 0.0);
}

#[test]
fn test_transform_deadzone() {
    let t = Transform {
        deadzone: 0.1,
        ..Default::default()
    };
    assert_eq!(t.apply(0.05), 0.0);
    assert_eq!(t.apply(-0.05), 0.0);
    assert_eq!(t.apply(0.5), 0.5);
}

// ── Validation ──

#[test]
fn test_add_mapping_validation() {
    let r = recv();
    // Adresse invalide
    let mut m = channel_mapping("track/1", SpatialChannel::Gain, ObjectRef::Index(0));
    assert!(r.add_mapping(m.clone()).is_err());
    // Wildcard object sans wildcard dans l'adresse
    m = channel_mapping(
        "/track/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    );
    assert!(r.add_mapping(m).is_err());
    // Wildcard index trop grand
    m = channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*1".into()),
    );
    assert!(r.add_mapping(m).is_err());
    // Smooth hors [0,1)
    m = channel_mapping("/x", SpatialChannel::Gain, ObjectRef::Index(0));
    m.transform.smooth = 1.5;
    assert!(r.add_mapping(m).is_err());
    // min > max
    m = channel_mapping("/x", SpatialChannel::Gain, ObjectRef::Index(0));
    m.transform.min = Some(2.0);
    m.transform.max = Some(1.0);
    assert!(r.add_mapping(m).is_err());
}

// ── Handler (passif) ──

#[test]
fn test_handler_mapping_stores_value() {
    let r = recv();
    r.add_handler_mapping("/fader/1", "fader1").unwrap();
    r.handle_message("/fader/1", vec![0.5]);
    assert_eq!(r.get_last_value("fader1"), Some(vec![0.5]));
    assert_eq!(r.get_last_value("/fader/1"), None); // key = handler name
}

// ── Routage macro ──

#[test]
fn test_macro_routing() {
    let r = recv();
    let macros = Arc::new(MacroState::new());
    r.set_targets(OscInTargets {
        macros: Some(macros.clone()),
        ..Default::default()
    });
    r.add_mapping(OscMapping {
        address: "/ctl/scale".into(),
        destination: MappingDestination::Macro {
            name: MacroTarget::Scale,
        },
        transform: Transform {
            scale: 2.0,
            ..Default::default()
        },
        enabled: true,
    })
    .unwrap();
    r.handle_message("/ctl/scale", vec![0.75]);
    assert_eq!(f64::from_bits(macros.scale.load(Ordering::Relaxed)), 1.5);
    assert_eq!(r.get_last_value("macro:scale"), Some(vec![1.5]));
}

// ── Routage channel + wildcard ──

#[test]
fn test_channel_routing_wildcard() {
    let r = recv();
    let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
        Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        object_channels: Some(channels.clone()),
        ..Default::default()
    });
    r.add_mapping(channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    ))
    .unwrap();
    r.handle_message("/track/3/gain", vec![0.8]);
    let chs = channels.read().unwrap();
    assert_eq!(chs.get(&3).and_then(|c| c.gain), Some(0.8));
}

#[test]
fn test_channel_routing_non_numeric_wildcard_dropped() {
    let r = recv();
    let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
        Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        object_channels: Some(channels.clone()),
        ..Default::default()
    });
    r.add_mapping(channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    ))
    .unwrap();
    r.handle_message("/track/abc/gain", vec![0.8]);
    assert!(channels.read().unwrap().is_empty());
    // Le feedback est quand même stocké (clé = wildcard brut)
    assert_eq!(r.get_last_value("channel:Gain:*"), Some(vec![0.8]));
}

// ── Routage position ──

#[test]
fn test_position_routing() {
    let r = recv();
    let positions: Arc<RwLock<HashMap<usize, [f64; 3]>>> = Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        manual_positions: Some(positions.clone()),
        ..Default::default()
    });
    r.add_mapping(OscMapping {
        address: "/spacemouse/pos".into(),
        destination: MappingDestination::Position {
            object: ObjectRef::Index(2),
        },
        transform: Transform::default(),
        enabled: true,
    })
    .unwrap();
    r.handle_message("/spacemouse/pos", vec![1.0, 2.0, 3.0]);
    assert_eq!(positions.read().unwrap().get(&2), Some(&[1.0, 2.0, 3.0]));
    // Pas assez de valeurs → pas de routage
    r.handle_message("/spacemouse/pos", vec![9.0]);
    assert_eq!(positions.read().unwrap().get(&2), Some(&[1.0, 2.0, 3.0]));
}

// ── Enable / suppression ──

#[test]
fn test_disabled_mapping_not_routed() {
    let r = recv();
    r.add_mapping(OscMapping {
        address: "/x".into(),
        destination: MappingDestination::Handler { name: "h".into() },
        transform: Transform::default(),
        enabled: false,
    })
    .unwrap();
    r.handle_message("/x", vec![1.0]);
    assert!(r.get_last_value("h").is_none());
}

#[test]
fn test_in_disabled_drops_all() {
    let r = recv();
    r.add_handler_mapping("/x", "h").unwrap();
    r.set_in_enabled(false);
    r.handle_message("/x", vec![1.0]);
    assert!(r.get_last_value("h").is_none());
    assert_eq!(r.stats().messages_dropped, 1);
    r.set_in_enabled(true);
    r.handle_message("/x", vec![2.0]);
    assert_eq!(r.get_last_value("h"), Some(vec![2.0]));
}

#[test]
fn test_suppress_window() {
    let r = recv();
    r.add_handler_mapping("/x", "h").unwrap();
    r.suppress_ms(100);
    assert!(r.is_suppressed());
    r.handle_message("/x", vec![1.0]);
    assert!(r.get_last_value("h").is_none());
    std::thread::sleep(Duration::from_millis(120));
    r.handle_message("/x", vec![2.0]);
    assert_eq!(r.get_last_value("h"), Some(vec![2.0]));
}

// ── Lissage ──

#[test]
fn test_smoothing_converges() {
    let r = recv();
    r.add_mapping(OscMapping {
        address: "/jitter".into(),
        destination: MappingDestination::Handler { name: "j".into() },
        transform: Transform {
            smooth: 0.5,
            ..Default::default()
        },
        enabled: true,
    })
    .unwrap();
    r.handle_message("/jitter", vec![0.0]);
    r.handle_message("/jitter", vec![1.0]);
    // État initialisé à 0, puis 0.5*0 + 0.5*1 = 0.5
    assert_eq!(r.get_last_value("j"), Some(vec![0.5]));
    r.handle_message("/jitter", vec![1.0]);
    // 0.5*0.5 + 0.5*1 = 0.75
    assert_eq!(r.get_last_value("j"), Some(vec![0.75]));
}

// ── Hot-reload pendant run ──

#[test]
fn test_mappings_shared_for_hot_reload() {
    let r = recv();
    r.add_handler_mapping("/a", "ha").unwrap();
    // Simule ce que fait le thread socket : handle_message lit
    // les mappings live — pas de clone figé au start()
    r.handle_message("/a", vec![1.0]);
    assert_eq!(r.get_last_value("ha"), Some(vec![1.0]));
    r.remove_mapping("/a");
    r.add_handler_mapping("/b", "hb").unwrap();
    r.handle_message("/a", vec![2.0]);
    r.handle_message("/b", vec![3.0]);
    assert_eq!(r.get_last_value("ha"), Some(vec![1.0])); // inchangé
    assert_eq!(r.get_last_value("hb"), Some(vec![3.0]));
}

// ── Stats ──

#[test]
fn test_stats() {
    let r = recv();
    r.add_handler_mapping("/x", "h").unwrap();
    r.handle_message("/x", vec![1.0]);
    r.handle_message("/unmapped", vec![1.0]);
    let s = r.stats();
    assert_eq!(s.packets_received, 2);
    assert_eq!(s.messages_matched, 1);
    assert_eq!(s.values_routed, 1);
}

// ── CRUD legacy ──

#[test]
fn test_osc_receiver_new() {
    let receiver = OscReceiver::new(8001);
    assert_eq!(receiver.port, 8001);
    assert!(!receiver.is_running);
    assert!(receiver.in_enabled());
}

#[test]
fn test_list_and_clear_mappings() {
    let r = recv();
    r.add_handler_mapping("/a", "ha").unwrap();
    r.add_handler_mapping("/b", "hb").unwrap();
    assert_eq!(r.list_mappings().len(), 2);
    r.clear_mappings();
    assert_eq!(r.list_mappings().len(), 0);
}

#[test]
fn test_get_all_values() {
    let r = recv();
    assert_eq!(r.get_all_values().len(), 0);
    r.add_handler_mapping("/x", "h").unwrap();
    r.handle_message("/x", vec![1.0, 2.0]);
    let all = r.get_all_values();
    assert_eq!(all.get("h"), Some(&vec![1.0, 2.0]));
}

// ── Borne sur les index d'objet (anti wildcard-storm) ──

#[test]
fn test_out_of_range_object_index_rejected() {
    let r = recv();
    let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let positions: Arc<RwLock<HashMap<usize, [f64; 3]>>> = Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        object_channels: Some(channels.clone()),
        manual_positions: Some(positions.clone()),
        ..Default::default()
    });
    r.add_mapping(channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    ))
    .unwrap();
    r.add_mapping(OscMapping {
        address: "/obj/*/pos".into(),
        destination: MappingDestination::Position {
            object: ObjectRef::Wildcard("*".into()),
        },
        transform: Transform::default(),
        enabled: true,
    })
    .unwrap();

    // Index >= MAX_OBJECTS (1024) → rejeté, les maps ne grossissent pas
    r.handle_message("/track/5000/gain", vec![0.8]);
    r.handle_message("/obj/99999/pos", vec![1.0, 2.0, 3.0]);
    assert!(channels.read().unwrap().is_empty());
    assert!(positions.read().unwrap().is_empty());
    assert_eq!(r.stats().values_routed, 0);

    // Index valide → routé
    r.handle_message("/track/3/gain", vec![0.8]);
    r.handle_message("/obj/7/pos", vec![1.0, 2.0, 3.0]);
    assert_eq!(
        channels.read().unwrap().get(&3).and_then(|c| c.gain),
        Some(0.8)
    );
    assert_eq!(positions.read().unwrap().get(&7), Some(&[1.0, 2.0, 3.0]));
    assert_eq!(r.stats().values_routed, 2);
}

#[test]
fn test_max_objects_configurable() {
    let r = recv();
    assert_eq!(r.max_objects(), MAX_OBJECTS);
    let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
        Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        object_channels: Some(channels.clone()),
        ..Default::default()
    });
    r.add_mapping(channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    ))
    .unwrap();
    r.set_max_objects(8);
    assert_eq!(r.max_objects(), 8);
    r.handle_message("/track/9/gain", vec![0.5]);
    assert!(channels.read().unwrap().is_empty());
    r.handle_message("/track/7/gain", vec![0.5]);
    assert_eq!(
        channels.read().unwrap().get(&7).and_then(|c| c.gain),
        Some(0.5)
    );
}

// ── Borne mémoire sur le feedback ──

#[test]
fn test_last_values_capped() {
    let r = recv();
    r.add_handler_mapping("/x", "h").unwrap();
    {
        let mut lv = r.shared.last_values.lock().unwrap();
        // Pré-remplit à la cap, en gardant "h" pour tester l'update
        lv.insert("h".to_string(), vec![0.0]);
        for i in 0..MAX_FEEDBACK_KEYS - 1 {
            lv.insert(format!("k{i}"), vec![0.0]);
        }
    }
    // Clé existante mise à jour malgré la cap atteinte
    r.handle_message("/x", vec![1.0]);
    assert_eq!(r.get_last_value("h"), Some(vec![1.0]));
    assert_eq!(r.get_all_values().len(), MAX_FEEDBACK_KEYS);
    // Nouvelle clé rejetée au-delà de la cap
    r.add_handler_mapping("/y", "h2").unwrap();
    r.handle_message("/y", vec![2.0]);
    assert!(r.get_last_value("h2").is_none());
    assert_eq!(r.get_all_values().len(), MAX_FEEDBACK_KEYS);
}

// ── Bundle depth limit ──

fn nested_bundle(depth: usize, leaf: OscPacket) -> OscPacket {
    let mut p = leaf;
    for _ in 0..depth {
        p = OscPacket::Bundle(rosc::OscBundle {
            timetag: rosc::OscTime {
                seconds: 0,
                fractional: 1,
            },
            content: vec![p],
        });
    }
    p
}

#[test]
fn test_bundle_depth_limit() {
    let r = recv();
    r.add_handler_mapping("/x", "h").unwrap();
    let shared = r.shared.clone();

    // Bundle de 2 niveaux → le message interne est dispatché
    let ok = nested_bundle(
        2,
        OscPacket::Message(rosc::OscMessage {
            addr: "/x".to_string(),
            args: vec![OscType::Float(0.5)],
        }),
    );
    handle_packet(ok, &shared, 0, "127.0.0.1:1".parse().unwrap());
    assert_eq!(r.get_last_value("h"), Some(vec![0.5]));

    // Bundle imbriqué > MAX_BUNDLE_DEPTH → droppé, pas de stack overflow
    let deep = nested_bundle(
        MAX_BUNDLE_DEPTH + 4,
        OscPacket::Message(rosc::OscMessage {
            addr: "/x".to_string(),
            args: vec![OscType::Float(9.9)],
        }),
    );
    handle_packet(deep, &shared, 0, "127.0.0.1:1".parse().unwrap());
    assert_eq!(r.get_last_value("h"), Some(vec![0.5])); // inchangé
    assert!(r.stats().messages_dropped >= 1);
}

// ── Vrai socket UDP (couverture réelle du pipeline recv) ──

fn send_udp(addr: &str, args: Vec<OscType>, port: u16) {
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    let pkt = OscPacket::Message(rosc::OscMessage {
        addr: addr.to_string(),
        args,
    });
    let bytes = rosc::encoder::encode(&pkt).unwrap();
    sock.send_to(&bytes, ("127.0.0.1", port)).unwrap();
}

fn wait_until(cond: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    false
}

#[test]
fn test_real_socket_udp_routing() {
    let mut r = OscReceiver::new(0); // port éphémère
    r.add_handler_mapping("/test/fader", "f").unwrap();
    let macros = Arc::new(MacroState::new());
    let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
        Arc::new(RwLock::new(HashMap::new()));
    r.set_targets(OscInTargets {
        macros: Some(macros.clone()),
        object_channels: Some(channels.clone()),
        ..Default::default()
    });
    r.add_mapping(OscMapping {
        address: "/ctl/scale".into(),
        destination: MappingDestination::Macro {
            name: MacroTarget::Scale,
        },
        transform: Transform::default(),
        enabled: true,
    })
    .unwrap();
    r.add_mapping(channel_mapping(
        "/track/*/gain",
        SpatialChannel::Gain,
        ObjectRef::Wildcard("*".into()),
    ))
    .unwrap();

    r.start().unwrap();
    assert!(r.is_alive());
    let port = r.port;
    assert_ne!(port, 0, "port éphémère non résolu");

    send_udp("/test/fader", vec![OscType::Float(0.5)], port);
    send_udp("/ctl/scale", vec![OscType::Float(1.5)], port);
    send_udp("/track/3/gain", vec![OscType::Float(0.8)], port);

    assert!(wait_until(|| r.get_last_value("f").is_some()));
    assert_eq!(r.get_last_value("f"), Some(vec![0.5]));

    assert!(wait_until(|| {
        f64::from_bits(macros.scale.load(Ordering::Relaxed)) == 1.5
    }));
    // 0.8 n'est pas représentable en f32 — la valeur routée est
    // 0.8f32 as f64 ≈ 0.8000000119, jamais égale à 0.8f64 exactement.
    assert!(wait_until(|| {
        channels
            .read()
            .unwrap()
            .get(&3)
            .and_then(|c| c.gain)
            .is_some_and(|g| (g - 0.8).abs() < 1e-6)
    }));

    let s = r.stats();
    assert!(s.packets_received >= 3);
    assert_eq!(s.decode_errors, 0);
    r.stop();
    assert!(!r.is_alive());
}

#[test]
fn test_double_start_error_and_restart() {
    let mut r = OscReceiver::new(0);
    r.start().unwrap();
    assert!(r.is_running);
    assert!(r.is_alive());
    // Double-start → erreur explicite
    assert!(r.start().is_err());
    r.stop();
    assert!(!r.is_running);
    assert!(!r.is_alive());
    // Restart propre après stop
    r.start().unwrap();
    assert!(r.is_running);
    assert!(r.is_alive());
    r.stop();
}

#[test]
fn test_decode_errors_counted() {
    let mut r = OscReceiver::new(0);
    r.start().unwrap();
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    // Datagram non-OSC → erreur de décodage comptée (pas de drop silencieux)
    sock.send_to(b"definitely not an osc packet", ("127.0.0.1", r.port))
        .unwrap();
    assert!(wait_until(|| r.stats().decode_errors >= 1));
    r.stop();
}
