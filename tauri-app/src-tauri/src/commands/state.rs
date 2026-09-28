use crate::{AppState, Movement};
use stagespace_engines::{AudioState, MergeRuntime, OscReceiver};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::AppHandle;

/// Lock a mutex, recovering from poisoning instead of panicking.
///
/// Every Mutex access in the Tauri backend must go through this helper so that
/// a panic in one thread does not crash the whole app — we log a `[WARN]` and
/// continue with the poisoned (but still usable) inner data.
pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {e}");
        e.into_inner()
    })
}

/// Handles clonables vers l'état partagé de l'app — pour les `spawn_blocking`
/// qui ne peuvent pas capturer `State<'_, AppState>` (non 'static).
///
/// Ordre des locks (à respecter partout pour éviter les deadlocks) :
/// `pending_move_ids` → `movements` → `merge_runtime` → `osc_receiver`.
#[derive(Clone)]
pub struct Shared {
    pub audio_state: Arc<Mutex<AudioState>>,
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    pub movements: Arc<Mutex<HashMap<String, Movement>>>,
    pub pending_move_ids: Arc<Mutex<HashSet<String>>>,
    pub move_generation: Arc<AtomicU64>,
    pub merge_runtime: Arc<Mutex<MergeRuntime>>,
    pub recall_in_progress: Arc<AtomicBool>,
    pub osc_receiver: Arc<Mutex<OscReceiver>>,
    /// Registry des plugins WASM — None si wasmtime n'a pas pu s'initialiser.
    pub plugin_registry: Option<Arc<Mutex<stagespace_engines::PluginRegistry>>>,
    /// Dossier des bundles `.ssx` — nécessaire aux commands spawn_blocking.
    pub plugins_dir: Option<std::path::PathBuf>,
}

impl Shared {
    pub fn from_state(state: &AppState) -> Self {
        Shared {
            audio_state: state.audio_state.clone(),
            app_handle: state.app_handle.clone(),
            movements: state.movements.clone(),
            pending_move_ids: state.pending_move_ids.clone(),
            move_generation: state.move_generation.clone(),
            merge_runtime: state.merge_runtime.clone(),
            recall_in_progress: state.recall_in_progress.clone(),
            osc_receiver: state.osc_receiver.clone(),
            plugin_registry: state.plugin_registry.clone(),
            plugins_dir: state.plugins_dir.clone(),
        }
    }
}
