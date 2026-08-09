//! Commandes CLI : import .hol et listing des tracks

use crate::cli_state::{self, HolTrack};

pub fn cmd_import_hol(args: &[&str]) -> Result<String, String> {
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

pub fn cmd_list_tracks(_args: &[&str]) -> Result<String, String> {
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
