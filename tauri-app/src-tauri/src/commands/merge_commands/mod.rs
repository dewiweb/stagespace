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
    clear_spatial_channel, clear_zones, get_profile_channels, list_channel_modulations,
    list_graph_effects, list_spatial_channels, list_zones, remove_channel_modulation, remove_zone,
    set_kinematic_smoothing, set_spatial_channel, update_zone,
};
pub use graph_updates::{
    diagnose_graph, diagnose_graph_inner, update_global_graph, update_move_graph_merged,
    update_signal_graph,
};
pub use macros::{
    set_global_macro, set_global_origin, set_global_osc_ids, set_merge_strategy,
    set_move_playback_mode, set_move_priority, set_move_speed, set_move_weight, set_track_depths,
};
pub use manual_positions::{
    clear_all_manual_positions, clear_manual_position, get_track_positions, set_manual_position,
    set_track_position, set_track_positions, throw_object,
};
#[cfg(test)]
pub(crate) use move_management::collect_movement_infos;
pub use move_management::{
    activate_move, deactivate_all_moves, deactivate_move, get_merge_perf_stats, list_active_moves,
};
// API "MoveService" — utilisée par les commands Tauri ET le CLI bin
// (stagespace-cli) : un seul chemin de spawn/stop pour les deux surfaces.
pub use move_management::{
    parse_direction, parse_loop_mode, remove_move_now, resolve_track_indices, spawn_move,
    spawn_move_for_recall, MoveSpec, SpatialMacroInit,
};

/// Validation frontière : un f64 NaN/inf arrivé par IPC ne doit jamais
/// atteindre le merge thread (`f64::clamp` panique sur NaN → un param
/// pourri tuerait le thread entier, catch_unwind ou pas). Rejet propre.
fn require_finite(name: &str, v: f64) -> Result<f64, super::error::IpcError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(super::error::IpcError::validation(format!(
            "{name} must be finite (got {v})"
        )))
    }
}

fn require_finite_vec3(name: &str, v: [f64; 3]) -> Result<[f64; 3], super::error::IpcError> {
    for (i, c) in v.iter().enumerate() {
        require_finite(&format!("{name}[{i}]"), *c)?;
    }
    Ok(v)
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
