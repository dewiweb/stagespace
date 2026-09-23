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
    /// Fichier `.ssx` d'origine — `scan_dir` l'utilise pour retirer les
    /// plugins dont le bundle a été supprimé. `None` pour `register_wasm`
    /// (tests, futurs plugins embarqués).
    pub origin: Option<std::path::PathBuf>,
}

/// Exports requis par l'ABI v1 — vérifiés par nom au chargement ; les
/// signatures exactes sont vérifiées à l'instanciation (`get_typed_func`).
const REQUIRED_EXPORTS: &[&str] = &[
    "memory",
    "plugin_params_ptr",
    "plugin_result_ptr",
    "plugin_position",
];

/// Taille max du fichier `.ssx` sur disque — un plugin de trajectoire est
/// typiquement < 1 MB ; 64 MB laisse très large sans permettre un fichier
/// arbitrairement gros (copy/read non bornés = DoS).
const MAX_BUNDLE_BYTES: u64 = 64 * 1024 * 1024;
/// Caps de décompression anti zip-bomb : le manifeste est du JSON
/// déclaratif (256 KB très large), le module wasm ≤ 16 MB.
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_WASM_BYTES: u64 = 16 * 1024 * 1024;
/// Cap mémoire linéaire du module — l'ABI n'a besoin que des buffers
/// statiques (~64 KB). Un `memory.grow` n'est pas bridé par le fuel :
/// sans borne un plugin peut commiter des GiB de RAM host en une
/// instruction. 32 pages = 2 MiB de min par mémoire déclarée.
const MAX_MEMORY_PAGES: u64 = 512; // 512 × 64 KiB = 32 MiB

/// Charge un bundle `.ssx` (zip) depuis un fichier.
pub fn load_bundle(engine: &wasmtime::Engine, path: &Path) -> Result<Arc<Plugin>, PluginError> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_BUNDLE_BYTES {
        return Err(PluginError::Zip(format!(
            "bundle too large ({size} bytes > {MAX_BUNDLE_BYTES})"
        )));
    }
    let bytes = std::fs::read(path)?;
    let mut plugin = load_bundle_bytes(engine, &bytes)?;
    // Arc fraîchement créé — get_mut ne peut pas échouer, mais on reste
    // tolérant : sans origin le plugin ne serait pas nettoyé au rescan.
    if let Some(p) = Arc::get_mut(&mut plugin) {
        p.origin = Some(path.to_path_buf());
    }
    Ok(plugin)
}

/// Charge un bundle `.ssx` depuis des bytes — le chemin n'est pas requis,
/// permet les tests in-memory et un futur chargement depuis d'autres sources.
pub fn load_bundle_bytes(
    engine: &wasmtime::Engine,
    bytes: &[u8],
) -> Result<Arc<Plugin>, PluginError> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| PluginError::Zip(e.to_string()))?;

    let manifest_json = {
        let entry = archive
            .by_name("manifest.json")
            .map_err(|_| PluginError::Zip("missing manifest.json".to_string()))?;
        let mut s = String::new();
        entry
            .take(MAX_MANIFEST_BYTES)
            .read_to_string(&mut s)
            .map_err(PluginError::Io)?;
        s
    };

    let manifest: PluginManifest =
        serde_json::from_str(&manifest_json).map_err(|e| PluginError::Manifest(e.to_string()))?;
    manifest.validate().map_err(PluginError::Manifest)?;

    let wasm_bytes = {
        let entry = archive
            .by_name("module.wasm")
            .map_err(|_| PluginError::Zip("missing module.wasm".to_string()))?;
        let mut v = Vec::new();
        entry
            .take(MAX_WASM_BYTES)
            .read_to_end(&mut v)
            .map_err(PluginError::Io)?;
        v
    };

    let module = validate_module(engine, &wasm_bytes)?;

    Ok(Arc::new(Plugin {
        manifest,
        module,
        origin: None,
    }))
}

/// Compile un module wasm et applique les règles de sécurité ABI v1 :
/// zéro import (sandbox total), exports requis présents, mémoire bornée
/// (shared/64-bit/minimum excessif rejetés). Partagé par `load_bundle` et
/// `PluginRegistry::register_wasm` — les deux chemins de chargement
/// appliquent les mêmes garanties.
///
/// Le `StoreLimiter` à l'instanciation borne le `memory.grow` dynamique —
/// les deux couches se complètent.
pub fn validate_module(
    engine: &wasmtime::Engine,
    wasm_bytes: &[u8],
) -> Result<wasmtime::Module, PluginError> {
    let module =
        wasmtime::Module::new(engine, wasm_bytes).map_err(|e| PluginError::Wasm(e.to_string()))?;

    // ABI v1 = zéro import : le sandbox est total (aucune fonction host).
    // Un module demandant un import échouerait à chaque instanciation —
    // rejet au load pour une erreur claire dès le scan.
    if let Some(import) = module.imports().next() {
        return Err(PluginError::Wasm(format!(
            "module imports are not allowed in ABI v1 (found '{}' in '{}')",
            import.name(),
            import.module()
        )));
    }

    let export_names: Vec<&str> = module.exports().map(|e| e.name()).collect();
    for required in REQUIRED_EXPORTS {
        if !export_names.contains(required) {
            return Err(PluginError::MissingExport(format!(
                "'{required}' (ABI v1 requires: {REQUIRED_EXPORTS:?})"
            )));
        }
    }

    for export in module.exports() {
        if let wasmtime::ExternType::Memory(mem) = export.ty() {
            if mem.is_shared() {
                return Err(PluginError::Wasm("shared memory not allowed".to_string()));
            }
            if mem.is_64() {
                return Err(PluginError::Wasm("memory64 not allowed".to_string()));
            }
            if mem.minimum() > MAX_MEMORY_PAGES {
                return Err(PluginError::Wasm(format!(
                    "memory minimum {} pages exceeds {} page cap",
                    mem.minimum(),
                    MAX_MEMORY_PAGES
                )));
            }
        }
    }

    Ok(module)
}
