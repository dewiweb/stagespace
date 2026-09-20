//! Commandes CLI : import .hol et listing des tracks

use crate::cli_state::{self, HolTrack};

pub fn cmd_import_hol(args: &[&str]) -> Result<String, String> {
    if args.is_empty() {
        return Err("Usage: import-hol <file.hol>".to_string());
    }
    let file_path = args[0];
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {e}"))?;

    // Parser partagé (rust-engines::hol_parser) — même convention AED→XYZ
    // que le backend Tauri (azim=0 ⇒ front +Y) et gestion de xyz/couleurs.
    let parsed = stagespace_engines::parse_hol_project(&content)
        .map_err(|e| format!("Failed to parse .hol: {e}"))?;

    let tracks: Vec<HolTrack> = parsed
        .into_iter()
        .map(|t| HolTrack {
            id: t.id,
            name: t.name,
            position: t.position,
            color: t.color,
        })
        .collect();

    let count = tracks.len();
    let state = cli_state::state();
    *state.hol_tracks.lock().unwrap_or_else(|e| e.into_inner()) = tracks;

    // Mettre à jour les OSC IDs
    let osc_ids: Vec<u32> = state
        .hol_tracks
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|t| t.id)
        .collect();
    *state
        .manual_osc_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = osc_ids.clone();

    // Pousser les positions des tracks au MergeRuntime (pour Barycenter)
    let positions: std::collections::HashMap<u32, [f64; 3]> = state
        .hol_tracks
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|t| (t.id, t.position))
        .collect();
    state
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set_track_positions(positions);

    Ok(format!("Imported {count} tracks from {file_path}"))
}

pub fn cmd_list_tracks(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let tracks = state.hol_tracks.lock().unwrap_or_else(|e| e.into_inner());

    if tracks.is_empty() {
        let osc_ids = state
            .manual_osc_ids
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
