use stagespace_engines::{Runtime, EngineParams, OscSender, OscProfile, LoopMode};
use serde::Serialize;
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

#[tauri::command]
pub async fn store_cue(
    cue_id: String,
    graph_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let compiled = compile_graph_inner(&graph)?;

    let mut cues = lock_or_recover(&state.compiled_cues);
    cues.insert(cue_id.clone(), compiled);
    Ok(format!("Cue '{}' stored and pre-compiled", cue_id))
}

#[tauri::command]
pub async fn recall_cue(
    cue_id: String,
    fade_duration: f64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Re-compiler le cue depuis le cuelist (rapide, < 1ms)
    // Le pre-compile via store_cue valide le graphe à l'avance
    let cuelist = lock_or_recover(&state.cuelist);
    let cue = cuelist.get_by_id(&cue_id)
        .ok_or_else(|| format!("Cue '{}' not found in cuelist. Add it first with cuelist_add.", cue_id))?;
    let graph_json = cue.graph.clone();
    drop(cuelist);

    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&graph_json, &audio_state)?;
    drop(audio_state);

    let compiled = compile_graph_inner(&graph)?;

    let state_guard = lock_or_recover(&state.runtime);
    if let Some(runtime) = &*state_guard {
        runtime.recall_cue(compiled, fade_duration);
        Ok(format!("Cue '{}' recalled with {:.1}s fade", cue_id, fade_duration))
    } else {
        Err("No active runtime. Start playback first with play_graph.".to_string())
    }
}

// ── Setlist & GO workflow ──────────────────────────────────────────────────

/// Définit l'ordre des cues pour la setlist
#[tauri::command]
pub async fn set_setlist(
    cue_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut setlist = lock_or_recover(&state.setlist);
    *setlist = cue_ids;
    // Reset current index si hors bounds
    let mut current = lock_or_recover(&state.current_cue_index);
    if *current >= setlist.len() as i32 {
        *current = if setlist.is_empty() { -1 } else { 0 };
    }
    Ok(())
}

/// Retourne la setlist et l'index courant
#[derive(Serialize)]
pub struct SetlistState {
    pub cue_ids: Vec<String>,
    pub current_index: i32,
}

#[tauri::command]
pub async fn get_setlist(state: State<'_, AppState>) -> Result<SetlistState, String> {
    let setlist = lock_or_recover(&state.setlist);
    let current = lock_or_recover(&state.current_cue_index);
    Ok(SetlistState {
        cue_ids: setlist.clone(),
        current_index: *current,
    })
}

/// GO : avance au cue suivant dans la setlist avec crossfade
/// 1. Stop les movements actuels avec fade
/// 2. Recall le cue suivant (compile + lance nouveau movement)
/// 3. Applique les macros du cue
#[tauri::command]
pub async fn go_to_next_cue(
    osc_address: String,
    osc_port: u16,
    osc_profile: String,
    osc_ids: Vec<u32>,
    origin: Option<[f64; 3]>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let setlist = lock_or_recover(&state.setlist);
    let mut current = lock_or_recover(&state.current_cue_index);

    if setlist.is_empty() {
        return Err("Setlist is empty — add cues first".to_string());
    }

    let next_index = (*current + 1) as usize;
    if next_index >= setlist.len() {
        return Err("Already at last cue".to_string());
    }

    let cue_id = setlist[next_index].clone();
    let total = setlist.len();
    drop(setlist);

    // Récupérer le cue
    let cuelist = lock_or_recover(&state.cuelist);
    let cue = cuelist.get_by_id(&cue_id)
        .ok_or_else(|| format!("Cue '{}' not found in cuelist", cue_id))?
        .clone();
    drop(cuelist);

    // 1. Stop les movements actuels — drain + join en dehors du lock
    {
        let drained: Vec<Movement> = {
            let mut movements = lock_or_recover(&state.movements);
            movements.drain().map(|(_, m)| m).collect()
        };
        for movement in drained {
            movement.runtime.stop();
            if let Some(handle) = movement.thread_handle {
                let _ = handle.join();
            }
        }
    }

    // 2. Compiler le graphe du cue
    let audio_state = lock_or_recover(&state.audio_state);
    let graph = build_graph_from_json(&cue.graph, &audio_state)?;
    drop(audio_state);
    let compiled = compile_graph_inner(&graph)?;

    // 3. Créer le runtime + lancer le movement
    let osc_profile_enum = OscProfile::from_str(&osc_profile)
        .map_err(|e| format!("Invalid OSC profile: {}", e))?;
    let osc_sender = OscSender::new(osc_profile_enum, osc_address.clone(), osc_port);
    let runtime = Runtime::new(osc_address, osc_port, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;
    runtime.set_preview_mode(false);
    runtime.set_loop_mode(LoopMode::Loop);

    // Origin = isobarycentre des tracks ciblées
    if let Some(ref org) = origin {
        runtime.set_origin(nalgebra::Vector3::new(org[0], org[1], org[2]));
    }

    // Callback position
    let app_handle = lock_or_recover(&state.app_handle)
        .as_ref().ok_or("App handle not available")?.clone();
    let movement_id = format!("cue-{}", cue_id);
    let movement_id_for_cb = movement_id.clone();
    let osc_ids_cb = osc_ids.clone();
    runtime.set_position_callback(Box::new(move |t: f64, positions: Vec<(usize, nalgebra::Vector3<f64>)>| {
        let positions_data: Vec<(usize, [f64; 3])> = positions
            .into_iter().map(|(idx, pos)| (idx, [pos.x, pos.y, pos.z])).collect();
        let _ = app_handle.emit(
            &format!("movement-positions-{}", movement_id_for_cb),
            serde_json::json!({ "time": t, "positions": positions_data, "osc_ids": osc_ids_cb }),
        );
    }));

    let handle = runtime.play_compiled(
        compiled,
        EngineParams { n_objects: osc_ids.len(), duration: 4.0, fps: 60.0, extra: serde_json::json!({}) },
        osc_ids.clone(),
    ).map_err(|e| format!("Playback failed: {}", e))?;

    // 4. Appliquer les macros du cue
    if let Some(ref macros) = cue.macros {
        let m = runtime.macros();
        m.set_speed(macros.speed);
        m.set_scale(macros.scale);
        m.set_shift(macros.shift_x, macros.shift_y, macros.shift_z);
        m.set_rotation(macros.yaw, macros.pitch, macros.roll);
    }

    // 5. Stocker le movement
    let movement = Movement {
        id: movement_id.clone(),
        name: cue.name.clone(),
        runtime,
        osc_ids,
        is_preview: false,
        track_indices: cue.track_indices.clone(),
        thread_handle: Some(handle),
    };
    let mut movements = lock_or_recover(&state.movements);
    movements.insert(movement_id, movement);

    // 6. Avancer le pointeur
    *current = next_index as i32;

    Ok(format!("GO: cue '{}' recalled ({}/{})", cue.name, next_index + 1, total))
}
