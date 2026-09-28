use crate::merge_runtime::helpers::merge_positions;
use crate::merge_runtime::move_state::{MergeStrategy, MoveState};
use crate::merge_runtime::MergeRuntime;
use crate::osc_sender::{OscProfile, OscSender};
use crate::position_buffer::PositionBuffer;
use std::sync::Arc;

/// Compile un graph signal minimal `SignalConst → SignalOut` — le delta
/// `value * amount` s'applique à la macro `target` à chaque frame.
fn const_signal_fn(target: &str, value: f64, amount: f64) -> crate::signal_compiler::SignalFn {
    let mut g = crate::graph::Graph::new();
    let c = crate::graph::Node::with_params(
        crate::graph::NodeType::SignalConst,
        serde_json::json!({"value": value}),
    );
    let out = crate::graph::Node::with_params(
        crate::graph::NodeType::SignalOut,
        serde_json::json!({"target": target, "amount": amount}),
    );
    g.add_node(c.clone());
    g.add_node(out.clone());
    g.add_edge(crate::graph::Edge {
        from: c.id,
        to: out.id,
        from_port: "output".to_string(),
        to_port: "signal".to_string(),
    });
    crate::signal_compiler::compile_signal_graph(&g).expect("signal graph compiles")
}

#[test]
fn test_merge_override() {
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        0,
        vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
        ],
    );
    let move_b = (
        "b".to_string(),
        0.5,
        1.0,
        0,
        vec![
            (0, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
        ],
    );
    let merged = merge_positions(&[move_a, move_b], MergeStrategy::Override);
    // Override : fade le plus élevé gagne → move_a (fade 1.0)
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
    assert!((merged[1].1.x - 2.0).abs() < 1e-10);
}

#[test]
fn test_merge_crossfade() {
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(0.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        1.0,
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(10.0, 0.0, 0.0))],
    );
    let merged = merge_positions(&[move_a, move_b], MergeStrategy::Crossfade);
    // Crossfade : moyenne pondérée → (0 + 10) / 2 = 5
    assert!((merged[0].1.x - 5.0).abs() < 1e-10);
}

#[test]
fn test_merge_single_move() {
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(1.0, 2.0, 3.0))],
    );
    let merged = merge_positions(&[move_a], MergeStrategy::Override);
    assert_eq!(merged.len(), 1);
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
}

#[test]
fn test_merge_empty() {
    let merged = merge_positions(&[], MergeStrategy::Override);
    // When no moves are active, merge_positions returns empty (no OSC output)
    assert_eq!(merged.len(), 0);
}

#[test]
fn test_merge_disjoint_tracks() {
    // Move A contrôle tracks [0, 1, 2] (positions locales 0,1,2)
    // Move B contrôle tracks [3, 4, 5] (positions locales 0,1,2 → remappées en 3,4,5)
    // Après remapping, le merge ne doit pas écraser les positions de A avec celles de B
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        0,
        vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
            (2, nalgebra::Vector3::new(3.0, 0.0, 0.0)),
        ],
    );
    // Move B avec indices déjà remappés (3,4,5)
    let move_b = (
        "b".to_string(),
        1.0,
        1.0,
        0,
        vec![
            (3, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (4, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
            (5, nalgebra::Vector3::new(30.0, 0.0, 0.0)),
        ],
    );
    let merged = merge_positions(&[move_a, move_b], MergeStrategy::Override);
    assert_eq!(merged.len(), 6);
    // Tracks 0-2 : move A
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
    assert!((merged[1].1.x - 2.0).abs() < 1e-10);
    assert!((merged[2].1.x - 3.0).abs() < 1e-10);
    // Tracks 3-5 : move B
    assert!((merged[3].1.x - 10.0).abs() < 1e-10);
    assert!((merged[4].1.x - 20.0).abs() < 1e-10);
    assert!((merged[5].1.x - 30.0).abs() < 1e-10);
}

#[test]
fn test_merge_priority() {
    // Move A : priority 1, position x=1
    // Move B : priority 5, position x=99
    // → B doit gagner malgré un fade plus faible
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        1,
        vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        0.1,
        1.0,
        5,
        vec![(0, nalgebra::Vector3::new(99.0, 0.0, 0.0))],
    );
    let merged = merge_positions(&[move_a, move_b], MergeStrategy::Priority);
    // Priority : B (priority 5) gagne sur A (priority 1) même si fade de B est plus faible
    assert!((merged[0].1.x - 99.0).abs() < 1e-10);
}

#[test]
fn test_merge_priority_tiebreak_by_fade() {
    // Deux moves même priorité : le fade le plus élevé gagne
    let move_a = (
        "a".to_string(),
        1.0,
        1.0,
        5,
        vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        0.5,
        1.0,
        5,
        vec![(0, nalgebra::Vector3::new(99.0, 0.0, 0.0))],
    );
    let merged = merge_positions(&[move_a, move_b], MergeStrategy::Priority);
    // Même priorité → tiebreak par fade → A (fade 1.0) gagne
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
}

#[test]
fn test_move_state_fade_in() {
    let mut state = MoveState::new(vec![1], vec![0], false);
    state.start_fade_in(1.0);
    let fade = state.update_fade(0.5);
    assert!((fade - 0.5).abs() < 1e-10);
    let fade = state.update_fade(0.5);
    assert!((fade - 1.0).abs() < 1e-10);
}

#[test]
fn test_move_state_fade_out() {
    let mut state = MoveState::new(vec![1], vec![0], false);
    state.start_fade_out(1.0);
    let fade = state.update_fade(0.5);
    assert!((fade - 0.5).abs() < 1e-10);
    assert!(state.is_active);
    let fade = state.update_fade(0.5);
    assert!((fade - 0.0).abs() < 1e-10);
    assert!(!state.is_active);
}

#[test]
fn test_merge_runtime_creation() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0);
    assert!(rt.is_ok());
    let rt = rt.unwrap();
    assert!(!rt.is_running());
}

#[test]
fn test_register_unregister_move() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    let buffer = Arc::new(PositionBuffer::new());
    rt.register_move("move1".to_string(), buffer, vec![1, 2], vec![0, 1], false);
    assert_eq!(rt.active_moves.read().unwrap().len(), 1);
    rt.unregister_move("move1");
    assert_eq!(rt.active_moves.read().unwrap().len(), 0);
}

#[test]
fn test_post_process_world_space_pivots() {
    // Les positions en entrée du post-process sont WORLD-SPACE (transform
    // per-move déjà appliqué par le worker). L'origin globale est un PIVOT
    // pour les transforms — plus une translation ajoutée à la fin.
    use crate::merge_runtime::helpers::default_post_process_fn;
    use crate::runtime::PostProcessContext;
    use crate::MacroState;
    use std::collections::HashMap;

    let macros = MacroState::new();
    macros.set_scale(2.0);
    let audio_state = crate::audio::AudioState::default();
    let track_positions: HashMap<u32, [f64; 3]> = HashMap::new();
    let manual_positions: HashMap<usize, [f64; 3]> = HashMap::new();
    let track_depths: Vec<f64> = Vec::new();
    let origin = nalgebra::Vector3::new(10.0, 0.0, 0.0);

    let ctx = PostProcessContext {
        t: 0.0,
        macros: &macros,
        audio_state: &audio_state,
        track_positions: &track_positions,
        manual_positions: &manual_positions,
        origin,
        track_depths: &track_depths,
    };

    let pp = default_post_process_fn();
    // World pos (12, 0, 0) — à distance 2 de l'origin → scale 2 → distance 4
    let out = pp(&ctx, vec![(0, nalgebra::Vector3::new(12.0, 0.0, 0.0))]);
    assert!(
        (out[0].1.x - 14.0).abs() < 1e-9,
        "scale autour de l'origin: x={} attendu 14",
        out[0].1.x
    );

    // Identité : une position monde passe inchangée (PAS de +origin)
    let macros_id = MacroState::new();
    let ctx_id = PostProcessContext {
        macros: &macros_id,
        ..ctx
    };
    let out = pp(&ctx_id, vec![(0, nalgebra::Vector3::new(3.0, 4.0, 5.0))]);
    assert!(
        (out[0].1 - nalgebra::Vector3::new(3.0, 4.0, 5.0)).norm() < 1e-9,
        "identité: {:?}",
        out[0].1
    );
}

#[test]
fn test_set_graph_effects_replaces_in_block() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();

    let zone = crate::zones::Zone::from_node_params(&serde_json::json!({
        "shape": "sphere", "channels": {"gain": 0.0}
    }))
    .unwrap();
    let rule = crate::kinematics::ChannelModulation::from_node_params(&serde_json::json!({
        "source": "speed", "channel": "spread", "scale": 0.1
    }))
    .unwrap();

    // Premier set : 1 zone + 1 modulation
    rt.set_graph_effects(vec![zone.clone()], vec![rule], false, None);
    let (z, m) = rt.graph_effects();
    assert_eq!(z.len(), 1);
    assert_eq!(m.len(), 1);

    // Deuxième set : remplace en bloc (update du graphe sans effets → vide)
    rt.set_graph_effects(Vec::new(), Vec::new(), false, None);
    let (z, m) = rt.graph_effects();
    assert!(z.is_empty());
    assert!(m.is_empty());

    // Les effets manuels ne sont pas touchés par set_graph_effects
    rt.add_zone(zone).unwrap();
    rt.set_graph_effects(Vec::new(), Vec::new(), false, None);
    assert_eq!(rt.zones().len(), 1);
}

/// Sink de test qui échoue sur chaque envoi — vérifie que les erreurs
/// remontent dans osc_error_rate (sinon un renderer down est invisible).
struct FailSink;
impl crate::position_sink::PositionSink for FailSink {
    fn send_state(
        &mut self,
        _object_id: u32,
        _position: nalgebra::Vector3<f64>,
        _channels: Option<&crate::osc_sender::SpatialChannels>,
    ) -> crate::position_sink::SendReport {
        crate::position_sink::SendReport {
            sent: 0,
            errors: 1,
            refused: 0,
        }
    }
    fn describe(&self) -> String {
        "fail://test".to_string()
    }
}

#[test]
fn test_failing_sink_surfaces_osc_error_rate() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    rt.set_sink(Box::new(FailSink));
    // La liste osc_ids GLOBALE doit contenir l'id — sinon le merge ne
    // résout pas le track_index et n'appelle jamais le sink.
    rt.set_osc_ids(vec![1]);

    let buffer = Arc::new(PositionBuffer::new());
    buffer.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
    let writer = {
        let b = buffer.clone();
        std::thread::spawn(move || {
            for _ in 0..120 {
                b.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        })
    };
    rt.register_move("m1".to_string(), buffer, vec![1], vec![0], false);
    rt.start().unwrap();
    // Perf stats ne se rafraîchissent que toutes les ~500 ms.
    std::thread::sleep(std::time::Duration::from_millis(900));
    rt.stop();
    writer.join().unwrap();

    let stats = rt.get_perf_stats();
    assert!(
        stats.osc_error_rate > 0.0,
        "les échecs du sink doivent remonter dans osc_error_rate"
    );
}

#[test]
fn test_thread_died_marks_liveness() {
    // Un panic dans le post-process doit tuer le thread de façon OBSERVABLE :
    // thread_died=true + running=false — sinon blackout OSC silencieux.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    rt.swap_post_process_fn(Box::new(|_ctx, _positions| {
        panic!("injected post-process panic");
    }));

    let buffer = Arc::new(PositionBuffer::new());
    buffer.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
    let writer = {
        let b = buffer.clone();
        std::thread::spawn(move || {
            for _ in 0..60 {
                b.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        })
    };
    rt.register_move("m1".to_string(), buffer, vec![1], vec![0], false);
    rt.start().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(300));
    writer.join().unwrap();

    assert!(
        rt.thread_died(),
        "le panic contenu doit marquer thread_died"
    );
    assert!(!rt.is_running(), "le thread mort ne doit plus dire running");
    rt.stop();
}

#[test]
fn test_fresh_move_survives_stale_grace() {
    // Un move fraîchement enregistré dont le premier write tarde ne doit PAS
    // être retiré à la limite normale (30 frames ≈ 0.5 s) — grace étendue.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    let buffer = Arc::new(PositionBuffer::new()); // jamais écrit dans le test
    rt.register_move("fresh".to_string(), buffer, vec![1], vec![0], false);
    rt.start().unwrap();
    // ~70 frames à 60 FPS — dépasse largement l'ancienne limite de 30.
    std::thread::sleep(std::time::Duration::from_millis(1200));
    rt.stop();
    assert!(
        rt.has_move("fresh"),
        "un move frais (jamais écrit) doit survivre à la grace période"
    );
}

#[test]
fn test_stale_kill_publishes_id_and_buffer() {
    // Audit C5 : un move dont le worker est mort (buffer gelé après une
    // première écriture) doit être retiré ET publié dans la file
    // stale_kill — le superviseur backend en a besoin pour arrêter le
    // thread worker (sinon zombie CPU à 100 %).
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 300.0).unwrap();
    let buffer = Arc::new(PositionBuffer::new());
    // Une première écriture pour sortir de la grace "fresh" — puis gel.
    buffer.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
    rt.register_move(
        "zombie".to_string(),
        buffer.clone(),
        vec![1],
        vec![0],
        false,
    );
    rt.start().unwrap();

    // 30 frames stale à 300 FPS ≈ 100 ms — on poll jusqu'à 3 s.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let kills = loop {
        let k = rt.drain_stale_kills();
        if !k.is_empty() {
            break k;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "stale-kill jamais publié"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    rt.stop();

    assert_eq!(kills.len(), 1);
    assert_eq!(kills[0].0, "zombie");
    // L'Arc publié est le buffer du move — le superviseur fera ptr_eq
    // contre le runtime pour ne pas tuer un id réutilisé.
    assert!(Arc::ptr_eq(&kills[0].1, &buffer));
    assert!(
        !rt.has_move("zombie"),
        "le move stale doit être retiré du merge"
    );
    assert!(
        rt.drain_stale_kills().is_empty(),
        "la file doit être drainée"
    );
}

/// Sink de test qui capture la dernière position reçue par object_id.
#[derive(Clone)]
struct CaptureSink(Arc<std::sync::Mutex<std::collections::HashMap<u32, nalgebra::Vector3<f64>>>>);
impl crate::position_sink::PositionSink for CaptureSink {
    fn send_state(
        &mut self,
        object_id: u32,
        position: nalgebra::Vector3<f64>,
        _channels: Option<&crate::osc_sender::SpatialChannels>,
    ) -> crate::position_sink::SendReport {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(object_id, position);
        crate::position_sink::SendReport {
            sent: 1,
            errors: 0,
            refused: 0,
        }
    }
    fn describe(&self) -> String {
        "capture://test".to_string()
    }
}

/// Écrit en continu dans un buffer — imite un worker vivant (sinon le
/// stale-kill retire le move en 30 frames).
fn spawn_writer(
    buffer: &Arc<PositionBuffer>,
    idx: usize,
    pos: nalgebra::Vector3<f64>,
    frames: usize,
) -> std::thread::JoinHandle<()> {
    let b = buffer.clone();
    std::thread::spawn(move || {
        for _ in 0..frames {
            b.write(vec![(idx, pos)]);
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    })
}

#[test]
fn test_signal_fn_eval_and_hot_swap() {
    // swap_signal_fn installe le graph ; eval_signal_deltas l'expose hors
    // boucle (diagnostic) ; empty_signal_fn reset proprement.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();

    assert!(rt.eval_signal_deltas(0.0, 1.0 / 60.0).is_empty());

    rt.swap_signal_fn(const_signal_fn("yaw", 10.0, 2.0));
    let d = rt.eval_signal_deltas(0.0, 1.0 / 60.0);
    assert!((d.get("yaw").copied().unwrap_or(0.0) - 20.0).abs() < 1e-9);

    // Reset — un cue/update sans graph ne doit pas laisser la modulation.
    rt.swap_signal_fn(crate::signal_compiler::empty_signal_fn());
    assert!(rt.eval_signal_deltas(0.0, 1.0 / 60.0).is_empty());
}

#[test]
fn test_signal_deltas_reach_sink_e2e() {
    // End-to-end : un delta `scale +1` du graph signal doit doubler les
    // positions en sortie du merge (scale effective = base 1 + delta 1).
    // Le transform est lu via le clone effectif — la macro de base reste 1.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    let captured = Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    rt.set_sink(Box::new(CaptureSink(captured.clone())));
    rt.set_osc_ids(vec![1]);
    rt.swap_signal_fn(const_signal_fn("scale", 1.0, 1.0));

    let b = Arc::new(PositionBuffer::new());
    rt.register_move("m1".to_string(), b.clone(), vec![1], vec![0], false);
    let w = spawn_writer(&b, 0, nalgebra::Vector3::new(2.0, 0.0, 0.0), 150);
    rt.start().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(500));
    rt.stop();
    w.join().unwrap();

    let map = captured.lock().unwrap_or_else(|e| e.into_inner());
    let pos = map.get(&1).copied().expect("aucune position capturée");
    assert!(
        (pos.x - 4.0).abs() < 1e-6,
        "delta scale +1 → position doublée (2→4): {pos:?}"
    );
    assert!(
        (rt.macros().get_scale() - 1.0).abs() < 1e-9,
        "la macro de base ne doit JAMAIS être mutée par le signal graph"
    );
}

#[test]
fn test_moveref_selects_single_move_positions() {
    // Audit T2 : MoveRef.move_id doit filtrer la source du post-process.
    // Deux moves actifs, move_ref = "m2" → seul le track de m2 émet.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    let captured = Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    rt.set_sink(Box::new(CaptureSink(captured.clone())));
    rt.set_osc_ids(vec![1, 2]);
    rt.set_graph_effects(Vec::new(), Vec::new(), false, Some("m2".to_string()));

    let b1 = Arc::new(PositionBuffer::new());
    let b2 = Arc::new(PositionBuffer::new());
    rt.register_move("m1".to_string(), b1.clone(), vec![1], vec![0], false);
    rt.register_move("m2".to_string(), b2.clone(), vec![2], vec![1], false);
    let w1 = spawn_writer(&b1, 0, nalgebra::Vector3::new(1.0, 0.0, 0.0), 150);
    let w2 = spawn_writer(&b2, 0, nalgebra::Vector3::new(9.0, 9.0, 9.0), 150);
    rt.start().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(500));
    rt.stop();
    w1.join().unwrap();
    w2.join().unwrap();

    let map = captured.lock().unwrap_or_else(|e| e.into_inner());
    assert!(
        !map.contains_key(&1),
        "le track de m1 ne doit pas émettre quand MoveRef=m2: {map:?}"
    );
    assert_eq!(
        map.get(&2).copied(),
        Some(nalgebra::Vector3::new(9.0, 9.0, 9.0)),
        "seul le track de m2 doit émettre sa position: {map:?}"
    );
}

#[test]
fn test_barycenter_recomputes_pivot() {
    // Audit T2 : le node Barycenter recalcule l'origin = isobarycentre
    // des track_positions chaque frame. Avec scale=2 macro : pos (4,0,0)
    // pivotée autour de (3,0,0) → (5,0,0) ; autour de l'origin fixe
    // (0,0,0) → (8,0,0) — le test distingue les deux.
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let mut rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
    let captured = Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    rt.set_sink(Box::new(CaptureSink(captured.clone())));
    rt.set_osc_ids(vec![1]);
    rt.set_track_positions({
        let mut m = std::collections::HashMap::new();
        m.insert(1u32, [2.0, 0.0, 0.0]);
        m.insert(2u32, [4.0, 0.0, 0.0]);
        m
    });
    rt.macros().set_scale(2.0);
    // Barycenter actif via les effets du graph global
    rt.set_graph_effects(Vec::new(), Vec::new(), true, None);

    let b = Arc::new(PositionBuffer::new());
    rt.register_move("m1".to_string(), b.clone(), vec![1], vec![0], false);
    let w = spawn_writer(&b, 0, nalgebra::Vector3::new(4.0, 0.0, 0.0), 150);
    rt.start().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(500));
    rt.stop();
    w.join().unwrap();

    let map = captured.lock().unwrap_or_else(|e| e.into_inner());
    let pos = map.get(&1).copied().expect("aucune position capturée");
    // pivot = isobarycentre (3,0,0) : 3 + (4-3)*2 = 5
    assert!(
        (pos.x - 5.0).abs() < 1e-6,
        "barycenter doit pivoter autour de (3,0,0): {pos:?}"
    );
}
