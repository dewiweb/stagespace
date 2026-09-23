//! Système de plugins WASM — nodes custom embarqués dans des bundles `.ssx`.
//!
//! Voir `PLUGINS_WASM.md` pour le design complet. Résumé :
//! - un plugin = archive zip (`manifest.json` + `module.wasm`)
//! - ABI v1 : buffers statiques en mémoire linéaire, pas d'alloc invité
//! - sandbox : wasmtime + fuel, traps convertis en position zero
//! - côté graphe : un seul `NodeType::Plugin`, `params.plugin_id` désigne
//!   le plugin chargé depuis le `PluginRegistry`

mod loader;
mod manifest;
mod registry;
mod wasm_engine;

pub use loader::{load_bundle_bytes, Plugin};
pub use manifest::{
    PluginKind, PluginManifest, PluginParamDef, HOST_ABI_VERSION, MAX_PARAMS_BYTES,
};
pub use registry::PluginRegistry;
pub use wasm_engine::PluginEngine;

use std::fmt;

/// Erreurs du système de plugins (chargement de bundle, validation du
/// manifeste, compilation wasm, exports ABI manquants, trap à l'exécution).
#[derive(Debug)]
pub enum PluginError {
    Io(std::io::Error),
    Zip(String),
    Manifest(String),
    Wasm(String),
    MissingExport(String),
    Runtime(String),
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Zip(e) => write!(f, "invalid .ssx bundle: {e}"),
            Self::Manifest(e) => write!(f, "invalid manifest.json: {e}"),
            Self::Wasm(e) => write!(f, "wasm compile error: {e}"),
            Self::MissingExport(e) => write!(f, "missing wasm export: {e}"),
            Self::Runtime(e) => write!(f, "plugin runtime error: {e}"),
        }
    }
}

impl std::error::Error for PluginError {}

impl From<std::io::Error> for PluginError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
