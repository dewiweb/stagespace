//! Commands plugins WASM — listing du registry, re-scan à chaud, chemin du
//! dossier plugins. Les erreurs de chargement sont rapportées dans le report
//! (jamais fatales) : le frontend les affiche en toasts.

use crate::commands::error::IpcError;
use crate::commands::state::{lock_or_recover, Shared};
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
///
/// `spawn_blocking` : le scan compile un Module wasmtime par bundle —
/// travail CPU lourd, inline il bloquerait un thread de l'executor async
/// (convention `graph_updates.rs`).
#[tauri::command]
pub async fn reload_plugins(state: State<'_, AppState>) -> Result<PluginRegistryReport, IpcError> {
    let shared = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        if let (Some(registry), Some(dir)) = (&shared.plugin_registry, &shared.plugins_dir) {
            let mut reg = lock_or_recover(registry);
            reg.scan_dir(dir);
        }
        registry_report(shared.plugin_registry.as_ref(), shared.plugins_dir.as_ref())
    })
    .await
    .map_err(|e| IpcError::internal(format!("reload task failed: {e}")))
}

/// Taille max d'un `.ssx` à l'import — même borne que le loader.
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Copie `src` dans `dir` sous son nom de fichier — protections :
/// taille bornée (même cap que le loader), `file_name` seul (pas de
/// traversal), et **src == dest** (l'utilisateur a choisi un `.ssx` déjà
/// dans le dossier plugins) → la copie est sautée, sinon `fs::copy`
/// tronquerait le fichier AVANT de le lire.
fn install_bundle(src: &std::path::Path, dir: &std::path::Path) -> Result<(), IpcError> {
    let file_name = src
        .file_name()
        .ok_or_else(|| IpcError::validation("Invalid plugin path".to_string()))?;

    // Source illisible = erreur — pas de "succès" silencieux.
    let size = std::fs::metadata(src)
        .map_err(|e| IpcError::validation(format!("Cannot read plugin file: {e}")))?
        .len();
    if size > MAX_IMPORT_BYTES {
        return Err(IpcError::validation(format!(
            "Plugin bundle too large ({size} bytes > {MAX_IMPORT_BYTES})"
        )));
    }

    // file_name ne peut pas contenir de séparateur → pas de traversal.
    let dest = dir.join(file_name);
    // Un symlink `dest` déposé dans le dossier plugins ferait écrire
    // `fs::copy` sur sa cible — refus explicite plutôt qu'écrasement.
    if std::fs::symlink_metadata(&dest)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(IpcError::validation(format!(
            "Refusing to overwrite symlink: {}",
            dest.display()
        )));
    }
    // canonicalize résout les ./.. et symlinks pour la comparaison. Si dest
    // n'existe pas encore (cas normal) → chemins différents → copie.
    let same_file = std::fs::canonicalize(src).ok() == std::fs::canonicalize(&dest).ok();
    if !same_file {
        std::fs::copy(src, &dest)
            .map_err(|e| IpcError::io(format!("Failed to copy plugin: {e}")))?;
    }
    Ok(())
}

/// Importe un bundle `.ssx` : validation, puis copie dans le dossier
/// plugins + rescan. Un bundle invalide ou un `manifest.id` déjà installé
/// sont **refusés avant la copie** — pas de fichier reliquat qui
/// re-échouerait silencieusement à chaque scan futur.
///
/// `spawn_blocking` : copie fichier + scan (compile un Module par bundle)
/// hors de l'executor async — convention `graph_updates.rs`.
#[tauri::command]
pub async fn import_plugin(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<PluginRegistryReport, IpcError> {
    if !std::path::Path::new(&source_path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("ssx"))
    {
        return Err(IpcError::validation(
            "Expected a .ssx plugin bundle".to_string(),
        ));
    }

    let shared = Shared::from_state(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let dir = shared
            .plugins_dir
            .as_ref()
            .ok_or_else(|| IpcError::internal("Plugin directory unavailable".to_string()))?
            .clone();
        // Sans registry (wasmtime indisponible) la copie n'a aucun effet
        // observable → erreur explicite plutôt qu'un "Plugin imported" faux.
        let registry = shared
            .plugin_registry
            .as_ref()
            .ok_or_else(|| IpcError::internal("Plugin registry unavailable".to_string()))?;

        let src = std::path::Path::new(&source_path);
        let mut reg = lock_or_recover(registry);
        // Validation AVANT copie : un bundle invalide n'a pas sa place dans
        // le dossier (reliquat cassé à vie), et un id déjà pris échouerait
        // au scan en "duplicate id" — refus explicite ici, sans copie.
        let manifest = reg
            .validate_bundle(src)
            .map_err(|e| IpcError::validation(format!("Invalid plugin bundle: {e}")))?;
        if reg.get(&manifest.id).is_some() {
            return Err(IpcError::validation(format!(
                "Plugin '{}' is already installed — remove it from the plugins folder first",
                manifest.id
            )));
        }

        install_bundle(src, &dir)?;

        reg.scan_dir(&dir);
        drop(reg);
        Ok(registry_report(
            shared.plugin_registry.as_ref(),
            shared.plugins_dir.as_ref(),
        ))
    })
    .await
    .map_err(|e| IpcError::internal(format!("import task failed: {e}")))?
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

    /// Importer un `.ssx` déjà dans le dossier plugins : src == dest → la
    /// copie est sautée, le fichier n'est PAS tronqué (fs::copy sur le même
    /// fichier le réduirait à 0 octet avant lecture).
    #[test]
    fn install_bundle_same_file_is_noop_not_destructive() {
        let dir = std::env::temp_dir().join(format!("ssx-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("already-here.ssx");
        std::fs::write(&file, b"zip-content").expect("write");

        install_bundle(&file, &dir).expect("install");

        let content = std::fs::read(&file).expect("read");
        assert_eq!(
            content, b"zip-content",
            "same-file import must not truncate"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Source inexistante → erreur de validation, pas de "succès" silencieux.
    #[test]
    fn install_bundle_missing_source_errors() {
        let dir = std::env::temp_dir().join(format!("ssx-import-miss-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let src = dir.join("does-not-exist.ssx");
        assert!(install_bundle(&src, &dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// `dest` symlink dans le dossier plugins → refus : `fs::copy` écrirait
    /// sur la cible du lien. La cible reste intacte.
    #[test]
    #[cfg(unix)]
    fn install_bundle_refuses_symlink_dest() {
        let base = std::env::temp_dir().join(format!("ssx-symlink-{}", std::process::id()));
        let src_dir = base.join("src");
        let dst_dir = base.join("plugins");
        std::fs::create_dir_all(&src_dir).expect("src dir");
        std::fs::create_dir_all(&dst_dir).expect("dst dir");
        let src = src_dir.join("plugin.ssx");
        std::fs::write(&src, b"bundle-bytes").expect("write src");
        let target = base.join("victim.txt");
        std::fs::write(&target, b"keep-me").expect("write target");
        std::os::unix::fs::symlink(&target, dst_dir.join("plugin.ssx")).expect("symlink");

        assert!(install_bundle(&src, &dst_dir).is_err());
        assert_eq!(std::fs::read(&target).expect("read target"), b"keep-me");

        std::fs::remove_dir_all(&base).ok();
    }

    /// Copie réelle d'un fichier externe dans le dossier plugins.
    #[test]
    fn install_bundle_copies_external_file() {
        let base = std::env::temp_dir().join(format!("ssx-import-copy-{}", std::process::id()));
        let src_dir = base.join("src");
        let dst_dir = base.join("plugins");
        std::fs::create_dir_all(&src_dir).expect("src dir");
        std::fs::create_dir_all(&dst_dir).expect("dst dir");
        let src = src_dir.join("plugin.ssx");
        std::fs::write(&src, b"bundle-bytes").expect("write");

        install_bundle(&src, &dst_dir).expect("install");
        assert_eq!(
            std::fs::read(dst_dir.join("plugin.ssx")).expect("read dest"),
            b"bundle-bytes"
        );

        std::fs::remove_dir_all(&base).ok();
    }
}
