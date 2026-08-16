//! Commandes CLI : gestion des moves (activate, list, stop, macros, strategy, speed)

use crate::cli_state;
use crate::graph_presets;
use stagespace_engines::{
    EngineParams, LoopMode, MergeStrategy, OscSender, PositionBuffer, Runtime,
};
use stagespace_tauri::graph::compilation::compile_graph_with_audio_and_overrides;
use stagespace_tauri::graph::parser::build_graph_from_json;
use std::sync::Arc;

use super::helpers::{osc_ids_to_indices, parse_args, parse_track_list};

pub fn cmd_activate_move(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: activate-move <template> [--tracks 1,2,3] [--duration 4] [--preview] [--name name]".to_string());
    }

    let template = args[0];
    let opts = parse_args(&args[1..]);

    let state = cli_state::state();
    let all_osc_ids = state.get_osc_ids();
    let n_objects = state.track_count();

    let track_str = opts.get("tracks").map(|s| s.as_str()).unwrap_or("all");
    let osc_ids = parse_track_list(track_str, &all_osc_ids)?;
    if osc_ids.is_empty() {
        return Err("No tracks selected. Use --tracks 1,2,3 or --tracks all".to_string());
    }

    let track_indices = osc_ids_to_indices(&osc_ids, &all_osc_ids);
    let duration: f64 = opts
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(4.0);
    let is_preview = opts.contains_key("preview");
    let name = opts
        .get("name")
        .cloned()
        .unwrap_or_else(|| template.to_string());

    // Générer le graphe
    let graph_json = graph_presets::build_template_graph(template, n_objects, duration)?;
    let move_id = state.next_move_id(&name);

    // Compiler le graphe
    let audio_state = state
        .audio_state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let graph = build_graph_from_json(&graph_json, &audio_state)?;

    // Créer le worker Runtime
    let osc_sender = OscSender::default();
    let runtime = Runtime::new("127.0.0.1".to_string(), 8000, osc_sender)
        .map_err(|e| format!("Failed to create runtime: {e}"))?;

    let overrides = runtime.audio_param_overrides();
    let compiled =
        compile_graph_with_audio_and_overrides(&graph, state.audio_state.clone(), overrides)?;

    runtime.set_preview_mode(is_preview);
    runtime.set_loop_mode(LoopMode::Loop);

    // Origin = isobarycentre des tracks ciblées
    let origin = state.compute_centroid(&track_indices);
    runtime.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));

    // PositionBuffer
    let buffer = Arc::new(PositionBuffer::new());
    runtime.set_position_buffer(buffer.clone());

    // Démarrer le worker
    let handle = runtime
        .play_compiled(
            compiled,
            EngineParams {
                n_objects: osc_ids.len(),
                duration,
                fps: 60.0,
                extra: serde_json::json!({}),
            },
            osc_ids.clone(),
        )
        .map_err(|e| format!("Worker playback failed: {e:?}"))?;

    // Enregistrer le movement
    let movement = cli_state::CliMovement {
        id: move_id.clone(),
        name: name.clone(),
        runtime,
        osc_ids: osc_ids.clone(),
        is_preview,
        track_indices: track_indices.clone(),
        thread_handle: Some(handle),
    };
    state
        .movements
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(move_id.clone(), movement);

    // Enregistrer dans le MergeRuntime
    {
        let merge_rt = state
            .merge_runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        merge_rt.register_move(
            move_id.clone(),
            buffer,
            osc_ids.clone(),
            track_indices,
            is_preview,
        );

        // NOTE: les osc_ids globaux sont gérés par set_global_osc_ids (frontend).
        // En mode CLI, on les set directement ici.
        merge_rt.set_osc_ids(osc_ids.clone());
        merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));

        // Démarrer le MergeRuntime si pas déjà démarré
        if !merge_rt.is_running() {
            drop(merge_rt); // Relâcher le lock avant start
            let mut merge_rt = state
                .merge_runtime
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            merge_rt
                .start()
                .map_err(|e| format!("Failed to start MergeRuntime: {e}"))?;
        }
    }

    let mode = if is_preview { "preview" } else { "live" };
    Ok(format!("Move '{name}' activated (id={move_id}, tracks={track_str}, mode={mode}, duration={duration}s)"))
}

pub fn cmd_list_moves(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let movements = state.movements.lock().unwrap_or_else(|e| e.into_inner());

    if movements.is_empty() {
        return Ok("No active moves".to_string());
    }

    let mut out = format!(
        "{:<20} {:<15} {:<10} {:<8} {:<15}\n",
        "ID", "Name", "Mode", "Tracks", "Track IDs"
    );
    out.push_str(&"─".repeat(70));
    out.push('\n');
    for m in movements.values() {
        let mode = if m.is_preview { "preview" } else { "live" };
        let track_ids: Vec<String> = m.osc_ids.iter().map(|id| id.to_string()).collect();
        out.push_str(&format!(
            "{:<20} {:<15} {:<10} {:<8} {}\n",
            m.id,
            m.name,
            mode,
            m.osc_ids.len(),
            track_ids.join(",")
        ));
    }
    Ok(out)
}

pub fn cmd_set_macros(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let macros = merge_rt.macros();

    let mut changes = Vec::new();

    if let Some(v) = opts.get("scale").and_then(|s| s.parse::<f64>().ok()) {
        macros.set_scale(v);
        changes.push(format!("scale={v}"));
    }
    let current_shift = macros.get_shift();
    let new_sx = opts
        .get("shift-x")
        .and_then(|s| s.parse().ok())
        .unwrap_or(current_shift.x);
    let new_sy = opts
        .get("shift-y")
        .and_then(|s| s.parse().ok())
        .unwrap_or(current_shift.y);
    let new_sz = opts
        .get("shift-z")
        .and_then(|s| s.parse().ok())
        .unwrap_or(current_shift.z);
    if new_sx != current_shift.x || new_sy != current_shift.y || new_sz != current_shift.z {
        macros.set_shift(new_sx, new_sy, new_sz);
        changes.push(format!("shift=({new_sx}, {new_sy}, {new_sz})"));
    }
    let (cy, cp, cr) = macros.get_rotation();
    let new_yaw = opts.get("yaw").and_then(|s| s.parse().ok()).unwrap_or(cy);
    let new_pitch = opts.get("pitch").and_then(|s| s.parse().ok()).unwrap_or(cp);
    let new_roll = opts.get("roll").and_then(|s| s.parse().ok()).unwrap_or(cr);
    if new_yaw != cy || new_pitch != cp || new_roll != cr {
        macros.set_rotation(new_yaw, new_pitch, new_roll);
        changes.push(format!(
            "rotation=(yaw={new_yaw}, pitch={new_pitch}, roll={new_roll})"
        ));
    }
    if let Some(v) = opts.get("radius-scale").and_then(|s| s.parse::<f64>().ok()) {
        macros.set_radius_scale(v);
        changes.push(format!("radius_scale={v}"));
    }
    if let Some(v) = opts
        .get("height-offset")
        .and_then(|s| s.parse::<f64>().ok())
    {
        macros.set_height_offset(v);
        changes.push(format!("height_offset={v}"));
    }

    if changes.is_empty() {
        let s = macros.get_shift();
        Ok(format!(
            "Current macros: scale={}, shift=({}, {}, {}), rotation=(yaw={}, pitch={}, roll={})",
            macros.get_scale(),
            s.x,
            s.y,
            s.z,
            cy,
            cp,
            cr
        ))
    } else {
        Ok(format!("Macros updated: {}", changes.join(", ")))
    }
}

pub fn cmd_set_merge_strategy(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: set-merge-strategy <override|crossfade|blend|priority>".to_string());
    }
    let strategy = args[0];
    let strat = match strategy {
        "override" => MergeStrategy::Override,
        "crossfade" => MergeStrategy::Crossfade,
        "blend" => MergeStrategy::Blend,
        "priority" => MergeStrategy::Priority,
        _ => {
            return Err(format!(
                "Unknown strategy: '{strategy}'. Available: override, crossfade, blend, priority"
            ))
        }
    };
    let state = cli_state::state();
    state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set_merge_strategy(strat);
    Ok(format!("Merge strategy set to '{strategy}'"))
}

pub fn cmd_set_move_speed(args: &[&str]) -> Result<String, String> {
    if args.len() < 2 {
        return Err("Usage: set-move-speed <move-id> <speed>".to_string());
    }
    let move_id = args[0];
    let speed: f64 = args[1]
        .parse()
        .map_err(|_| format!("Invalid speed value: {}", args[1]))?;

    let state = cli_state::state();
    let movements = state.movements.lock().unwrap_or_else(|e| e.into_inner());
    let movement = movements
        .get(move_id)
        .or_else(|| {
            let lower = move_id.to_lowercase();
            movements
                .iter()
                .find(|(k, _)| k.to_lowercase() == lower)
                .map(|(_, v)| v)
        })
        .ok_or_else(|| format!("Move '{move_id}' not found"))?;
    movement.runtime.macros().set_speed(speed);
    Ok(format!("Move '{move_id}' speed set to {speed}"))
}

pub fn cmd_stop_move(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: stop-move <move-id>".to_string());
    }
    let move_id = args[0];
    let state = cli_state::state();

    // Trouver l'ID réel (case-insensitive)
    let real_id = {
        let movements = state.movements.lock().unwrap_or_else(|e| e.into_inner());
        if movements.contains_key(move_id) {
            move_id.to_string()
        } else {
            let lower = move_id.to_lowercase();
            movements
                .keys()
                .find(|k| k.to_lowercase() == lower)
                .cloned()
                .ok_or_else(|| format!("Move '{move_id}' not found"))?
        }
    };

    // Retirer du MergeRuntime
    {
        let merge_rt = state
            .merge_runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        merge_rt.unregister_move(&real_id);
    }

    // Retirer du state
    let removed = state
        .movements
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&real_id)
        .is_some();
    if removed {
        Ok(format!("Move '{real_id}' stopped"))
    } else {
        Err(format!("Move '{move_id}' not found"))
    }
}

pub fn cmd_stop_all(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let ids: Vec<String> = state
        .movements
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .keys()
        .cloned()
        .collect();

    if ids.is_empty() {
        return Ok("No active moves to stop".to_string());
    }

    // Retirer tous du MergeRuntime
    {
        let merge_rt = state
            .merge_runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for id in &ids {
            merge_rt.unregister_move(id);
        }
    }

    // Retirer tous du state
    let mut movements = state.movements.lock().unwrap_or_else(|e| e.into_inner());
    for id in &ids {
        movements.remove(id);
    }

    Ok(format!("Stopped {} move(s): {}", ids.len(), ids.join(", ")))
}
