//! Commandes CLI : gestion des moves (activate, list, stop, macros, strategy, speed)

use crate::cli_state;
use crate::graph_presets;
use stagespace_engines::{
    EngineParams, LoopMode, MergeStrategy, OscSender, PositionBuffer, Runtime,
};
use stagespace_tauri::graph::compilation::compile_graph_with_audio_and_overrides;
use stagespace_tauri::graph::parser::build_graph_from_json;
use std::str::FromStr;
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
    runtime
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

        // La liste globale = TOUTES les tracks connues (pas le sous-ensemble
        // du move) — sinon track_indices (index dans all_osc_ids) pointerait
        // hors bornes ou sur les mauvaises tracks.
        merge_rt.set_osc_ids(all_osc_ids.clone());
        merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));

        // Démarrer le MergeRuntime si pas déjà démarré
        if !merge_rt.is_running() {
            drop(merge_rt); // Relâcher le lock avant start
            let mut merge_rt = state
                .merge_runtime
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Err(e) = merge_rt.start() {
                // Cleanup : ne pas laisser un worker orphelin enregistré
                // (même logique que spawn_move / move_management.rs).
                drop(merge_rt);
                state
                    .merge_runtime
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .unregister_move(&move_id);
                let removed = state
                    .movements
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&move_id);
                if let Some(mv) = removed {
                    mv.runtime.stop();
                }
                return Err(format!("Failed to start MergeRuntime: {e}"));
            }
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

/// Définit un canal spatial étendu pour un objet
/// Usage: set-channel <object_index> <channel> <value>
pub fn cmd_set_channel(args: &[&str]) -> Result<String, String> {
    if args.len() < 3 {
        return Err(
            "Usage: set-channel <object_index> <gain|spread|distance|presence|yaw|aperture|lfe> <value>"
                .to_string(),
        );
    }
    let obj: usize = args[0]
        .parse()
        .map_err(|_| format!("Invalid object index: {}", args[0]))?;
    let channel = stagespace_engines::osc_sender::SpatialChannel::from_str(args[1])?;
    let value: f64 = args[2]
        .parse()
        .map_err(|_| format!("Invalid value: {}", args[2]))?;

    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    merge_rt.set_object_channel(obj, channel, value);
    Ok(format!(
        "Channel '{}' set to {} for object {}",
        args[1], value, obj
    ))
}

/// Efface un canal spatial pour un objet
/// Usage: clear-channel <object_index> [channel]  (sans channel = tous)
pub fn cmd_clear_channel(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: clear-channel <object_index|all> [channel]".to_string());
    }

    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if args[0] == "all" {
        merge_rt.clear_all_object_channels();
        return Ok("All spatial channels cleared".to_string());
    }

    let obj: usize = args[0]
        .parse()
        .map_err(|_| format!("Invalid object index: {}", args[0]))?;
    let channel = if args.len() > 1 {
        Some(stagespace_engines::osc_sender::SpatialChannel::from_str(
            args[1],
        )?)
    } else {
        None
    };
    merge_rt.clear_object_channel(obj, channel);
    Ok(format!("Channel(s) cleared for object {obj}"))
}

/// Ajoute une règle de modulation cinématique (source → canal spatial)
/// Usage: mod-add <speed|accel|jerk|angvel> <channel> <scale> [offset] [min] [max] [obj] [listener x,y,z]
pub fn cmd_mod_add(args: &[&str]) -> Result<String, String> {
    if args.len() < 3 {
        return Err(
            "Usage: mod-add <speed|accel|jerk|angvel> <channel> <scale> [offset] [min] [max] [obj] [listener x,y,z]"
                .to_string(),
        );
    }
    let source = stagespace_engines::kinematics::KinematicSource::from_str(args[0])?;
    let channel = stagespace_engines::osc_sender::SpatialChannel::from_str(args[1])?;
    let scale: f64 = args[2]
        .parse()
        .map_err(|_| format!("Invalid scale: {}", args[2]))?;

    // '-' = valeur par défaut pour un argument optionnel positionnel
    let parse_opt = |i: usize| -> Result<Option<f64>, String> {
        match args.get(i) {
            Some(&"-") | None => Ok(None),
            Some(s) => s
                .parse::<f64>()
                .map(Some)
                .map_err(|_| format!("Invalid number: {s}")),
        }
    };
    let offset = parse_opt(3)?.unwrap_or(0.0);
    let min = parse_opt(4)?.unwrap_or(f64::NEG_INFINITY);
    let max = parse_opt(5)?.unwrap_or(f64::INFINITY);
    let object = match args.get(6) {
        Some(&"-") | None => None,
        Some(s) => Some(
            s.parse::<usize>()
                .map_err(|_| format!("Invalid object index: {s}"))?,
        ),
    };

    // args[7] = listener "x,y,z" — position du point d'écoute pour `angvel`
    let listener = match args.get(7) {
        Some(&"-") | None => None,
        Some(s) => {
            let parts: Vec<f64> = s.split(',').filter_map(|t| t.trim().parse().ok()).collect();
            if parts.len() != 3 {
                return Err(format!("Invalid listener (expected 'x,y,z'): {s}"));
            }
            Some([parts[0], parts[1], parts[2]])
        }
    };

    let mut rule = stagespace_engines::kinematics::ChannelModulation::new(source, channel, scale);
    rule.offset = offset;
    rule.min = min;
    rule.max = max;
    rule.object = object;
    if let Some(l) = listener {
        rule.listener = l;
    }

    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let idx = merge_rt.add_modulation(rule);
    Ok(format!(
        "Modulation #{} added: {} → {} (scale {}, offset {}, range [{}..{}]{})",
        idx,
        args[0],
        args[1],
        scale,
        offset,
        min,
        max,
        object
            .map(|o| format!(", obj {o}"))
            .unwrap_or_else(|| ", all objects".to_string())
    ))
}

/// Liste les règles de modulation actives
/// Usage: mod-list
pub fn cmd_mod_list(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let rules = merge_rt.modulations();
    if rules.is_empty() {
        return Ok("No modulations".to_string());
    }
    let mut out = String::from("Modulations:\n");
    for (i, r) in rules.iter().enumerate() {
        out.push_str(&format!(
            "  #{} {:?} → {:?} scale={} offset={} range=[{}..{}] obj={:?}\n",
            i, r.source, r.channel, r.scale, r.offset, r.min, r.max, r.object
        ));
    }
    Ok(out)
}

/// Supprime une ou toutes les règles de modulation
/// Usage: mod-clear <index|all>
pub fn cmd_mod_clear(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: mod-clear <index|all>".to_string());
    }
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if args[0] == "all" {
        merge_rt.clear_modulations();
        return Ok("All modulations cleared".to_string());
    }
    let idx: usize = args[0]
        .parse()
        .map_err(|_| format!("Invalid index: {}", args[0]))?;
    if merge_rt.remove_modulation(idx) {
        Ok(format!("Modulation #{idx} removed"))
    } else {
        Err(format!("No modulation at index {idx}"))
    }
}

/// Définit le lissage cinématique
/// Usage: kin-smoothing <0.0-0.99>
pub fn cmd_kin_smoothing(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: kin-smoothing <0.0-0.99>".to_string());
    }
    let value: f64 = args[0]
        .parse()
        .map_err(|_| format!("Invalid value: {}", args[0]))?;
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    merge_rt.set_kinematic_smoothing(value);
    Ok(format!("Kinematic smoothing set to {value}"))
}

// ─── Zones (P4) ─────────────────────────────────────────────────────────────

/// Parse "gain=0.5,spread=1" → SpatialChannels
fn parse_zone_channels(s: &str) -> Result<stagespace_engines::SpatialChannels, String> {
    let mut channels = stagespace_engines::SpatialChannels::default();
    for pair in s.split(',') {
        let (name, val) = pair
            .split_once('=')
            .ok_or_else(|| format!("Invalid channel spec '{pair}' (expected ch=value)"))?;
        let ch = stagespace_engines::SpatialChannel::from_str(name.trim())?;
        let v: f64 = val
            .trim()
            .parse()
            .map_err(|_| format!("Invalid channel value: {val}"))?;
        channels.set(ch, v);
    }
    Ok(channels)
}

/// Usage:
///   zone-add sphere <cx> <cy> <cz> <radius> --channels gain=0.5,spread=1 [--falloff 0.5] [--objs 0,2]
///   zone-add box <minx> <miny> <minz> <maxx> <maxy> <maxz> --channels gain=0 [--falloff 0.5]
pub fn cmd_zone_add(args: &[&str]) -> Result<String, String> {
    let positional: Vec<&&str> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if positional.len() < 5 {
        return Err(
            "Usage: zone-add <sphere cx cy cz r | box minx miny minz maxx maxy maxz> --channels ch=v,... [--falloff f] [--objs i,j]"
                .to_string(),
        );
    }
    let num = |i: usize| -> Result<f64, String> {
        positional
            .get(i)
            .ok_or_else(|| format!("Missing positional arg #{i}"))?
            .parse::<f64>()
            .map_err(|_| format!("Invalid number: {}", positional[i]))
    };
    let shape = match *positional[0] {
        "sphere" => stagespace_engines::ZoneShape::Sphere {
            center: [num(1)?, num(2)?, num(3)?],
            radius: num(4)?,
        },
        "box" => stagespace_engines::ZoneShape::Box {
            min: [num(1)?, num(2)?, num(3)?],
            max: [num(4)?, num(5)?, num(6)?],
        },
        s => return Err(format!("Unknown zone shape '{s}' (sphere|box)")),
    };

    let opts = parse_args(args);
    let channels = match opts.get("channels") {
        Some(spec) => parse_zone_channels(spec)?,
        None => return Err("Missing --channels ch=value,...".to_string()),
    };
    if channels.is_empty() {
        return Err("Zone requires at least one channel".to_string());
    }
    let falloff = opts
        .get("falloff")
        .map(|s| s.parse::<f64>())
        .transpose()
        .map_err(|_| "Invalid --falloff".to_string())?
        .unwrap_or(0.0)
        .max(0.0);
    let objects = opts
        .get("objs")
        .map(|s| {
            s.split(',')
                .map(|p| p.trim().parse::<usize>())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| format!("Invalid --objs: {s}").to_string())
        })
        .transpose()?;

    let zone = stagespace_engines::Zone {
        shape,
        falloff,
        channels,
        objects,
        enabled: !opts.contains_key("disabled"),
    };
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let idx = merge_rt.add_zone(zone);
    Ok(format!("Zone #{idx} added"))
}

/// Usage: zone-list
pub fn cmd_zone_list(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let zones = merge_rt.zones();
    if zones.is_empty() {
        return Ok("No zones".to_string());
    }
    let mut out = format!("Zones ({}):\n", zones.len());
    for (i, z) in zones.iter().enumerate() {
        let shape = match &z.shape {
            stagespace_engines::ZoneShape::Sphere { center, radius } => {
                format!("sphere c={center:?} r={radius}")
            }
            stagespace_engines::ZoneShape::Box { min, max } => {
                format!("box {min:?}→{max:?}")
            }
        };
        let chs: Vec<String> = z
            .channels
            .iter()
            .map(|(ch, v)| format!("{ch:?}={v}"))
            .collect();
        let objs = z
            .objects
            .as_ref()
            .map(|o| format!(" objs={o:?}"))
            .unwrap_or_default();
        let state = if z.enabled { "" } else { " [disabled]" };
        out.push_str(&format!(
            "  #{i} {shape} falloff={} ch=[{}]{objs}{state}\n",
            z.falloff,
            chs.join(",")
        ));
    }
    Ok(out)
}

/// Usage: zone-clear <index|all>
pub fn cmd_zone_clear(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: zone-clear <index|all>".to_string());
    }
    let state = cli_state::state();
    let merge_rt = state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if args[0] == "all" {
        merge_rt.clear_zones();
        return Ok("All zones cleared".to_string());
    }
    let idx: usize = args[0]
        .parse()
        .map_err(|_| format!("Invalid index: {}", args[0]))?;
    if merge_rt.remove_zone(idx) {
        Ok(format!("Zone #{idx} removed"))
    } else {
        Err(format!("No zone at index {idx}"))
    }
}
