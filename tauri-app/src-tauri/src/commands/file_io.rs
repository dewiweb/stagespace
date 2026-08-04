use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct HolProject {
    pub tracks: Vec<Track>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Track {
    pub id: u32,
    pub name: String,
    pub position: [f64; 3],
    pub color: String,
}

#[tauri::command]
pub async fn import_hol_project(file_path: String) -> Result<HolProject, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Le format .hol est: {"hol": {"ae": ["/track/1/name \"TRACK 1\"", "/track/1/azim 44.89", ...]}}
    // L'array "ae" contient des strings au format OSC plat
    let project: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Récupérer l'array "ae" — il peut être sous hol.ae ou directement
    let ae_array = project["hol"]["ae"]
        .as_array()
        .or_else(|| project["ae"].as_array())
        .ok_or_else(|| "No 'ae' array found in .hol file".to_string())?;

    // Parser les strings OSC pour extraire les tracks
    // Format: /track/{id}/{param} {value}
    let mut track_names: HashMap<u32, String> = HashMap::new();
    let mut track_colors: HashMap<u32, String> = HashMap::new();
    let mut track_azim: HashMap<u32, f64> = HashMap::new();
    let mut track_elev: HashMap<u32, f64> = HashMap::new();
    let mut track_dist: HashMap<u32, f64> = HashMap::new();
    let mut track_xyz: HashMap<u32, [f64; 3]> = HashMap::new();
    let mut track_ids: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();

    for item in ae_array {
        if let Some(line) = item.as_str() {
            // Parser: /track/{id}/{param} {value}
            if !line.starts_with("/track/") {
                continue;
            }
            let parts: Vec<&str> = line.splitn(4, '/').collect();
            // parts: ["", "track", "{id}", "{param} {value}"]
            if parts.len() < 4 {
                continue;
            }
            let id: u32 = match parts[2].parse() {
                Ok(id) => id,
                Err(_) => continue,
            };
            track_ids.insert(id);
            let rest = parts[3]; // "{param} {value}" or "{param}/{sub} {value}"

            // Extraire le paramètre et la valeur
            // Le paramètre peut être "name", "azim", "elev", "dist", "color", "xyz", etc.
            let (param, value) = if let Some(space_idx) = rest.find(' ') {
                (&rest[..space_idx], &rest[space_idx + 1..])
            } else {
                (rest, "")
            };

            match param {
                "name" => {
                    // value peut être entre guillemets: "TRACK 1"
                    let name = value.trim_matches('"').to_string();
                    track_names.insert(id, name);
                }
                "color" => {
                    // Format: "r g b a" (float 0-1)
                    let comps: Vec<f64> = value
                        .split_whitespace()
                        .filter_map(|s| s.parse().ok())
                        .collect();
                    if comps.len() >= 3 {
                        let r = (comps[0] * 255.0) as u8;
                        let g = (comps[1] * 255.0) as u8;
                        let b = (comps[2] * 255.0) as u8;
                        track_colors.insert(id, format!("#{:02x}{:02x}{:02x}", r, g, b));
                    }
                }
                "azim" => {
                    if let Ok(v) = value.parse() {
                        track_azim.insert(id, v);
                    }
                }
                "elev" => {
                    if let Ok(v) = value.parse() {
                        track_elev.insert(id, v);
                    }
                }
                "dist" => {
                    if let Ok(v) = value.parse() {
                        track_dist.insert(id, v);
                    }
                }
                "xyz" => {
                    // Format: "x y z"
                    let comps: Vec<f64> = value
                        .split_whitespace()
                        .filter_map(|s| s.parse().ok())
                        .collect();
                    if comps.len() >= 3 {
                        track_xyz.insert(id, [comps[0], comps[1], comps[2]]);
                    }
                }
                _ => {}
            }
        }
    }

    if track_ids.is_empty() {
        return Err("No tracks found in .hol file".to_string());
    }

    // Convertir en Track structs
    // Si on a xyz, l'utiliser directement. Sinon, convertir AED → XYZ.
    let tracks: Vec<Track> = track_ids
        .iter()
        .map(|id| {
            let name = track_names.get(id).cloned().unwrap_or_else(|| format!("Track {}", id));
            let color = track_colors.get(id).cloned().unwrap_or_else(|| "#888888".to_string());

            let position = if let Some(xyz) = track_xyz.get(id) {
                *xyz
            } else {
                // Convertir AED (azimuth, elevation, distance) → XYZ
                // Convention Holophonix: azim=0 = front, positif horaire (vers droite)
                // x = dist * cos(elev) * sin(azim)
                // y = dist * cos(elev) * cos(azim)  (y = front)
                // z = dist * sin(elev)
                let azim = track_azim.get(id).copied().unwrap_or(0.0).to_radians();
                let elev = track_elev.get(id).copied().unwrap_or(0.0).to_radians();
                let dist = track_dist.get(id).copied().unwrap_or(1.0);
                [
                    dist * elev.cos() * azim.sin(),
                    dist * elev.cos() * azim.cos(),
                    dist * elev.sin(),
                ]
            };

            Track { id: *id, name, position, color }
        })
        .collect();

    Ok(HolProject { tracks })
}

#[tauri::command]
pub async fn save_graph_to_file(
    file_path: String,
    graph_json: serde_json::Value,
) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&graph_json)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&file_path, data)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_graph_from_file(file_path: String) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let graph: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    Ok(graph)
}
