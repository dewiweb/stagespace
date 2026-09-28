use super::loader::{load_bundle, Plugin};
use super::manifest::PluginManifest;
use super::PluginError;
use std::collections::{HashMap, HashSet};
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

/// Nombre max de bundles scannés par scan_dir — au-delà les fichiers sont
/// ignorés (protection contre un dossier plugins rempli de milliers de
/// fichiers qui bloquerait le démarrage à compiler chaque module).
const MAX_SCAN_ENTRIES: usize = 256;

impl PluginRegistry {
    /// Crée un registry vide avec le moteur wasmtime durci pour l'ABI v1 :
    /// fuel (anti boucle infinie) + proposals inutiles désactivées —
    /// déterminisme strict et surface d'attaque réduite.
    pub fn new() -> Result<Self, PluginError> {
        let mut config = wasmtime::Config::new();
        config.consume_fuel(true);
        config.wasm_threads(false);
        config.wasm_multi_memory(false);
        config.wasm_relaxed_simd(false);
        let engine =
            wasmtime::Engine::new(&config).map_err(|e| PluginError::Runtime(e.to_string()))?;
        Ok(Self {
            engine,
            plugins: HashMap::new(),
            load_errors: Vec::new(),
        })
    }

    /// Scanne un dossier : charge les `.ssx` trouvés et **retire les
    /// plugins dont le fichier a disparu** (désinstallation réelle au
    /// rescan). Les plugins sans `origin` (register_wasm — tests, futurs
    /// embarqués) sont préservés.
    ///
    /// Retourne le nombre de plugins chargés. Dossier absent = Ok(0).
    /// `errors()` reflète les erreurs du dernier scan (remise à zéro).
    /// Un `manifest.id` déjà pris par un autre fichier du scan → erreur
    /// collectée (first-wins déterministe par ordre alphabétique).
    pub fn scan_dir(&mut self, dir: &Path) -> usize {
        self.load_errors.clear();
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return 0,
        };

        // Les plugins file-based sous `dir` vont être re-chargés ou
        // supprimés — on retire ceux dont l'origine est dans ce dossier.
        self.plugins.retain(|_, p| {
            p.origin
                .as_ref()
                .map(|o| o.parent() != Some(dir))
                .unwrap_or(true)
        });

        // Ordre alphabétique → first-wins déterministe sur les doublons d'id.
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("ssx"))
            })
            .collect();
        paths.sort();
        paths.truncate(MAX_SCAN_ENTRIES);

        let mut loaded = 0;
        let mut seen_ids: HashSet<String> = HashSet::new();
        for path in paths {
            match load_bundle(&self.engine, &path) {
                Ok(plugin) => {
                    let id = plugin.manifest.id.clone();
                    if !seen_ids.insert(id.clone()) {
                        self.load_errors.push((
                            path.clone(),
                            format!("duplicate plugin id '{id}' — ignored"),
                        ));
                        continue;
                    }
                    self.plugins.insert(id, plugin);
                    loaded += 1;
                }
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
        // Même validation que les bundles .ssx : zéro import, exports
        // requis (dont plugin_inputs_ptr pour abi_version 2), mémoire bornée.
        let module = super::loader::validate_module(&self.engine, wasm, manifest.abi_version)?;
        self.plugins.insert(
            manifest.id.clone(),
            Arc::new(Plugin {
                manifest,
                module,
                origin: None,
            }),
        );
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<Arc<Plugin>> {
        self.plugins.get(id).cloned()
    }

    /// Manifestes de tous les plugins chargés, triés par id — ordre stable
    /// pour la palette entre deux scans (HashMap itère en ordre arbitraire).
    /// Exposé au frontend via `list_plugins`.
    pub fn manifests(&self) -> Vec<PluginManifest> {
        let mut v: Vec<PluginManifest> =
            self.plugins.values().map(|p| p.manifest.clone()).collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    /// Erreurs de chargement du dernier `scan_dir` — remontées en toasts.
    pub fn errors(&self) -> &[(PathBuf, String)] {
        &self.load_errors
    }

    pub(crate) fn wasm_engine(&self) -> &wasmtime::Engine {
        &self.engine
    }
}
