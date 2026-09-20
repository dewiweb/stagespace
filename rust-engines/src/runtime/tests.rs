use super::*;
use crate::engines::EngineParams;
use crate::osc_sender::{OscProfile, OscSender};
use crate::position_buffer::PositionBuffer;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[test]
fn test_runtime_creation() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = Runtime::new("127.0.0.1".to_string(), 7000, sender).unwrap();
    assert!(!rt.is_running());
}

#[test]
fn test_loop_mode() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = Runtime::new("127.0.0.1".to_string(), 7000, sender).unwrap();
    rt.set_loop_mode(LoopMode::OneShot);
    assert_eq!(rt.config.get_loop_mode(), LoopMode::OneShot);
    rt.set_loop_mode(LoopMode::Loop);
    assert_eq!(rt.config.get_loop_mode(), LoopMode::Loop);
}

#[test]
fn test_hot_swap_position_fn() {
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    let rt = Runtime::new("127.0.0.1".to_string(), 7000, sender).unwrap();
    rt.swap_position_fn(Box::new(|t, i| nalgebra::Vector3::new(t, i as f64, 0.0)));
    let fn_ref = rt.position_fn.lock().unwrap_or_else(|e| e.into_inner());
    let pos = fn_ref(1.5, 3);
    assert!((pos.x - 1.5).abs() < 1e-10);
    assert!((pos.y - 3.0).abs() < 1e-10);
}

#[test]
fn test_runtime_play_compiled() {
    let osc_sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7788);
    let runtime = Runtime::new("127.0.0.1".to_string(), 7788, osc_sender).unwrap();

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

    let position_fn = Box::new(move |t: f64, _obj_idx: usize| {
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
    let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
    Runtime::new("127.0.0.1".to_string(), 7000, sender).unwrap()
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
        Box::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(10.0),
        vec![1],
    )
    .unwrap();
    let again = rt.play_compiled(
        Box::new(|_, _| nalgebra::Vector3::zeros()),
        test_params(10.0),
        vec![1],
    );
    assert!(again.is_err(), "second play_compiled doit être rejeté");
    rt.stop();
    // Après stop, un nouveau play est accepté
    rt.play_compiled(
        Box::new(|_, _| nalgebra::Vector3::zeros()),
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
        Box::new(|_, _| nalgebra::Vector3::zeros()),
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
            Box::new(|_, _| nalgebra::Vector3::zeros()),
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
    rt.swap_position_fn(Box::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)));
    rt.recall_cue(Box::new(|_, _| nalgebra::Vector3::new(3.0, 0.0, 0.0)), 0.3);

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
fn test_recall_cue_instant() {
    let rt = test_runtime();
    rt.swap_position_fn(Box::new(|_, _| nalgebra::Vector3::new(1.0, 0.0, 0.0)));
    rt.recall_cue(Box::new(|_, _| nalgebra::Vector3::new(5.0, 0.0, 0.0)), 0.0);
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
        Box::new(move |t, _| {
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
fn test_throttled_error_log_aggregates() {
    let mut log = ThrottledErrorLog::new();
    // Fenêtre <1s → rien n'est émis
    assert!(log.record(false).is_none());
    assert!(log.record(true).is_none());
    // Fenêtre écoulée → flush agrégé (erreurs + refused)
    log.window_start = Instant::now() - Duration::from_secs(2);
    let (errors, refused) = log.record(true).unwrap();
    assert_eq!(errors, 3);
    assert_eq!(refused, 2);
    // Compteurs réinitialisés
    assert!(log.record(false).is_none());
}
