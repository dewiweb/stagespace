use crate::audio::{AudioReactor, AudioBinding, AudioSource, AudioFrame};

#[test]
fn test_audio_reactor_new() {
    let reactor = AudioReactor::new();
    assert!(reactor.bindings.is_empty());
    assert!(reactor.current_frame.is_none());
}

#[test]
fn test_add_binding() {
    let mut reactor = AudioReactor::new();
    let binding = AudioBinding {
        source: AudioSource::Microphone,
        macro_name: "speed".to_string(),
        min_val: 0.5,
        max_val: 2.0,
        smooth: 0.7,
    };
    reactor.add_binding(binding);
    assert_eq!(reactor.bindings.len(), 1);
}

#[test]
fn test_remove_binding() {
    let mut reactor = AudioReactor::new();
    let binding = AudioBinding {
        source: AudioSource::Microphone,
        macro_name: "speed".to_string(),
        min_val: 0.5,
        max_val: 2.0,
        smooth: 0.7,
    };
    reactor.add_binding(binding.clone());
    reactor.remove_binding(&binding.source, &binding.macro_name);
    assert_eq!(reactor.bindings.len(), 0);
}

#[test]
fn test_update_frame() {
    let mut reactor = AudioReactor::new();
    let frame = AudioFrame {
        rms: 0.5,
        bass: 0.3,
        mid: 0.4,
        high: 0.2,
        spectrum: vec![0.1, 0.2, 0.3],
    };
    reactor.update(frame);
    assert!(reactor.current_frame.is_some());
}

#[test]
fn test_get_binding_value() {
    let mut reactor = AudioReactor::new();
    let binding = AudioBinding {
        source: AudioSource::Microphone,
        macro_name: "speed".to_string(),
        min_val: 0.0,
        max_val: 1.0,
        smooth: 0.7,
    };
    reactor.add_binding(binding);
    
    let frame = AudioFrame {
        rms: 0.5,
        bass: 0.3,
        mid: 0.4,
        high: 0.2,
        spectrum: vec![0.1, 0.2, 0.3],
    };
    reactor.update(frame);
    
    let value = reactor.get_binding_value("speed");
    assert!(value.is_some());
    assert!((value.unwrap() - 0.5).abs() < 0.01);
}

#[test]
fn test_clear_bindings() {
    let mut reactor = AudioReactor::new();
    let binding = AudioBinding {
        source: AudioSource::Microphone,
        macro_name: "speed".to_string(),
        min_val: 0.5,
        max_val: 2.0,
        smooth: 0.7,
    };
    reactor.add_binding(binding);
    reactor.clear_bindings();
    assert_eq!(reactor.bindings.len(), 0);
}
