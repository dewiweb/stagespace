use super::error::IpcError;
use super::state::lock_or_recover;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct HolProject {
    pub tracks: Vec<Track>,
    /// Données malformées/unsupported droppées pendant le parse — surfacées
    /// au frontend (toast) plutôt qu'avalées en silence.
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Track {
    pub id: u32,
    pub name: String,
    pub position: [f64; 3],
    pub color: String,
}

#[tauri::command]
pub async fn import_hol_project(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<HolProject, IpcError> {
    // Importer un .hol redéfinit le mapping track→osc_id — interdit pendant
    // le playback (les moves actifs routent via ce mapping).
    {
        let movements = lock_or_recover(&state.movements);
        if !movements.is_empty() {
            return Err(IpcError::conflict(
                "Cannot import a .hol project during playback. Stop all moves first.",
            ));
        }
    }
    tauri::async_runtime::spawn_blocking(move || read_hol_project(file_path))
        .await
        .map_err(|e| IpcError::internal(format!("Holophonix import task failed: {e}")))?
}

fn read_hol_project(file_path: String) -> Result<HolProject, IpcError> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| IpcError::io(format!("Failed to read file: {e}")))?;

    // Parser partagé (stagespace_engines::hol_parser) — une seule implémentation
    // du format .hol pour Tauri et le CLI : gère hol.ae / ae racine, couleurs
    // "#RRGGBB" et "r g b a", xyz groupé ou x/y/z séparés, fallback AED→XYZ.
    let (hol_tracks, warnings) =
        stagespace_engines::hol_parser::parse_hol_project_with_warnings(&content)
            .map_err(IpcError::validation)?;

    let tracks = hol_tracks
        .into_iter()
        .map(|t| Track {
            id: t.id,
            name: t.name,
            position: t.position,
            color: t.color,
        })
        .collect();

    Ok(HolProject { tracks, warnings })
}

#[tauri::command]
pub async fn save_graph_to_file(
    file_path: String,
    graph_json: serde_json::Value,
) -> Result<(), IpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = serde_json::to_string_pretty(&graph_json)
            .map_err(|e| IpcError::internal(format!("Failed to serialize: {e}")))?;
        std::fs::write(&file_path, data)
            .map_err(|e| IpcError::io(format!("Failed to write file: {e}")))?;
        Ok(())
    })
    .await
    .map_err(|e| IpcError::internal(format!("Graph save task failed: {e}")))?
}

#[tauri::command]
pub async fn load_graph_from_file(file_path: String) -> Result<serde_json::Value, IpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| IpcError::io(format!("Failed to read file: {e}")))?;
        let graph: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| IpcError::validation(format!("Failed to parse JSON: {e}")))?;
        Ok(graph)
    })
    .await
    .map_err(|e| IpcError::internal(format!("Graph load task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path() -> String {
        std::env::temp_dir()
            .join(format!("stagespace-file-{}.json", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn graph_file_commands_round_trip() {
        let path = test_path();
        let graph = serde_json::json!({"nodes": [{"id": "source"}], "edges": []});
        tauri::async_runtime::block_on(async {
            save_graph_to_file(path.clone(), graph.clone())
                .await
                .unwrap();
            assert_eq!(load_graph_from_file(path.clone()).await.unwrap(), graph);
        });
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn graph_file_commands_preserve_error_codes() {
        let path = test_path();
        tauri::async_runtime::block_on(async {
            assert_eq!(
                load_graph_from_file(path.clone()).await.unwrap_err().code,
                "io"
            );
            let missing_parent = format!("{path}/graph.json");
            assert_eq!(
                save_graph_to_file(missing_parent, serde_json::json!({}))
                    .await
                    .unwrap_err()
                    .code,
                "io"
            );
            std::fs::write(&path, "not JSON").unwrap();
            assert_eq!(
                load_graph_from_file(path.clone()).await.unwrap_err().code,
                "validation"
            );
        });
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn hol_import_preserves_tracks_and_errors() {
        let path = test_path();
        assert_eq!(read_hol_project(path.clone()).unwrap_err().code, "io");
        std::fs::write(&path, "not JSON").unwrap();
        assert_eq!(
            read_hol_project(path.clone()).unwrap_err().code,
            "validation"
        );
        std::fs::write(
            &path,
            r#"{"ae":["/track/2/name Test","/track/2/xyz 1 2 3"]}"#,
        )
        .unwrap();
        let project = read_hol_project(path.clone()).unwrap();
        assert_eq!(project.tracks.len(), 1);
        assert_eq!(project.tracks[0].id, 2);
        assert_eq!(project.tracks[0].name, "Test");
        assert_eq!(project.tracks[0].position, [1.0, 2.0, 3.0]);
        std::fs::remove_file(path).unwrap();
    }
}
