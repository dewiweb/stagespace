use super::*;

use std::sync::mpsc;

/// Construit un receiver + récupère les commandes via un channel
/// branché au show_sink.
fn make() -> (
    OscReceiver,
    mpsc::Receiver<(ShowCommand, std::net::SocketAddr)>,
) {
    let r = OscReceiver::new(0);
    let (tx, rx) = mpsc::channel();
    r.set_show_sink(move |cmd, addr| {
        let _ = tx.send((cmd, addr));
    });
    (r, rx)
}

fn msg(addr: &str, args: Vec<OscType>) -> OscPacket {
    OscPacket::Message(OscMessage {
        addr: addr.to_string(),
        args,
    })
}

#[test]
fn parses_every_command() {
    let fps = 25.0;
    let cases: Vec<(&str, Vec<OscType>, ShowCommand)> = vec![
        ("/stagespace/go", vec![], ShowCommand::Go),
        ("/stagespace/cue/next", vec![], ShowCommand::CueNext),
        ("/stagespace/cue/prev", vec![], ShowCommand::CuePrev),
        (
            "/stagespace/cue/recall",
            vec![OscType::Int(3)],
            ShowCommand::CueRecall("3".into(), None),
        ),
        (
            "/stagespace/cue/recall",
            vec![OscType::String("2".into()), OscType::Float(1.5)],
            ShowCommand::CueRecall("2".into(), Some(1.5)),
        ),
        (
            "/stagespace/slot",
            vec![OscType::Int(3)],
            ShowCommand::Slot(3),
        ),
        (
            "/stagespace/slot/stop",
            vec![OscType::Int(3)],
            ShowCommand::SlotStop(3),
        ),
        (
            "/stagespace/solo",
            vec![OscType::String("2".into())],
            ShowCommand::Solo(2),
        ),
        ("/stagespace/arm", vec![], ShowCommand::Arm),
        ("/stagespace/disarm", vec![], ShowCommand::Disarm),
        ("/stagespace/status", vec![], ShowCommand::Status),
        ("/stagespace/panic", vec![], ShowCommand::Panic),
        ("/stagespace/stop", vec![], ShowCommand::Stop),
        (
            "/stagespace/park",
            vec![OscType::Int(3)],
            ShowCommand::Park(3),
        ),
        (
            "/stagespace/park",
            vec![OscType::String("7".into())],
            ShowCommand::Park(7),
        ),
        (
            "/stagespace/unpark",
            vec![OscType::Int(3)],
            ShowCommand::Unpark(3),
        ),
        (
            "/stagespace/position",
            vec![
                OscType::Int(1),
                OscType::Float(1.5),
                OscType::Float(-2.0),
                OscType::Float(0.25),
            ],
            ShowCommand::SetPosition(1, 1.5, -2.0, 0.25),
        ),
        (
            "/stagespace/position/clear",
            vec![OscType::Int(2)],
            ShowCommand::ClearPosition(2),
        ),
        (
            "/stagespace/position/clearall",
            vec![],
            ShowCommand::ClearAllPositions,
        ),
        (
            "/stagespace/trackpos",
            vec![
                OscType::Int(4),
                OscType::Float(3.0),
                OscType::Float(0.0),
                OscType::Float(-1.0),
            ],
            ShowCommand::SetTrackPosition(4, 3.0, 0.0, -1.0),
        ),
        (
            "/stagespace/timecode",
            vec![OscType::Float(12.5)],
            ShowCommand::Timecode(12.5),
        ),
        (
            "/stagespace/timecode",
            vec![OscType::String("00:00:01:10".into())],
            ShowCommand::Timecode(1.0 + 10.0 / 25.0),
        ),
        (
            "/stagespace/throw",
            vec![
                OscType::Int(2),
                OscType::Float(1.5),
                OscType::Float(0.5),
                OscType::Float(-1.0),
            ],
            ShowCommand::Throw(2, 1.5, 0.5, -1.0),
        ),
        (
            "/stagespace/spatial",
            vec![OscType::Float(0.7)],
            ShowCommand::Spatial(0.7),
        ),
        (
            "/stagespace/attention",
            vec![OscType::Int(3)],
            ShowCommand::Attention(Some(3)),
        ),
        (
            "/stagespace/attention/clear",
            vec![],
            ShowCommand::Attention(None),
        ),
        (
            "/stagespace/gesture",
            vec![OscType::String("explode".into())],
            ShowCommand::Gesture("explode".into(), 3.0),
        ),
        (
            "/stagespace/gesture",
            vec![OscType::String("orbit".into()), OscType::Float(5.0)],
            ShowCommand::Gesture("orbit".into(), 5.0),
        ),
        (
            "/stagespace/rehearsal",
            vec![OscType::String("play".into())],
            ShowCommand::Rehearsal("play".into()),
        ),
        (
            "/stagespace/record",
            vec![OscType::String("start".into())],
            ShowCommand::Rehearsal("record".into()),
        ),
    ];
    for (addr, args, expected) in cases {
        let got =
            parse_show_command(addr, &args, fps).unwrap_or_else(|| panic!("{addr} should parse"));
        assert_eq!(
            std::mem::discriminant(&got),
            std::mem::discriminant(&expected),
            "{addr}"
        );
        if let (ShowCommand::Timecode(a), ShowCommand::Timecode(b)) = (&got, &expected) {
            assert!((a - b).abs() < 1e-9, "{addr}: {a} != {b}");
        }
    }
    // Inconnue → None.
    assert!(parse_show_command("/stagespace/bogus", &[], fps).is_none());
    assert!(parse_show_command("/other/go", &[], fps).is_none());
}

#[test]
fn stagespace_prefix_never_reaches_mappings() {
    let (r, rx) = make();
    let src: std::net::SocketAddr = "127.0.0.1:9999".parse().unwrap();
    let shared = r.shared.clone();
    // Un mapping greedy qui aurait capturé l'adresse.
    handle_packet(msg("/stagespace/go", vec![]), &shared, 0, src);
    let (cmd, _src) = rx.try_recv().expect("command should arrive");
    assert!(matches!(cmd, ShowCommand::Go));
    // Rien dans last_by_address ni dans les valeurs routées.
    assert!(!shared
        .last_by_address
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains_key("/stagespace/go"));
}

#[test]
fn bundle_and_suppress_still_reach_show_control() {
    let (r, rx) = make();
    let src: std::net::SocketAddr = "127.0.0.1:9998".parse().unwrap();
    r.suppress_ms(100_000);
    let bundle = OscPacket::Bundle(rosc::OscBundle {
        timetag: (0, 0).into(),
        content: vec![
            msg("/stagespace/panic", vec![]),
            msg("/stagespace/cue/recall", vec![OscType::Int(2)]),
        ],
    });
    handle_packet(bundle, &r.shared, 0, src);
    assert!(matches!(rx.try_recv().unwrap().0, ShowCommand::Panic));
    assert!(matches!(rx.try_recv().unwrap().0, ShowCommand::CueRecall(ref s, _) if s == "2"));
}

#[test]
fn ack_goes_back_to_sender() {
    // Pair de sockets : receiver sur port 0, client envoie et lit l'ack.
    let mut r = OscReceiver::new(0);
    r.start().unwrap();
    let client = UdpSocket::bind("127.0.0.1:0").unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let pkt = encode(&msg("/stagespace/panic", vec![])).unwrap();
    client.send_to(&pkt, ("127.0.0.1", r.port)).unwrap();
    let mut buf = [0u8; 2048];
    let (len, _) = client.recv_from(&mut buf).expect("ack expected");
    let (_, packet) = decode_udp(&buf[..len]).unwrap();
    match packet {
        OscPacket::Message(m) => {
            assert_eq!(m.addr, "/stagespace/ack");
            assert_eq!(m.args, vec![OscType::String("/stagespace/panic".into())]);
        }
        _ => panic!("expected message"),
    }
    r.stop();
}

#[test]
fn view_parse() {
    assert_eq!(
        parse_show_command(
            "/stagespace/view",
            &[OscType::String("conduite".into())],
            25.0
        ),
        Some(ShowCommand::View("conduite".into()))
    );
    // Sans arg → refusé.
    assert!(parse_show_command("/stagespace/view", &[], 25.0).is_none());
}

#[test]
fn show_load_parse() {
    assert_eq!(
        parse_show_command(
            "/stagespace/show/load",
            &[OscType::String("/tmp/s.hfg".into())],
            25.0
        ),
        Some(ShowCommand::ShowLoad("/tmp/s.hfg".into()))
    );
    assert_eq!(
        parse_show_command("/stagespace/load", &[OscType::String("s.hfg".into())], 25.0),
        Some(ShowCommand::ShowLoad("s.hfg".into()))
    );
}
