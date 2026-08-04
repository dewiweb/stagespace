use stagespace_engines::{Runtime, EngineParams, OscSender, OscProfile,
    LoopMode, PlayDirection, Animation, AnimationState,
    AnimationLoopMode, Direction};
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};
use tauri::{State, Emitter};
use crate::AppState;
use crate::Movement;
use crate::graph::parser::build_graph_from_json;
use crate::graph::compilation::compile_graph as compile_graph_inner;

/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION SYSTEM — le modèle vivant (game changer)
// ═══════════════════════════════════════════════════════════════

/// Lance une animation — compile le graphe, crée un runtime, set l'animation state
/// C'est la commande principale du nouveau système
#[tauri::command]
pub async fn launch_animation(
    animation: Animation,
    osc_ids: Vec<u32>,
    origin: Option<[f64; 3]>,
    is_preview: bool,
    osc_address: String,
    osc_port: u16,
    osc_profile: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let movement_id = format!("anim-{}", animation.id);
    let movement_id_for_cb = movement_id.clone();
    let movement_name = animation.name.clone();

    // 1. Récupérer le graphe JSON directement depuis l'animation
    let graph_json = animation.graph_json.clone();

    // 2. Compiler le graphe
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);
    let compiled = compile_graph_inner(&graph)?;

    // 3. Créer le runtime
    let osc_profile_enum = OscProfile::from_str(&osc_profile)
        .map_err(|e| format!("Invalid OSC profile: {}", e))?;
    let osc_sender = OscSender::new(osc_profile_enum, osc_address.clone(), osc_port);
    let runtime = Runtime::new(osc_address, osc_port, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    // Mode preview
    runtime.set_preview_mode(is_preview);
    let loop_mode_val = match animation.loop_mode {
        AnimationLoopMode::Loop => LoopMode::Loop,
        AnimationLoopMode::OneShot => LoopMode::OneShot,
    };
    runtime.set_loop_mode(loop_mode_val);
    let dir_val = match animation.direction {
        Direction::Forward => PlayDirection::Forward,
        Direction::Backward => PlayDirection::Backward,
        Direction::PingPong => PlayDirection::PingPong,
    };
    runtime.set_direction(dir_val);
    runtime.set_fade(animation.fade_in, animation.fade_out);

    // Origin (isobarycentre)
    if let Some(ref org) = origin {
        runtime.set_origin(nalgebra::Vector3::new(org[0], org[1], org[2]));
    }

    // 4. Set les macros à partir des transform de l'animation
    runtime.macros().set_speed(animation.speed);
    runtime.macros().set_scale(animation.scale);
    runtime.macros().set_shift(animation.offset_x, animation.offset_y, animation.offset_z);
    runtime.macros().set_rotation(animation.yaw, animation.pitch, animation.roll);

    // 5. Set l'animation state (depth + phase_offset + audio mods)
    let anim_state = AnimationState::from_animation(&animation, &osc_ids);
    runtime.set_animation_state(anim_state);

    // 6. Callback position
    let app_handle = lock_or_recover(&state.app_handle)
        .clone().ok_or("App handle not set")?;
    let osc_ids_cb = osc_ids.clone();
    runtime.set_position_callback(Box::new(move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
        let positions_data: Vec<(usize, [f64; 3])> = positions
            .into_iter().map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z])).collect();
        let _ = app_handle.emit(
            &format!("movement-positions-{}", movement_id_for_cb),
            serde_json::json!({ "time": t, "positions": positions_data, "osc_ids": osc_ids_cb }),
        );
    }));

    // 7. Lancer le playback
    let handle = runtime.play_compiled(
        compiled,
        EngineParams { fps: 60.0, duration: animation.duration, n_objects: osc_ids.len(), extra: serde_json::json!({}) },
        osc_ids.clone(),
    ).map_err(|e| format!("Failed to start playback: {:?}", e))?;

    // 8. Stocker le movement
    {
        let mut movements = lock_or_recover(&state.movements);
        movements.insert(movement_id.clone(), Movement {
            id: movement_id.clone(),
            name: movement_name,
            runtime,
            osc_ids,
            is_preview,
            track_indices: vec![],
            thread_handle: Some(handle),
        });
    }

    // Emit movement list update
    let app_handle2 = lock_or_recover(&state.app_handle)
        .clone().ok_or("App handle not set")?;
    let _ = app_handle2.emit("movements-update", ());

    Ok(movement_id)
}

/// Met à jour l'animation state d'un movement en cours (depth, phase_offset, audio mods)
#[tauri::command]
pub async fn update_animation_state(
    movement_id: String,
    animation: Animation,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let movements = lock_or_recover(&state.movements);
    let movement = movements.get(&movement_id)
        .ok_or_else(|| format!("Movement {} not found", movement_id))?;
    let osc_ids = movement.osc_ids.clone();
    let anim_state = AnimationState::from_animation(&animation, &osc_ids);
    movement.runtime.set_animation_state(anim_state);
    // Mettre à jour les macros aussi
    movement.runtime.macros().set_speed(animation.speed);
    movement.runtime.macros().set_scale(animation.scale);
    movement.runtime.macros().set_shift(animation.offset_x, animation.offset_y, animation.offset_z);
    movement.runtime.macros().set_rotation(animation.yaw, animation.pitch, animation.roll);
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
    movement.runtime.set_fade(animation.fade_in, animation.fade_out);
    Ok(())
}


