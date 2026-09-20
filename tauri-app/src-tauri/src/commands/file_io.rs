use serde::{Deserialize, Serialize};

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
    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;

    // Parser partagé (stagespace_engines::hol_parser) — une seule implémentation
    // du format .hol pour Tauri et le CLI : gère hol.ae / ae racine, couleurs
    // "#RRGGBB" et "r g b a", xyz groupé ou x/y/z séparés, fallback AED→XYZ.
    let hol_tracks = stagespace_engines::hol_parser::parse_hol_project(&content)?;

    let tracks = hol_tracks
        .into_iter()
        .map(|t| Track {
            id: t.id,
            name: t.name,
            position: t.position,
            color: t.color,
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
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    std::fs::write(&file_path, data).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn load_graph_from_file(file_path: String) -> Result<serde_json::Value, String> {
    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;
    let graph: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {e}"))?;
    Ok(graph)
}
