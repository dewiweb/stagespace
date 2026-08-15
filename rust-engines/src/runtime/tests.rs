use super::*;
use crate::engines::EngineParams;
use crate::osc_sender::{OscProfile, OscSender};
use serde_json::json;
use std::time::Duration;

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
