//! Commands Tauri pour le MergeRuntime (architecture hybride Phase 1).
//!
//! Ces commands coexistent avec les commands legacy (play_movement, stop_movement).
//! Le frontend utilisera activate_move/deactivate_move à la place.

mod graph_updates;
mod macros;
mod manual_positions;
mod move_management;

use std::sync::{Mutex, MutexGuard};

pub use graph_updates::{update_global_graph, update_move_graph_merged};
pub use macros::{
    set_global_macro, set_global_origin, set_global_osc_ids, set_merge_strategy,
    set_move_playback_mode, set_move_speed, set_track_depths,
};
pub use manual_positions::{
    clear_all_manual_positions, clear_manual_position, set_manual_position, set_track_positions,
};
pub use move_management::{
    activate_move, deactivate_all_moves, deactivate_move, get_merge_perf_stats, list_active_moves,
};

/// Helper : lock un mutex en récupérant du poison si nécessaire
pub(crate) fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {e}");
        e.into_inner()
    })
}

fn default_duration() -> f64 {
    4.0
}

fn default_loop_mode() -> String {
    "loop".to_string()
}

fn default_direction() -> String {
    "forward".to_string()
}
