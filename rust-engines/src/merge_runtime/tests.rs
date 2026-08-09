use crate::merge_runtime::helpers::merge_positions;
use crate::merge_runtime::move_state::{MergeStrategy, MoveState};
use crate::merge_runtime::MergeRuntime;
use crate::osc_sender::{OscProfile, OscSender};
use crate::position_buffer::PositionBuffer;
use std::sync::Arc;

#[test]
fn test_merge_override() {
    let move_a = (
        "a".to_string(),
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
        0,
        vec![
            (0, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
        ],
    );
    let osc_ids = vec![1, 2];
    let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Override);
    // Override : fade le plus élevé gagne → move_a (fade 1.0)
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
    assert!((merged[1].1.x - 2.0).abs() < 1e-10);
}

#[test]
fn test_merge_crossfade() {
    let move_a = (
        "a".to_string(),
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(0.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(10.0, 0.0, 0.0))],
    );
    let osc_ids = vec![1];
    let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Crossfade);
    // Crossfade : moyenne pondérée → (0 + 10) / 2 = 5
    assert!((merged[0].1.x - 5.0).abs() < 1e-10);
}

#[test]
fn test_merge_single_move() {
    let move_a = (
        "a".to_string(),
        1.0,
        0,
        vec![(0, nalgebra::Vector3::new(1.0, 2.0, 3.0))],
    );
    let osc_ids = vec![1];
    let merged = merge_positions(&[move_a], &osc_ids, MergeStrategy::Override);
    assert_eq!(merged.len(), 1);
    assert!((merged[0].1.x - 1.0).abs() < 1e-10);
}

#[test]
fn test_merge_empty() {
    let osc_ids = vec![1, 2];
    let merged = merge_positions(&[], &osc_ids, MergeStrategy::Override);
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
        0,
        vec![
            (3, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (4, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
            (5, nalgebra::Vector3::new(30.0, 0.0, 0.0)),
        ],
    );
    let osc_ids = vec![1, 2, 3, 4, 5, 6];
    let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Override);
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
        1,
        vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        0.1,
        5,
        vec![(0, nalgebra::Vector3::new(99.0, 0.0, 0.0))],
    );
    let osc_ids = vec![1];
    let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Priority);
    // Priority : B (priority 5) gagne sur A (priority 1) même si fade de B est plus faible
    assert!((merged[0].1.x - 99.0).abs() < 1e-10);
}

#[test]
fn test_merge_priority_tiebreak_by_fade() {
    // Deux moves même priorité : le fade le plus élevé gagne
    let move_a = (
        "a".to_string(),
        1.0,
        5,
        vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))],
    );
    let move_b = (
        "b".to_string(),
        0.5,
        5,
        vec![(0, nalgebra::Vector3::new(99.0, 0.0, 0.0))],
    );
    let osc_ids = vec![1];
    let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Priority);
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
