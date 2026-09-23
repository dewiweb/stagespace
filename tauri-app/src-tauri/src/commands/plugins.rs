//! Commands plugins WASM — listing du registry, re-scan à chaud, chemin du
//! dossier plugins. Les erreurs de chargement sont rapportées dans le report
//! (jamais fatales) : le frontend les affiche en toasts.

use crate::commands::error::IpcError;
use crate::commands::state::lock_or_recover;
use crate::AppState;
use serde::Serialize;
use stagespace_engines::PluginManifest;
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

fn current_report(state: &AppState) -> PluginRegistryReport {
    let (manifests, errors) = match &state.plugin_registry {
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
        plugins_dir: state.plugins_dir.as_ref().map(|d| d.display().to_string()),
    }
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
