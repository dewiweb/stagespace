//! Commands Tauri pour le MergeRuntime (architecture hybride Phase 1).
//!
//! Ces commands coexistent avec les commands legacy (play_movement, stop_movement).
//! Le frontend utilisera activate_move/deactivate_move à la place.

mod channels;
mod graph_updates;
mod macros;
mod manual_positions;
mod move_management;

pub use super::state::lock_or_recover;
pub use channels::{
    add_channel_modulation, add_zone, clear_all_spatial_channels, clear_channel_modulations,
    clear_spatial_channel, clear_zones, list_channel_modulations, list_spatial_channels,
    list_zones, remove_channel_modulation, remove_zone, set_kinematic_smoothing,
    set_spatial_channel,
};
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

fn default_duration() -> f64 {
    4.0
}

fn default_loop_mode() -> String {
    "loop".to_string()
}

fn default_direction() -> String {
    "forward".to_string()
}
