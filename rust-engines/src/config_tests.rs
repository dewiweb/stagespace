use crate::config::Config;
use std::path::PathBuf;

#[test]
fn test_default_config() {
    let config = Config::default();
    assert_eq!(config.runtime.default_fps, 60.0);
    assert_eq!(config.runtime.default_duration, 4.0);
    assert_eq!(config.runtime.max_objects, 1024);
    assert_eq!(config.osc.default_address, "127.0.0.1");
    assert_eq!(config.osc.default_port, 9000);
    assert_eq!(config.osc.default_profile, "generic");
    assert_eq!(config.audio.default_source, "microphone");
    assert_eq!(config.audio.sample_rate, 44100);
    assert_eq!(config.audio.fft_size, 1024);
    assert_eq!(config.graph.max_nodes, 1000);
    assert_eq!(config.graph.max_edges, 5000);
    assert!(config.graph.auto_validate);
}

#[test]
fn test_config_serialization() {
    let config = Config::default();
    let json = serde_json::to_string(&config).unwrap();
    let deserialized: Config = serde_json::from_str(&json).unwrap();
    assert_eq!(config.runtime.default_fps, deserialized.runtime.default_fps);
}

#[test]
fn test_config_save_load() {
    let config = Config::default();
    let path = PathBuf::from("/tmp/test_config.json");
    config.save_to_file(&path).unwrap();
    let loaded = Config::load_from_file(&path).unwrap();
    assert_eq!(config.runtime.default_fps, loaded.runtime.default_fps);
    std::fs::remove_file(&path).ok();
}
