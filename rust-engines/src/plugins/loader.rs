use super::manifest::PluginManifest;
use super::PluginError;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::Arc;

/// Un plugin chargé : manifeste validé + module wasm compilé.
/// Le `Module` wasmtime est Send+Sync et partageable — chaque node `Plugin`
/// du graphe en instancie un `PluginEngine` (Store propre) via le registry.
pub struct Plugin {
    pub manifest: PluginManifest,
    pub module: wasmtime::Module,
}

/// Exports requis par l'ABI v1 — vérifiés par nom au chargement ; les
/// signatures exactes sont vérifiées à l'instanciation (`get_typed_func`).
const REQUIRED_EXPORTS: &[&str] = &[
    "memory",
    "plugin_params_ptr",
    "plugin_result_ptr",
    "plugin_position",
];

/// Charge un bundle `.ssx` (zip) depuis un fichier.
pub fn load_bundle(engine: &wasmtime::Engine, path: &Path) -> Result<Arc<Plugin>, PluginError> {
    let bytes = std::fs::read(path)?;
    load_bundle_bytes(engine, &bytes)
        .map_err(|e| PluginError::Runtime(format!("{}: {e}", path.display())))
}

/// Charge un bundle `.ssx` depuis des bytes — le chemin n'est pas requis,
/// permet les tests in-memory et un futur chargement depuis d'autres sources.
pub fn load_bundle_bytes(
    engine: &wasmtime::Engine,
    bytes: &[u8],
) -> Result<Arc<Plugin>, PluginError> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| PluginError::Zip(e.to_string()))?;

    let mut manifest_json = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| PluginError::Zip("missing manifest.json".to_string()))?
        .read_to_string(&mut manifest_json)
        .map_err(PluginError::Io)?;

    let manifest: PluginManifest =
        serde_json::from_str(&manifest_json).map_err(|e| PluginError::Manifest(e.to_string()))?;
    manifest.validate().map_err(PluginError::Manifest)?;

    let mut wasm_bytes = Vec::new();
    archive
        .by_name("module.wasm")
        .map_err(|_| PluginError::Zip("missing module.wasm".to_string()))?
        .read_to_end(&mut wasm_bytes)
        .map_err(PluginError::Io)?;

    let module =
        wasmtime::Module::new(engine, &wasm_bytes).map_err(|e| PluginError::Wasm(e.to_string()))?;

    let export_names: Vec<&str> = module.exports().map(|e| e.name()).collect();
    for required in REQUIRED_EXPORTS {
        if !export_names.contains(required) {
            return Err(PluginError::MissingExport(format!(
                "'{required}' (ABI v1 requires: {REQUIRED_EXPORTS:?})"
            )));
        }
    }

    Ok(Arc::new(Plugin { manifest, module }))
}
