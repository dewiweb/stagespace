//! Commands plugins WASM — listing du registry, re-scan à chaud, chemin du
//! dossier plugins. Les erreurs de chargement sont rapportées dans le report
//! (jamais fatales) : le frontend les affiche en toasts.

use crate::commands::error::IpcError;
use crate::commands::state::lock_or_recover;
use crate::AppState;
use serde::Serialize;
use stagespace_engines::{PluginManifest, PluginRegistry};
use std::sync::{Arc, Mutex};
use tauri::State;
use ts_rs::TS;

/// État du registry exposé au frontend — manifestes des plugins chargés
/// (palette dynamique, schemas de params) + erreurs du dernier scan.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PluginRegistryReport {
    pub manifests: Vec<PluginManifest>,
    /// Erreurs du dernier scan, formatées "path: message".
    pub errors: Vec<String>,
    /// Dossier où déposer les bundles `.ssx` — None si wasmtime indisponible.
    pub plugins_dir: Option<String>,
}

fn registry_report(
    registry: Option<&Arc<Mutex<PluginRegistry>>>,
    plugins_dir: Option<&std::path::PathBuf>,
) -> PluginRegistryReport {
    let (manifests, errors) = match registry {
        Some(registry) => {
            let reg = lock_or_recover(registry);
            (
                reg.manifests(),
                reg.errors()
                    .iter()
                    .map(|(path, err)| format!("{}: {err}", path.display()))
                    .collect(),
            )
        }
        None => (Vec::new(), Vec::new()),
    };
    PluginRegistryReport {
        manifests,
        errors,
        plugins_dir: plugins_dir.map(|d| d.display().to_string()),
    }
}

fn current_report(state: &AppState) -> PluginRegistryReport {
    registry_report(state.plugin_registry.as_ref(), state.plugins_dir.as_ref())
}

/// Liste les plugins chargés + erreurs du dernier scan.
#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> Result<PluginRegistryReport, IpcError> {
    Ok(current_report(&state))
}

/// Re-scanne le dossier plugins — à appeler après ajout/suppression d'un
/// `.ssx`. Les moves déjà compilés gardent leur plugin snapshot ; les
/// nouvelles compilations voient le registry à jour.
#[tauri::command]
pub async fn reload_plugins(state: State<'_, AppState>) -> Result<PluginRegistryReport, IpcError> {
    if let (Some(registry), Some(dir)) = (&state.plugin_registry, &state.plugins_dir) {
        let mut reg = lock_or_recover(registry);
        reg.scan_dir(dir);
    }
    Ok(current_report(&state))
}

/// Importe un bundle `.ssx` : copie dans le dossier plugins + rescan.
/// Un bundle invalide n'échoue pas l'import — il est copié puis rapporté
/// dans `errors` du report (comme tout `.ssx` cassé du dossier), ce qui
/// permet à l'utilisateur de voir pourquoi son fichier est refusé.
#[tauri::command]
pub async fn import_plugin(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<PluginRegistryReport, IpcError> {
    let dir = state
        .plugins_dir
        .as_ref()
        .ok_or_else(|| IpcError::internal("Plugin directory unavailable".to_string()))?;
    let src = std::path::Path::new(&source_path);
    if src.extension().and_then(|e| e.to_str()) != Some("ssx") {
        return Err(IpcError::validation(
            "Expected a .ssx plugin bundle".to_string(),
        ));
    }
    let file_name = src
        .file_name()
        .ok_or_else(|| IpcError::validation("Invalid plugin path".to_string()))?;
    // file_name ne peut pas contenir de séparateur → pas de traversal.
    let dest = dir.join(file_name);
    std::fs::copy(src, &dest).map_err(|e| IpcError::io(format!("Failed to copy plugin: {e}")))?;

    if let Some(registry) = &state.plugin_registry {
        let mut reg = lock_or_recover(registry);
        reg.scan_dir(dir);
    }
    Ok(current_report(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dossier fixture : un `.ssx` valide (lemniscate compilé par le SDK,
    /// committé dans rust-engines) + un bundle cassé → le report liste le
    /// plugin et l'erreur sans échouer.
    #[test]
    fn registry_report_lists_plugins_and_errors() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../rust-engines/tests/fixtures/lemniscate.ssx");
        assert!(fixture.exists(), "fixture .ssx manquante: {fixture:?}");

        let dir = std::env::temp_dir().join(format!("ssx-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        std::fs::copy(&fixture, dir.join("lemniscate.ssx")).expect("copy fixture");
        std::fs::write(dir.join("broken.ssx"), b"not a zip").expect("write broken");

        let mut reg = PluginRegistry::new().expect("registry");
        reg.scan_dir(&dir);
        let reg = Arc::new(Mutex::new(reg));

        let report = registry_report(Some(&reg), Some(&dir));
        assert_eq!(report.manifests.len(), 1);
        assert_eq!(report.manifests[0].id, "lemniscate");
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0].contains("broken.ssx"));
        assert!(report.plugins_dir.is_some());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Registry absent (wasmtime indisponible) → report vide mais sain.
    #[test]
    fn registry_report_handles_missing_registry() {
        let report = registry_report(None, None);
        assert!(report.manifests.is_empty());
        assert!(report.errors.is_empty());
        assert!(report.plugins_dir.is_none());
    }
}
