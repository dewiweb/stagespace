// E2E réseau du show-control OSC : vrai socket UDP → /stagespace/* →
// ShowCommand → exécution backend réelle (recall_cue_inner sur Shared) →
// feedback UDP au contrôleur. Couvre la chaîne complète hors webview —
// le dispatch frontend (event → mêmes fonctions) est couvert par vitest.
#[allow(clippy::field_reassign_with_default, clippy::uninlined_format_args)]
mod show_control_e2e_tests {
    use crate::commands::cue_commands::recall_cue_inner;
    use crate::commands::state::Shared;
    use rosc::{encoder::encode, OscMessage, OscPacket, OscType};
    use stagespace_engines::osc_receiver::ShowCommand;
    use stagespace_engines::{
        AudioState, Cue, CueMode, MergeRuntime, OscProfile, OscReceiver, OscSender, SpatialChannel,
    };
    use std::collections::{HashMap, HashSet};
    use std::net::UdpSocket;
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    fn make_shared() -> Shared {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let merge =
            MergeRuntime::new("127.0.0.1".to_string(), 0, sender, 60.0).expect("MergeRuntime bind");
        Shared {
            audio_state: Arc::new(Mutex::new(AudioState::new())),
            app_handle: Arc::new(Mutex::new(None)),
            movements: Arc::new(Mutex::new(HashMap::new())),
            pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
            move_generation: Arc::new(AtomicU64::new(0)),
            merge_runtime: Arc::new(Mutex::new(merge)),
            recall_in_progress: Arc::new(AtomicBool::new(false)),
            osc_receiver: Arc::new(Mutex::new(OscReceiver::new(0))),
            plugin_registry: None,
            plugins_dir: None,
        }
    }

    fn udp_send(socket: &UdpSocket, addr: &str, args: Vec<OscType>, port: u16) {
        let pkt = encode(&OscPacket::Message(OscMessage {
            addr: addr.to_string(),
            args,
        }))
        .unwrap();
        socket.send_to(&pkt, ("127.0.0.1", port)).unwrap();
    }

    fn udp_recv_addr(socket: &UdpSocket) -> String {
        let mut buf = [0u8; 4096];
        let (len, _) = socket.recv_from(&mut buf).unwrap();
        match rosc::decoder::decode_udp(&buf[..len]).unwrap().1 {
            OscPacket::Message(m) => m.addr,
            _ => panic!("expected OSC message"),
        }
    }

    /// Receiver réel + sink → channel. Retourne (receiver démarré, rx,
    /// client UDP lié avec timeout).
    fn harness() -> (
        OscReceiver,
        mpsc::Receiver<(ShowCommand, std::net::SocketAddr)>,
        UdpSocket,
    ) {
        let mut r = OscReceiver::new(0);
        let (tx, rx) = mpsc::channel();
        r.set_show_sink(move |cmd, src| {
            let _ = tx.send((cmd, src));
        });
        r.start().expect("receiver start");
        assert_ne!(r.port, 0);
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        (r, rx, client)
    }

    fn wait_cmd(
        rx: &mpsc::Receiver<(ShowCommand, std::net::SocketAddr)>,
    ) -> (ShowCommand, std::net::SocketAddr) {
        rx.recv_timeout(Duration::from_secs(2))
            .expect("show command timeout")
    }

    #[test]
    fn e2e_udp_command_to_backend_recall_and_feedback() {
        let (mut r, rx, client) = harness();
        let sh = make_shared();
        // État initial : un canal hors scope à préserver.
        {
            let mr = sh.merge_runtime.lock().unwrap();
            mr.set_object_channel(0, SpatialChannel::Gain, 0.5);
        }

        // 1. UDP réel → commande parsée + ack au contrôleur.
        udp_send(
            &client,
            "/stagespace/cue/recall",
            vec![OscType::String("1".into())],
            r.port,
        );
        let (cmd, src) = wait_cmd(&rx);
        assert!(matches!(cmd, ShowCommand::CueRecall(ref n) if n == "1"));
        assert_eq!(src.port(), client.local_addr().unwrap().port());
        assert_eq!(udp_recv_addr(&client), "/stagespace/ack");

        // 2. Le dispatcher (frontend dans l'app) exécute recall_cue_inner —
        //    Tracking + merge : object 1 prend gain 0.8, object 0 intact.
        let mut cue = Cue {
            id: "cue-tc".to_string(),
            name: "TC".to_string(),
            graph: stagespace_engines::GraphJson::default(),
            timestamp: 0.0,
            track_indices: vec![1],
            fade_duration: 0.0,
            ..Default::default()
        };
        cue.mode = CueMode::Tracking;
        let mut chs = stagespace_engines::SpatialChannels::default();
        chs.gain = Some(0.8);
        cue.object_channels = Some(HashMap::from([(1usize, chs)]));
        recall_cue_inner(cue, sh.clone()).expect("recall");
        {
            let mr = sh.merge_runtime.lock().unwrap();
            let all = mr.object_channels();
            assert_eq!(all.get(&0).and_then(|c| c.gain), Some(0.5));
            assert_eq!(all.get(&1).and_then(|c| c.gain), Some(0.8));
        }

        // 3. Feedback vers le contrôleur : les 2 messages arrivent en UDP.
        r.send_show_feedback(
            Some(("1".to_string(), "TC".to_string())),
            Some(("2".to_string(), "next".to_string())),
        );
        let mut got = HashSet::new();
        for _ in 0..2 {
            got.insert(udp_recv_addr(&client));
        }
        assert!(got.contains("/stagespace/cue/current"));
        assert!(got.contains("/stagespace/cue/next"));
        r.stop();
    }

    #[test]
    fn e2e_timecode_stream_parsing() {
        let (mut r, rx, client) = harness();
        r.set_timecode_fps(25.0);
        // Ramp float : 60.0 → 60.08 s (~4 frames à 25fps).
        for t in [60.0, 60.04, 60.08] {
            udp_send(
                &client,
                "/stagespace/timecode",
                vec![OscType::Float(t)],
                r.port,
            );
            udp_recv_addr(&client); // drain l'ack
        }
        for want in [60.0, 60.04, 60.08] {
            let (cmd, _) = wait_cmd(&rx);
            match cmd {
                ShowCommand::Timecode(v) => assert!((v - want).abs() < 1e-3, "{v} vs {want}"),
                other => panic!("expected Timecode, got {other:?}"),
            }
        }
        // Forme string HH:MM:SS:FF : 12 frames à 25fps = +0.48 s.
        udp_send(
            &client,
            "/stagespace/timecode",
            vec![OscType::String("00:01:00:12".into())],
            r.port,
        );
        udp_recv_addr(&client);
        let (cmd, _) = wait_cmd(&rx);
        match cmd {
            ShowCommand::Timecode(v) => assert!((v - 60.48).abs() < 1e-3, "{v}"),
            other => panic!("expected Timecode, got {other:?}"),
        }
        r.stop();
    }

    #[test]
    fn e2e_show_prefix_never_reaches_user_mappings() {
        let (mut r, rx, client) = harness();
        // Mapping utilisateur sur une adresse normale — doit rester routé.
        r.add_handler_mapping("/fader/1", "fader1").unwrap();
        udp_send(&client, "/fader/1", vec![OscType::Float(0.5)], r.port);
        udp_send(&client, "/stagespace/go", vec![], r.port);
        udp_recv_addr(&client); // ack du /stagespace/go
        let (cmd, _) = wait_cmd(&rx);
        assert!(matches!(cmd, ShowCommand::Go));
        // Le mapping utilisateur a bien reçu sa valeur — le préfixe réservé
        // ne l'a pas polluée.
        assert_eq!(r.get_last_value("fader1"), Some(vec![0.5]));
        assert!(r.get_last_value("/stagespace/go").is_none());
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
        r.stop();
    }

    #[test]
    fn e2e_panic_passes_during_recall_suppression() {
        let (mut r, rx, client) = harness();
        r.suppress_ms(100_000);
        udp_send(&client, "/fader/1", vec![OscType::Float(0.9)], r.port);
        r.add_handler_mapping("/fader/1", "fader1").unwrap();
        udp_send(&client, "/stagespace/panic", vec![], r.port);
        udp_send(&client, "/fader/1", vec![OscType::Float(0.9)], r.port);
        udp_recv_addr(&client); // ack panic
        let (cmd, _) = wait_cmd(&rx);
        assert!(matches!(cmd, ShowCommand::Panic));
        r.stop();
    }
}
