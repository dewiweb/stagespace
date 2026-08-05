//! Dispatch des commandes CLI — chaque commande retourne un string de sortie.

use crate::cli_state::{self, HolTrack};
use crate::graph_presets;
use stagespace_engines::{
    EngineParams, LoopMode, MergeStrategy, OscSender, PositionBuffer, Runtime,
};
use stagespace_tauri::graph::compilation::compile_graph_with_audio_and_overrides;
use stagespace_tauri::graph::parser::build_graph_from_json;
use std::io::Write;
use std::sync::Arc;

/// Parse les arguments d'une commande (key=value ou --key value)
fn parse_args(parts: &[&str]) -> std::collections::HashMap<String, String> {
    let mut args = std::collections::HashMap::new();
    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        if let Some(rest) = part.strip_prefix("--") {
            // --key value ou --key=value
            if let Some((k, v)) = rest.split_once('=') {
                args.insert(k.to_string(), v.to_string());
            } else if i + 1 < parts.len() && !parts[i + 1].starts_with("--") {
                args.insert(rest.to_string(), parts[i + 1].to_string());
                i += 1;
            } else {
                args.insert(rest.to_string(), "true".to_string());
            }
        }
        i += 1;
    }
    args
}

/// Parse une liste de tracks : "1,2,3" ou "1-5" ou "all"
fn parse_track_list(s: &str, all_ids: &[u32]) -> Result<Vec<u32>, String> {
    if s == "all" || s.is_empty() {
        return Ok(all_ids.to_vec());
    }
    let mut result = Vec::new();
    for part in s.split(',') {
        let part = part.trim();
        if let Some((start, end)) = part.split_once('-') {
            let start: u32 = start
                .parse()
                .map_err(|_| format!("Invalid track ID: {start}"))?;
            let end: u32 = end
                .parse()
                .map_err(|_| format!("Invalid track ID: {end}"))?;
            for id in start..=end {
                result.push(id);
            }
        } else {
            let id: u32 = part
                .parse()
                .map_err(|_| format!("Invalid track ID: {part}"))?;
            result.push(id);
        }
    }
    Ok(result)
}

/// Convertit des OSC IDs en indices de tracks
fn osc_ids_to_indices(osc_ids: &[u32], all_ids: &[u32]) -> Vec<usize> {
    osc_ids
        .iter()
        .filter_map(|id| all_ids.iter().position(|a| a == id))
        .collect()
}

/// Dispatch principal
pub fn dispatch(input: &str) -> Result<String, String> {
    // Initialiser l'état si pas déjà fait
    cli_state::init_state()?;

    let parts: Vec<&str> = input.split_whitespace().collect();
    if parts.is_empty() {
        return Ok(String::new());
    }

    let cmd = parts[0];
    let rest = &parts[1..];

    match cmd {
        "import-hol" => cmd_import_hol(rest),
        "list-tracks" => cmd_list_tracks(rest),
        "activate-move" | "activate" => cmd_activate_move(rest),
        "list-moves" | "moves" => cmd_list_moves(rest),
        "sample" => cmd_sample(rest),
        "set-macros" | "macros" => cmd_set_macros(rest),
        "set-merge-strategy" | "merge-strategy" => cmd_set_merge_strategy(rest),
        "set-move-speed" | "move-speed" => cmd_set_move_speed(rest),
        "stop-move" => cmd_stop_move(rest),
        "stop-all" => cmd_stop_all(rest),
        "osc-listen" => cmd_osc_listen(rest),
        "perf" | "stats" => cmd_perf(rest),
        "templates" => cmd_templates(rest),
        "help" => {
            print_help(&mut std::io::stdout().lock());
            Ok(String::new())
        }
        _ => Err(format!(
            "Unknown command: '{cmd}'. Type 'help' for available commands."
        )),
    }
}

pub fn print_help(out: &mut impl Write) {
    writeln!(out, "Available commands:").ok();
    writeln!(
        out,
        "  import-hol <file.hol>              Import Holophonix project"
    )
    .ok();
    writeln!(
        out,
        "  list-tracks                        List tracks from imported .hol"
    )
    .ok();
    writeln!(out, "  activate-move <template> [opts]    Activate a move").ok();
    writeln!(
        out,
        "  list-moves                         List active moves"
    )
    .ok();
    writeln!(
        out,
        "  sample --move <id> [opts]          Sample trajectory positions"
    )
    .ok();
    writeln!(
        out,
        "  set-macros [opts]                  Set global spatial macros"
    )
    .ok();
    writeln!(
        out,
        "  set-merge-strategy <strategy>      Set merge strategy"
    )
    .ok();
    writeln!(
        out,
        "  set-move-speed <id> <speed>        Set per-move speed"
    )
    .ok();
    writeln!(out, "  stop-move <id>                     Stop a move").ok();
    writeln!(out, "  stop-all                           Stop all moves").ok();
    writeln!(
        out,
        "  osc-listen --port <port>           Listen for OSC packets"
    )
    .ok();
    writeln!(
        out,
        "  perf                               Show performance stats"
    )
    .ok();
    writeln!(
        out,
        "  templates                          List shape templates"
    )
    .ok();
    writeln!(out, "  quit                               Exit CLI").ok();
}

// ═══════════════════════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════════════════════

fn cmd_import_hol(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: import-hol <file.hol>".to_string());
    }
    let file_path = args[0];
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {e}"))?;

    let project: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {e}"))?;

    let ae_array = project["hol"]["ae"]
        .as_array()
        .or_else(|| project["ae"].as_array())
        .ok_or("No 'ae' array found in .hol file")?;

    // Parser les strings OSC : /track/{id}/{param} {value}
    use std::collections::{BTreeSet, HashMap};
    let mut track_names: HashMap<u32, String> = HashMap::new();
    let mut track_colors: HashMap<u32, String> = HashMap::new();
    let mut track_azim: HashMap<u32, f64> = HashMap::new();
    let mut track_elev: HashMap<u32, f64> = HashMap::new();
    let mut track_dist: HashMap<u32, f64> = HashMap::new();
    let mut track_xyz: HashMap<u32, [f64; 3]> = HashMap::new();
    let mut track_ids: BTreeSet<u32> = BTreeSet::new();

    for item in ae_array {
        if let Some(line) = item.as_str() {
            if !line.starts_with("/track/") {
                continue;
            }
            let parts: Vec<&str> = line.splitn(4, '/').collect();
            if parts.len() < 4 {
                continue;
            }
            let id: u32 = match parts[2].parse() {
                Ok(id) => id,
                Err(_) => continue,
            };
            track_ids.insert(id);
            let param_value = parts[3];
            let (param, value_str) = match param_value.split_once(' ') {
                Some((p, v)) => (p, v.trim().trim_matches('"')),
                None => continue,
            };
            match param {
                "name" => {
                    track_names.insert(id, value_str.to_string());
                }
                "color" => {
                    track_colors.insert(id, value_str.to_string());
                }
                "azim" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_azim.insert(id, v);
                    }
                }
                "elev" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_elev.insert(id, v);
                    }
                }
                "dist" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_dist.insert(id, v);
                    }
                }
                "x" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_xyz.entry(id).or_insert([0.0, 0.0, 0.0])[0] = v;
                    }
                }
                "y" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_xyz.entry(id).or_insert([0.0, 0.0, 0.0])[1] = v;
                    }
                }
                "z" => {
                    if let Ok(v) = value_str.parse::<f64>() {
                        track_xyz.entry(id).or_insert([0.0, 0.0, 0.0])[2] = v;
                    }
                }
                _ => {}
            }
        }
    }

    // Construire les tracks
    let mut tracks = Vec::new();
    for id in track_ids {
        let name = track_names
            .get(&id)
            .cloned()
            .unwrap_or_else(|| format!("Track {id}"));
        let color = track_colors
            .get(&id)
            .cloned()
            .unwrap_or_else(|| "#888888".to_string());

        let position = if let Some(xyz) = track_xyz.get(&id) {
            *xyz
        } else {
            // Convertir AED → XYZ
            let azim = track_azim.get(&id).copied().unwrap_or(0.0).to_radians();
            let elev = track_elev.get(&id).copied().unwrap_or(0.0).to_radians();
            let dist = track_dist.get(&id).copied().unwrap_or(1.0);
            [
                dist * elev.cos() * azim.cos(),
                dist * elev.cos() * azim.sin(),
                dist * elev.sin(),
            ]
        };

        tracks.push(HolTrack {
            id,
            name,
            position,
            color,
        });
    }

    let count = tracks.len();
    let state = cli_state::state();
    *state.hol_tracks.lock().unwrap() = tracks;

    // Mettre à jour les OSC IDs
    let osc_ids: Vec<u32> = state
        .hol_tracks
        .lock()
        .unwrap()
        .iter()
        .map(|t| t.id)
        .collect();
    *state.manual_osc_ids.lock().unwrap() = osc_ids.clone();

    // Pousser les positions des tracks au MergeRuntime (pour Barycenter)
    let positions: std::collections::HashMap<u32, [f64; 3]> = state
        .hol_tracks
        .lock()
        .unwrap()
        .iter()
        .map(|t| (t.id, t.position))
        .collect();
    state
        .merge_runtime
        .lock()
        .unwrap()
        .set_track_positions(positions);

    Ok(format!("Imported {count} tracks from {file_path}"))
}

fn cmd_list_tracks(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let tracks = state.hol_tracks.lock().unwrap();

    if tracks.is_empty() {
        let osc_ids = state.manual_osc_ids.lock().unwrap();
        return Ok(format!(
            "No .hol imported. Manual OSC IDs: {}",
            osc_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let mut out = format!(
        "{:<6} {:<20} {:<10} {:<25}\n",
        "ID", "Name", "Color", "Position (x, y, z)"
    );
    out.push_str(&"─".repeat(70));
    out.push('\n');
    for t in tracks.iter() {
        out.push_str(&format!(
            "{:<6} {:<20} {:<10} ({:.2}, {:.2}, {:.2})\n",
            t.id, t.name, t.color, t.position[0], t.position[1], t.position[2]
        ));
    }
    Ok(out)
}

fn cmd_activate_move(args: &[&str]) -> Result<String, String> {
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
    let audio_state = state.audio_state.lock().unwrap().clone();
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
        .unwrap()
        .insert(move_id.clone(), movement);

    // Enregistrer dans le MergeRuntime
    {
        let merge_rt = state.merge_runtime.lock().unwrap();
        merge_rt.register_move(
            move_id.clone(),
            buffer,
            osc_ids.clone(),
            track_indices,
            is_preview,
        );

        // Fusionner les OSC IDs
        let existing = merge_rt.osc_ids();
        let mut merged = existing;
        for &id in &osc_ids {
            if !merged.contains(&id) {
                merged.push(id);
            }
        }
        merge_rt.set_osc_ids(merged);
        merge_rt.set_origin(nalgebra::Vector3::new(origin[0], origin[1], origin[2]));

        // Démarrer le MergeRuntime si pas déjà démarré
        if !merge_rt.is_running() {
            drop(merge_rt); // Relâcher le lock avant start
            let mut merge_rt = state.merge_runtime.lock().unwrap();
            merge_rt
                .start()
                .map_err(|e| format!("Failed to start MergeRuntime: {e}"))?;
        }
    }

    let mode = if is_preview { "preview" } else { "live" };
    Ok(format!("Move '{name}' activated (id={move_id}, tracks={track_str}, mode={mode}, duration={duration}s)"))
}

fn cmd_list_moves(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let movements = state.movements.lock().unwrap();

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

fn cmd_sample(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let move_id = opts
        .get("move")
        .ok_or("Usage: sample --move <id> [--obj 0] [--samples 50] [--duration 4]")?;

    let object_index: usize = opts.get("obj").and_then(|s| s.parse().ok()).unwrap_or(0);
    let n_samples: usize = opts
        .get("samples")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);
    let duration: f64 = opts
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(4.0);

    let state = cli_state::state();
    let movements = state.movements.lock().unwrap();
    let movement = movements
        .get(move_id)
        .or_else(|| {
            // Recherche case-insensitive
            let lower = move_id.to_lowercase();
            movements
                .iter()
                .find(|(k, _)| k.to_lowercase() == lower)
                .map(|(_, v)| v)
        })
        .ok_or_else(|| {
            format!("Move '{move_id}' not found. Use 'list-moves' to see active moves.")
        })?;

    let raw_samples =
        movement
            .runtime
            .sample_trajectory(object_index, n_samples.max(2), duration.max(0.1));
    drop(movements);

    // Appliquer le post-process global
    let mr = state.merge_runtime.lock().unwrap();
    let samples = mr.apply_post_process_to_samples(raw_samples, object_index);

    // Format: t, x, y, z (CSV)
    let mut out =
        format!("# move={move_id} obj={object_index} samples={n_samples} duration={duration}s\n");
    out.push_str("# t, x, y, z\n");
    for (t, x, y, z) in &samples {
        out.push_str(&format!("{t:.3}, {x:.6}, {y:.6}, {z:.6}\n"));
    }

    // Stats rapides
    if !samples.is_empty() {
        let xs: Vec<f64> = samples.iter().map(|s| s.1).collect();
        let ys: Vec<f64> = samples.iter().map(|s| s.2).collect();
        let zs: Vec<f64> = samples.iter().map(|s| s.3).collect();
        let x_range = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let y_range = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - ys.iter().cloned().fold(f64::INFINITY, f64::min);
        let z_range = zs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - zs.iter().cloned().fold(f64::INFINITY, f64::min);
        out.push_str(&format!(
            "# range: x=[{x_range:.3}], y=[{y_range:.3}], z=[{z_range:.3}]\n"
        ));
    }

    Ok(out)
}

fn cmd_set_macros(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let state = cli_state::state();
    let merge_rt = state.merge_runtime.lock().unwrap();
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

fn cmd_set_merge_strategy(args: &[&str]) -> Result<String, String> {
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
        .unwrap()
        .set_merge_strategy(strat);
    Ok(format!("Merge strategy set to '{strategy}'"))
}

fn cmd_set_move_speed(args: &[&str]) -> Result<String, String> {
    if args.len() < 2 {
        return Err("Usage: set-move-speed <move-id> <speed>".to_string());
    }
    let move_id = args[0];
    let speed: f64 = args[1]
        .parse()
        .map_err(|_| format!("Invalid speed value: {}", args[1]))?;

    let state = cli_state::state();
    let movements = state.movements.lock().unwrap();
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

fn cmd_stop_move(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: stop-move <move-id>".to_string());
    }
    let move_id = args[0];
    let state = cli_state::state();

    // Trouver l'ID réel (case-insensitive)
    let real_id = {
        let movements = state.movements.lock().unwrap();
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
        let merge_rt = state.merge_runtime.lock().unwrap();
        merge_rt.unregister_move(&real_id);
    }

    // Retirer du state
    let removed = state.movements.lock().unwrap().remove(&real_id).is_some();
    if removed {
        Ok(format!("Move '{real_id}' stopped"))
    } else {
        Err(format!("Move '{move_id}' not found"))
    }
}

fn cmd_stop_all(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let ids: Vec<String> = state.movements.lock().unwrap().keys().cloned().collect();

    if ids.is_empty() {
        return Ok("No active moves to stop".to_string());
    }

    // Retirer tous du MergeRuntime
    {
        let merge_rt = state.merge_runtime.lock().unwrap();
        for id in &ids {
            merge_rt.unregister_move(id);
        }
    }

    // Retirer tous du state
    let mut movements = state.movements.lock().unwrap();
    for id in &ids {
        movements.remove(id);
    }

    Ok(format!("Stopped {} move(s): {}", ids.len(), ids.join(", ")))
}

fn cmd_osc_listen(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let port: u16 = opts
        .get("port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(8000);
    let timeout_secs: u64 = opts
        .get("timeout")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);

    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to bind socket: {e}"))?;
    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs)))
        .map_err(|e| format!("Failed to set timeout: {e}"))?;

    // Pour écouter, on bind sur le port spécifié
    drop(socket);
    let socket = std::net::UdpSocket::bind(format!("0.0.0.0:{port}"))
        .map_err(|e| format!("Failed to bind port {port}: {e}"))?;
    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs)))
        .map_err(|e| format!("Failed to set timeout: {e}"))?;

    let mut buf = [0u8; 4096];
    let mut out = format!("Listening on port {port} for {timeout_secs}s...\n");

    loop {
        match socket.recv_from(&mut buf) {
            Ok((n, addr)) => {
                if let Ok((_, rosc::OscPacket::Message(msg))) = rosc::decoder::decode_udp(&buf[..n])
                {
                    let args: Vec<String> = msg
                        .args
                        .iter()
                        .map(|a| match a {
                            rosc::OscType::Float(f) => format!("{f:.4}"),
                            rosc::OscType::Int(i) => i.to_string(),
                            rosc::OscType::String(s) => s.clone(),
                            _ => format!("{a:?}"),
                        })
                        .collect();
                    out.push_str(&format!(
                        "  {} {} from {}\n",
                        msg.addr,
                        args.join(" "),
                        addr
                    ));
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                break;
            }
            Err(e) => {
                out.push_str(&format!("Error: {e}\n"));
                break;
            }
        }
    }

    out.push_str("Done listening.\n");
    Ok(out)
}

fn cmd_perf(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let merge_rt = state.merge_runtime.lock().unwrap();
    let stats = merge_rt.get_perf_stats();

    let movements = state.movements.lock().unwrap();
    let out = format!(
        "MergeRuntime:\n  fps: {:.1}\n  osc_rate: {:.1}\n  latency_ms: {:.2}\n  cpu_percent: {:.1}\n  active_moves: {}\n  osc_ids: {}\n",
        stats.fps,
        stats.osc_rate,
        stats.latency_ms,
        stats.cpu_percent,
        movements.len(),
        merge_rt.osc_ids().len()
    );
    Ok(out)
}

fn cmd_templates(_args: &[&str]) -> Result<String, String> {
    let templates = graph_presets::list_templates();
    let mut out = format!("{:<15} {}\n", "Template", "Description");
    out.push_str(&"─".repeat(50));
    out.push('\n');
    for (id, desc) in &templates {
        out.push_str(&format!("{id:<15} {desc}\n"));
    }
    Ok(out)
}
