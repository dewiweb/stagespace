use super::*;
use crate::osc_sender::{OscProfile, OscSender};

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
