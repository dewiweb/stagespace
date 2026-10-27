use super::*;
use crate::engines::EngineParams;
use crate::position_buffer::PositionBuffer;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[test]
fn test_runtime_creation() {
    let rt = Runtime::new();
    assert!(!rt.is_running());
}

#[test]
fn test_loop_mode() {
    let rt = Runtime::new();
    rt.set_loop_mode(LoopMode::OneShot);
    assert_eq!(rt.config.get_loop_mode(), LoopMode::OneShot);
    rt.set_loop_mode(LoopMode::Loop);
    assert_eq!(rt.config.get_loop_mode(), LoopMode::Loop);
}

#[test]
fn test_hot_swap_position_fn() {
    let rt = Runtime::new();
    rt.swap_position_fn(Arc::new(|t, i| nalgebra::Vector3::new(t, i as f64, 0.0)));
    let fn_ref = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
    let pos = fn_ref(1.5, 3);
    assert!((pos.x - 1.5).abs() < 1e-10);
    assert!((pos.y - 3.0).abs() < 1e-10);
}

#[test]
fn test_runtime_play_compiled() {
    let runtime = Runtime::new();
    runtime.set_position_buffer(Arc::new(PositionBuffer::new()));

    let duration = 1.0;
    let params = EngineParams {
        n_objects: 3,
        duration,
        fps: 60.0,
        extra: json!({
            "radius": 1.0,
            "plane": "xz"
        }),
    };
    let osc_ids = vec![1, 2, 3];

    let position_fn = Arc::new(move |t: f64, _obj_idx: usize| {
        let angle = 2.0 * std::f64::consts::PI * t / duration;
        let radius = 1.0;
        nalgebra::Vector3::new(radius * angle.cos(), 0.0, radius * angle.sin())
    });

    let result = runtime.play_compiled(position_fn, params, osc_ids);
    assert!(result.is_ok(), "Failed to start playback: {result:?}");
    assert!(runtime.is_running());

    std::thread::sleep(Duration::from_millis(100));
    runtime.stop();
    assert!(!runtime.is_running());
}

fn test_runtime() -> Runtime {
    let rt = Runtime::new();
    rt.set_position_buffer(Arc::new(PositionBuffer::new()));
    rt
}

#[test]
fn test_play_compiled_requires_buffer() {
    // Un worker sans PositionBuffer n'a aucune sortie — play_compiled doit
    // refuser plutôt que de tourner dans le vide, et rester stoppable.
    let rt = Runtime::new();
    let result = rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(1.0),
        vec![1],
    );
    assert!(result.is_err(), "play sans buffer doit être rejeté");
    assert!(!rt.is_running(), "running doit être rollback après refus");
    // Le runtime reste utilisable après le refus
    rt.set_position_buffer(Arc::new(PositionBuffer::new()));
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(1.0),
        vec![1],
    )
    .unwrap();
    rt.stop();
}

fn test_params(duration: f64) -> EngineParams {
    EngineParams {
        n_objects: 1,
        duration,
        fps: 60.0,
        extra: json!({}),
    }
}

#[test]
fn test_play_compiled_rejects_second_spawn() {
    // Régression : un second play_compiled() orphelinait le premier worker
    // — les deux threads écrivaient le même PositionBuffer à des horloges
    // indépendantes.
    let rt = test_runtime();
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(10.0),
        vec![1],
    )
    .unwrap();
    let again = rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(10.0),
        vec![1],
    );
    assert!(again.is_err(), "second play_compiled doit être rejeté");
    rt.stop();
    // Après stop, un nouveau play est accepté
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(10.0),
        vec![1],
    )
    .unwrap();
    rt.stop();
}

#[test]
fn test_one_shot_exit_clears_running() {
    // Régression : le flag running restait true après la fin naturelle
    // d'un one-shot → is_running() stale.
    let rt = test_runtime();
    rt.set_loop_mode(LoopMode::OneShot);
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(0.05),
        vec![1],
    )
    .unwrap();
    // Laisse le one-shot se terminer tout seul (duration = 50ms)
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        !rt.is_running(),
        "running doit être false après la fin naturelle"
    );
}

#[test]
fn test_drop_joins_worker() {
    // Live-safety : drop sans stop() explicite doit arrêter + join le worker.
    let running = {
        let rt = test_runtime();
        let running = rt.running.clone();
        rt.play_compiled(
            Arc::new(|_, _| nalgebra::Vector3::zeros()),
            test_params(60.0),
            vec![1],
        )
        .unwrap();
        assert!(running.load(Ordering::SeqCst));
        drop(rt); // Drop → stop() → join
        running
    };
    assert!(!running.load(Ordering::SeqCst));
}

#[test]
fn test_recall_cue_never_exposes_placeholder() {
    // Régression : entre mem::replace et swap_position_fn, un frame live
    // évaluait le placeholder zeros → tous les tracks sautaient à l'origine.
    let rt = test_runtime();
    rt.swap_position_fn(Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)));
    rt.recall_cue(Arc::new(|_, _| nalgebra::Vector3::new(3.0, 0.0, 0.0)), 0.3);

    // Juste après le recall : le crossfade est installé — jamais zeros.
    // blend ≈ 0 → proche de la fn source (x=1), borné par [1, 3].
    for _ in 0..10 {
        let guard = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        let p = guard(0.0, 0);
        drop(guard);
        assert!(p.x > 0.0, "placeholder zeros visible pendant le crossfade");
        assert!((1.0..=3.0).contains(&p.x));
        std::thread::sleep(Duration::from_millis(5));
    }

    // Après le fade, la fn cible est pure
    std::thread::sleep(Duration::from_millis(350));
    let guard = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
    let p = guard(0.0, 0);
    assert!((p.x - 3.0).abs() < 1e-10);
}

#[test]
fn test_swap_compiled_with_fade_blends_then_lands() {
    // Crossfade graphe : pendant le fade la sortie interpole l'ancienne fn
    // vers la nouvelle ; après, c'est la nouvelle pure — et la nouvelle
    // table de slots est bindée (modulation live).
    let rt = test_runtime();
    rt.swap_position_fn(Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)));

    // Nouvelle table : slot "n1:x" — la fn cible lit base(1) + delta.
    let mut graph = crate::graph::Graph::new();
    let mut params = serde_json::json!({"x": 3.0, "y": 0.0, "z": 0.0});
    params["__fe_id"] = serde_json::json!("sc");
    graph.add_node(crate::graph::Node::with_params(
        crate::graph::NodeType::Scale,
        params,
    ));
    let slots = crate::param_slots::ParamSlots::build(&graph);
    let idx = slots.slot_of("sc", "x").unwrap();
    slots.apply_frame(&[(idx, 2.0)]);
    let slots2 = slots.clone();
    let new_fn: Arc<dyn Fn(f64, usize) -> nalgebra::Vector3<f64> + Send + Sync> =
        Arc::new(move |_, _| nalgebra::Vector3::new(3.0 + slots2.delta(idx), 0.0, 0.0));

    rt.swap_compiled_with_fade(
        new_fn.clone(),
        new_fn.clone(),
        crate::signal_compiler::empty_signal_fn(),
        slots.clone(),
        0.3,
    );

    // Pendant le fade : blend entre x=1 et x=5 (3 + delta 2) — jamais
    // hors de l'intervalle, jamais de placeholder.
    for _ in 0..10 {
        let guard = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        let p = guard(0.0, 0);
        drop(guard);
        assert!(
            (1.0..=5.0).contains(&p.x),
            "pendant le fade x doit rester dans [1,5], got {}",
            p.x
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(Duration::from_millis(350));
    let guard = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
    let p = guard(0.0, 0);
    drop(guard);
    assert!(
        (p.x - 5.0).abs() < 1e-10,
        "après fade → nouvelle fn + slot live (3+2), got {}",
        p.x
    );
}

#[test]
fn test_recall_cue_instant() {
    let rt = test_runtime();
    rt.swap_position_fn(Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)));
    rt.recall_cue(Arc::new(|_, _| nalgebra::Vector3::new(5.0, 0.0, 0.0)), 0.0);
    let guard = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
    assert!((guard(0.0, 0).x - 5.0).abs() < 1e-10);
}

#[test]
fn test_negative_speed_clamps_t_to_zero() {
    // Régression : speed < 0 envoyait un t négatif aux engines (sims figées,
    // sinusoïdes à rebours). Le runtime clamp t_eff >= 0.
    let rt = test_runtime();
    rt.set_position_buffer(Arc::new(PositionBuffer::new())); // mode worker
    rt.macros().set_speed(-2.0);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    rt.play_compiled(
        Arc::new(move |t, _| {
            seen2.lock().unwrap().push(t);
            nalgebra::Vector3::zeros()
        }),
        test_params(4.0),
        vec![1],
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(80));
    rt.stop();
    let ts = seen.lock().unwrap();
    assert!(!ts.is_empty());
    assert!(
        ts.iter().all(|&t| t >= 0.0),
        "t négatif a atteint l'engine: {ts:?}"
    );
}

#[test]
fn test_pace_frame_clock_reanchors_after_stall() {
    // Stall de ~1s à 60fps = ~50 frames de retard (> MAX_CATCHUP_FRAMES=30)
    // → le frame clock se ré-ancre au lieu de bourster.
    let frame_duration = Duration::from_secs_f64(1.0 / 60.0);
    let mut frame_count = 10u64;
    let start = Instant::now() - Duration::from_secs(1);
    pace_frame_clock(&mut frame_count, frame_duration, start);
    assert!(
        frame_count > 10 + MAX_CATCHUP_FRAMES,
        "frame_count doit être avancé après un stall, got {frame_count}"
    );
}

#[test]
fn test_pace_frame_clock_below_threshold_no_burst() {
    // 20 frames de retard (< 30) → pas de ré-ancrage, rattrapage normal.
    let frame_duration = Duration::from_secs_f64(1.0 / 60.0);
    let mut frame_count = 0u64;
    let start = Instant::now() - frame_duration * 20;
    pace_frame_clock(&mut frame_count, frame_duration, start);
    assert_eq!(frame_count, 0);
}

#[test]
fn test_worker_applies_move_transform() {
    // Régression : en mode worker, le buffer doit recevoir des positions
    // WORLD-SPACE — le transform per-move (scale, rotation, shift, origin,
    // radius_scale, height_offset, fade) est appliqué avant l'écriture.
    // Sinon l'origin et les macros spatiales des moves/animations sont
    // silencieusement ignorées (dead writes sur des champs lus uniquement
    // par la branche legacy).
    let rt = test_runtime();
    let buffer = Arc::new(PositionBuffer::new());
    rt.set_position_buffer(buffer.clone());
    rt.set_origin(nalgebra::Vector3::new(10.0, 0.0, 0.0));
    rt.macros().set_scale(2.0);
    rt.macros().set_shift(0.0, 1.0, 0.0);
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)),
        test_params(60.0),
        vec![1],
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(80));
    rt.stop();
    let positions = buffer.read();
    assert_eq!(positions.len(), 1);
    let p = positions[0].1;
    // (1,0,0) * scale=2 → (2,0,0), + origin(10,0,0) + shift(0,1,0) → (12,1,0)
    assert!((p.x - 12.0).abs() < 1e-9, "x={}", p.x);
    assert!((p.y - 1.0).abs() < 1e-9, "y={}", p.y);
    assert!(p.z.abs() < 1e-9, "z={}", p.z);
}

#[test]
fn test_worker_applies_signal_deltas() {
    // Signal graph per-move : `SignalConst → SignalOut(scale, amount=1)` →
    // delta +1 → scale effective = base(1)+1 = 2 → (1,0,0) sort en (2,0,0).
    // Les deltas passent par audio_param_overrides — additive à la base.
    let rt = test_runtime();
    let buffer = Arc::new(PositionBuffer::new());
    rt.set_position_buffer(buffer.clone());

    let mut g = crate::graph::Graph::new();
    let c =
        crate::graph::Node::with_params(crate::graph::NodeType::SignalConst, json!({"value": 1.0}));
    let out = crate::graph::Node::with_params(
        crate::graph::NodeType::SignalOut,
        json!({"target": "scale", "amount": 1.0}),
    );
    g.add_node(c.clone());
    g.add_node(out.clone());
    g.add_edge(crate::graph::Edge {
        from: c.id,
        to: out.id,
        from_port: "out".to_string(),
        to_port: "signal".to_string(),
    });
    let signal_fn = crate::signal_compiler::compile_signal_graph(&g).expect("compiles");
    rt.swap_signal_fn(signal_fn, crate::param_slots::ParamSlots::empty());

    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)),
        test_params(60.0),
        vec![1],
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(80));
    rt.stop();

    let positions = buffer.read();
    let p = positions[0].1;
    assert!(
        (p.x - 2.0).abs() < 1e-9,
        "delta scale +1 → x doublé, got {}",
        p.x
    );
    // La macro de base n'est jamais mutée — delta additif seulement.
    assert!((rt.macros().get_scale() - 1.0).abs() < 1e-9);
}

#[test]
fn test_signal_deltas_compose_with_audio_mods() {
    // Additivité : un delta signal `shift_x +5` + macro base doivent se
    // composer — le signal n'écrase rien (même couture que les audio mods).
    let rt = test_runtime();
    let buffer = Arc::new(PositionBuffer::new());
    rt.set_position_buffer(buffer.clone());
    rt.macros().set_shift(10.0, 0.0, 0.0); // base panel/OSC : +10

    let mut g = crate::graph::Graph::new();
    let c =
        crate::graph::Node::with_params(crate::graph::NodeType::SignalConst, json!({"value": 5.0}));
    let out = crate::graph::Node::with_params(
        crate::graph::NodeType::SignalOut,
        json!({"target": "shift_x", "amount": 1.0}),
    );
    g.add_node(c.clone());
    g.add_node(out.clone());
    g.add_edge(crate::graph::Edge {
        from: c.id,
        to: out.id,
        from_port: "out".to_string(),
        to_port: "signal".to_string(),
    });
    rt.swap_signal_fn(
        crate::signal_compiler::compile_signal_graph(&g).unwrap(),
        crate::param_slots::ParamSlots::empty(),
    );

    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(60.0),
        vec![1],
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(80));
    rt.stop();

    let p = buffer.read()[0].1;
    assert!(
        (p.x - 15.0).abs() < 1e-9,
        "base shift_x=10 + delta signal=5 → x=15, got {}",
        p.x
    );
    assert!((rt.macros().get_shift().x - 10.0).abs() < 1e-9);
}

#[test]
fn test_worker_fade_collapses_toward_origin() {
    // Le fade du move (config.set_fade) doit replier la trajectoire vers
    // l'origin du move pendant le fade_in — pas vers (0,0,0) ni rester
    // inerte. Avec fade_in=0.2s et une fn constante à (1,0,0), les premières
    // frames doivent être proches de l'origin (5,0,0), puis converger vers
    // (6,0,0) une fois le fade terminé.
    let rt = test_runtime();
    let buffer = Arc::new(PositionBuffer::new());
    rt.set_position_buffer(buffer.clone());
    rt.set_origin(nalgebra::Vector3::new(5.0, 0.0, 0.0));
    rt.set_fade(0.2, 0.0);
    rt.play_compiled(
        Arc::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)),
        test_params(60.0),
        vec![1],
    )
    .unwrap();
    // Pendant le fade_in : position intermédiaire entre l'ancre (5,0,0) et
    // la cible (6,0,0) — le fade collapse la trajectoire vers l'origin.
    std::thread::sleep(Duration::from_millis(60));
    let p_mid = buffer.read()[0].1;
    assert!(
        p_mid.x > 5.0 && p_mid.x < 6.0,
        "fade_in doit donner une position intermédiaire, x={}",
        p_mid.x
    );
    // Après le fade : position finale (1,0,0)+(5,0,0) = (6,0,0)
    std::thread::sleep(Duration::from_millis(250));
    let p_end = buffer.read()[0].1;
    assert!((p_end.x - 6.0).abs() < 1e-9, "x={}", p_end.x);
    rt.stop();
}
