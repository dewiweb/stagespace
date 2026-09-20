use super::error::IpcError;
use super::state::lock_or_recover;
use crate::commands::merge_commands::{
    resolve_track_indices, spawn_move, MoveSpec, SpatialMacroInit,
};
use crate::commands::state::Shared;
use crate::AppState;
use stagespace_engines::{
    Animation, AnimationLoopMode, AnimationState, Direction, LoopMode, PlayDirection,
};
use tauri::State;

// ═══════════════════════════════════════════════════════════════
// ANIMATION SYSTEM — le modèle vivant (game changer)
// ═══════════════════════════════════════════════════════════════

/// Lance une animation via `spawn_move` — le chemin unique de création de
/// worker. L'OSC sort exclusivement par le MergeRuntime (une seule stream,
/// métriques/fades/zones/global post-processing couverts).
///
/// `osc_address`/`osc_port`/`osc_profile` sont acceptés pour compat IPC mais
/// ignorés : la cible OSC appartient au MergeRuntime (config lock pendant le
/// playback).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn launch_animation(
    animation: Animation,
    osc_ids: Vec<u32>,
    origin: Option<[f64; 3]>,
    is_preview: bool,
    osc_address: String,
    osc_port: u16,
    osc_profile: String,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let _ = (osc_address, osc_port, osc_profile); // merge-owned OSC target
    let movement_id = format!("anim-{}", animation.id);

    // track_indices = position de chaque osc_id dans la liste globale du
    // merge (les ids absents y sont ajoutés).
    let track_indices = resolve_track_indices(&state.merge_runtime, &osc_ids);

    let loop_mode = match animation.loop_mode {
        AnimationLoopMode::Loop => LoopMode::Loop,
        AnimationLoopMode::OneShot => LoopMode::OneShot,
    };
    let direction = match animation.direction {
        Direction::Forward => PlayDirection::Forward,
        Direction::Backward => PlayDirection::Backward,
        Direction::PingPong => PlayDirection::PingPong,
    };

    let spec = MoveSpec {
        id: movement_id.clone(),
        name: animation.name.clone(),
        graph_json: animation.graph_json.clone(),
        osc_ids: osc_ids.clone(),
        track_indices,
        is_preview,
        origin,
        duration: animation.duration,
        loop_mode,
        direction,
        fade: Some((animation.fade_in, animation.fade_out)),
        speed: Some(animation.speed),
        spatial_macros: Some(SpatialMacroInit {
            scale: animation.scale,
            shift: (animation.offset_x, animation.offset_y, animation.offset_z),
            rotation: (animation.yaw, animation.pitch, animation.roll),
        }),
        animation_state: Some(AnimationState::from_animation(&animation, &osc_ids)),
    };

    let sh = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || spawn_move(spec, &sh))
        .await
        .map_err(|e| IpcError::internal(format!("Task join error: {e}")))?
        .map_err(IpcError::from)?;

    Ok(movement_id)
}

/// Met à jour l'animation state d'un movement en cours (depth, phase_offset, audio mods)
#[tauri::command]
pub async fn update_animation_state(
    movement_id: String,
    animation: Animation,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements
        .get(&movement_id)
        .ok_or_else(|| IpcError::not_found(format!("Movement {movement_id} not found")))?;
    let osc_ids = movement.osc_ids.clone();
    let anim_state = AnimationState::from_animation(&animation, &osc_ids);
    movement.runtime.set_animation_state(anim_state);
    // Mettre à jour les macros aussi
    movement.runtime.macros().set_speed(animation.speed);
    movement.runtime.macros().set_scale(animation.scale);
    movement
        .runtime
        .macros()
        .set_shift(animation.offset_x, animation.offset_y, animation.offset_z);
    movement
        .runtime
        .macros()
        .set_rotation(animation.yaw, animation.pitch, animation.roll);
    // Mettre à jour loop_mode et direction en live
    let loop_mode_val = match animation.loop_mode {
        AnimationLoopMode::Loop => LoopMode::Loop,
        AnimationLoopMode::OneShot => LoopMode::OneShot,
    };
    movement.runtime.set_loop_mode(loop_mode_val);
    let dir_val = match animation.direction {
        Direction::Forward => PlayDirection::Forward,
        Direction::Backward => PlayDirection::Backward,
        Direction::PingPong => PlayDirection::PingPong,
    };
    movement.runtime.set_direction(dir_val);
    movement
        .runtime
        .set_fade(animation.fade_in, animation.fade_out);
    Ok(())
}
