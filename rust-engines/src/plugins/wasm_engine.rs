use super::loader::Plugin;
use super::manifest::MAX_PARAMS_BYTES;
use super::PluginError;
use crate::engines::{finite_or_zero, Engine, EngineParams};
use nalgebra::Vector3;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use wasmtime::{Instance, Memory, Store, TypedFunc};

/// Budget de fuel par appel `plugin_position` — ~100k instructions wasm,
/// très au-delà de tout calcul de trajectoire légitime, mais suffisamment
/// bas pour qu'une boucle infinie trap en quelques ms au lieu de geler
/// le worker 60 FPS.
const FUEL_BUDGET: u64 = 100_000;

/// État wasmtime d'une instance de plugin — le `Store` n'est pas `Sync`,
/// d'où le Mutex (les appels `position` d'un même node sont séquentiels).
struct InstanceState {
    store: Store<()>,
    memory: Memory,
    params_ptr: TypedFunc<(), i32>,
    result_ptr: TypedFunc<(), i32>,
    position: TypedFunc<(f64, i32, i32, f64, i32), ()>,
}

/// Engine adossé à un plugin WASM — implémente le trait `Engine` standard,
/// donc transparent pour le compiler/runtime une fois construit.
///
/// Toute défaillance invité (trap, fuel épuisé, buffer hors limites) retourne
/// une position zero : jamais de panic ni de propagation vers la boucle
/// temps réel. La première erreur est loguée via `log_plugin_error`.
pub struct PluginEngine {
    plugin: Arc<Plugin>,
    state: Mutex<InstanceState>,
    error_logged: AtomicBool,
}

impl PluginEngine {
    /// Instancie le module du plugin et vérifie les signatures ABI v1.
    pub fn new(plugin: Arc<Plugin>, engine: &wasmtime::Engine) -> Result<Self, PluginError> {
        let mut store = Store::new(engine, ());
        let instance = Instance::new(&mut store, &plugin.module, &[])
            .map_err(|e| PluginError::Runtime(e.to_string()))?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| PluginError::MissingExport("memory".to_string()))?;
        let params_ptr = instance
            .get_typed_func::<(), i32>(&mut store, "plugin_params_ptr")
            .map_err(|e| PluginError::MissingExport(format!("plugin_params_ptr: {e}")))?;
        let result_ptr = instance
            .get_typed_func::<(), i32>(&mut store, "plugin_result_ptr")
            .map_err(|e| PluginError::MissingExport(format!("plugin_result_ptr: {e}")))?;
        let position = instance
            .get_typed_func::<(f64, i32, i32, f64, i32), ()>(&mut store, "plugin_position")
            .map_err(|e| PluginError::MissingExport(format!("plugin_position: {e}")))?;

        Ok(Self {
            plugin,
            state: Mutex::new(InstanceState {
                store,
                memory,
                params_ptr,
                result_ptr,
                position,
            }),
            error_logged: AtomicBool::new(false),
        })
    }

    /// Logue la première erreur runtime seulement — à 60 FPS un log par
    /// appel inonderait la sortie pour un plugin systématiquement en trap.
    fn log_once(&self, msg: &str) {
        if !self.error_logged.swap(true, Ordering::Relaxed) {
            crate::logging::log_plugin_error(&self.plugin.manifest.id, msg);
        }
    }
}

impl Engine for PluginEngine {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let st = &mut *guard;

        // Fuel reset à chaque appel — un trap "all fuel consumed" sur un
        // frame ne doit pas empêcher les frames suivantes.
        let _ = st.store.set_fuel(FUEL_BUDGET);

        let params_json = match serde_json::to_vec(&params.extra) {
            Ok(v) => v,
            Err(e) => {
                self.log_once(&format!("params serialization failed: {e}"));
                return Vector3::zeros();
            }
        };
        if params_json.len() > MAX_PARAMS_BYTES {
            self.log_once("params JSON exceeds 64KB buffer");
            return Vector3::zeros();
        }

        let params_ptr = match st.params_ptr.call(&mut st.store, ()) {
            Ok(p) if p >= 0 => p as usize,
            Ok(_) => {
                self.log_once("plugin_params_ptr returned negative offset");
                return Vector3::zeros();
            }
            Err(e) => {
                self.log_once(&format!("plugin_params_ptr trapped: {e}"));
                return Vector3::zeros();
            }
        };
        if params_ptr + params_json.len() > st.memory.data_size(&st.store) {
            self.log_once("params buffer overflows wasm memory");
            return Vector3::zeros();
        }
        if let Err(e) = st.memory.write(&mut st.store, params_ptr, &params_json) {
            self.log_once(&format!("params write failed: {e}"));
            return Vector3::zeros();
        }

        let call = st.position.call(
            &mut st.store,
            (
                t,
                object_index as i32,
                params.n_objects as i32,
                params.duration,
                params_json.len() as i32,
            ),
        );
        if let Err(e) = call {
            self.log_once(&format!("plugin_position trapped: {e}"));
            return Vector3::zeros();
        }

        let result_ptr = match st.result_ptr.call(&mut st.store, ()) {
            Ok(p) if p >= 0 => p as usize,
            _ => {
                self.log_once("plugin_result_ptr failed");
                return Vector3::zeros();
            }
        };
        let mut buf = [0u8; 24];
        if st.memory.read(&st.store, result_ptr, &mut buf).is_err() {
            self.log_once("result buffer overflows wasm memory");
            return Vector3::zeros();
        }

        finite_or_zero(Vector3::new(
            f64::from_le_bytes(buf[0..8].try_into().unwrap_or_default()),
            f64::from_le_bytes(buf[8..16].try_into().unwrap_or_default()),
            f64::from_le_bytes(buf[16..24].try_into().unwrap_or_default()),
        ))
    }

    /// Convention des engines : `name()` retourne l'identifiant ("circular",
    /// "lemniscate"…) — le `manifest.name` est le display name pour l'UI.
    #[allow(clippy::misnamed_getters)]
    fn name(&self) -> &str {
        &self.plugin.manifest.id
    }
}
