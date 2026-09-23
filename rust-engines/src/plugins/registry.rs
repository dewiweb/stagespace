use super::loader::{load_bundle, Plugin};
use super::manifest::PluginManifest;
use super::PluginError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Registry des plugins WASM chargés — détenu par l'AppState, partagé en
/// `Arc` avec les closures compilées (via `LiveInputs::plugins`).
///
/// Les erreurs de chargement sont **collectées, pas fatales** : un plugin
/// cassé ne bloque pas les autres ni le démarrage de l'app.
pub struct PluginRegistry {
    engine: wasmtime::Engine,
    plugins: HashMap<String, Arc<Plugin>>,
    load_errors: Vec<(PathBuf, String)>,
}

impl PluginRegistry {
    /// Crée un registry vide avec le moteur wasmtime configuré (fuel activé
    /// — protection contre les boucles infinies dans le code invité).
    pub fn new() -> Result<Self, PluginError> {
        let mut config = wasmtime::Config::new();
        config.consume_fuel(true);
        let engine =
            wasmtime::Engine::new(&config).map_err(|e| PluginError::Runtime(e.to_string()))?;
        Ok(Self {
            engine,
            plugins: HashMap::new(),
            load_errors: Vec::new(),
        })
    }

    /// Scanne un dossier et charge tous les `.ssx` trouvés.
    /// Retourne le nombre de plugins chargés. Dossier absent = Ok(0).
    /// `errors()` reflète les erreurs du dernier scan (remise à zéro).
    pub fn scan_dir(&mut self, dir: &Path) -> usize {
        self.load_errors.clear();
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return 0,
        };
        let mut loaded = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("ssx") {
                continue;
            }
            match self.register_bundle(&path) {
                Ok(()) => loaded += 1,
                Err(e) => self.load_errors.push((path.clone(), e.to_string())),
            }
        }
        loaded
    }

    /// Charge un bundle `.ssx` depuis un fichier.
    pub fn register_bundle(&mut self, path: &Path) -> Result<(), PluginError> {
        let plugin = load_bundle(&self.engine, path)?;
        self.plugins.insert(plugin.manifest.id.clone(), plugin);
        Ok(())
    }

    /// Enregistre un plugin depuis ses composants — utilisé par les tests
    /// (WAT in-memory) et les futurs plugins embarqués dans le binaire.
    pub fn register_wasm(
        &mut self,
        manifest: PluginManifest,
        wasm: &[u8],
    ) -> Result<(), PluginError> {
        manifest.validate().map_err(PluginError::Manifest)?;
        let module = wasmtime::Module::new(&self.engine, wasm)
            .map_err(|e| PluginError::Wasm(e.to_string()))?;
        self.plugins
            .insert(manifest.id.clone(), Arc::new(Plugin { manifest, module }));
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<Arc<Plugin>> {
        self.plugins.get(id).cloned()
    }

    /// Manifestes de tous les plugins chargés — exposé au frontend via
    /// `list_plugins` pour la palette et les schemas de params dynamiques.
    pub fn manifests(&self) -> Vec<PluginManifest> {
        self.plugins.values().map(|p| p.manifest.clone()).collect()
    }

    /// Erreurs de chargement du dernier `scan_dir` — remontées en toasts.
    pub fn errors(&self) -> &[(PathBuf, String)] {
        &self.load_errors
    }

    pub(crate) fn wasm_engine(&self) -> &wasmtime::Engine {
        &self.engine
    }
}
