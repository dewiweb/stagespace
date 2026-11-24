use crate::{AppState, Movement};
use stagespace_engines::{AudioState, MergeRuntime, OscReceiver};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, MutexGuard};

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

/// Sink d'événements vers l'UI — closure agnostique du runtime (Wry en
/// prod, MockRuntime dans les tests headless, aucun dans la CLI). Le
/// backend n'a pas besoin d'une webview vivante pour émettre : positions,
/// logs show-control, toasts et resyncs doivent fonctionner headless.
pub type EventSink = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

/// Émet un event vers l'UI via le sink — no-op silencieux si aucun n'est
/// branché (headless pur : CLI, tests unitaires sans frontend).
pub fn emit_ui<T: serde::Serialize>(sink: &Arc<Mutex<Option<EventSink>>>, event: &str, payload: T) {
    let target = lock_or_recover(sink).clone();
    if let Some(f) = target {
        if let Ok(v) = serde_json::to_value(&payload) {
            f(event, v);
        }
    }
}

/// Handles clonables vers l'état partagé de l'app — pour les `spawn_blocking`
/// qui ne peuvent pas capturer `State<'_, AppState>` (non 'static).
///
/// Ordre des locks (à respecter partout pour éviter les deadlocks) :
/// `pending_move_ids` → `movements` → `merge_runtime` → `osc_receiver`.
#[derive(Clone)]
pub struct Shared {
    pub audio_state: Arc<Mutex<AudioState>>,
    pub event_sink: Arc<Mutex<Option<EventSink>>>,
    pub movements: Arc<Mutex<HashMap<String, Movement>>>,
    pub pending_move_ids: Arc<Mutex<HashSet<String>>>,
    pub move_generation: Arc<AtomicU64>,
    pub merge_runtime: Arc<Mutex<MergeRuntime>>,
    pub recall_in_progress: Arc<AtomicBool>,
    /// Compteur de panic/deactivate — incrémenté par `deactivate_all_moves`.
    /// Un recall qui détecte un panic mid-flight doit s'avorter : le panic
    /// gagne toujours, jamais de respawn après un arrêt d'urgence.
    pub deactivate_gen: Arc<AtomicU64>,
    /// Transport du séquenceur score — un panic (deactivate_all sans
    /// honorer les fins) doit tuer sa génération : l'arrêt d'urgence
    /// fait taire le show, le score ne re-tire rien.
    pub score_timeline: Arc<Mutex<crate::commands::score::ScoreTimeline>>,
    /// Cible OSC out (renderer) — fallback des clips `OscOut`.
    pub osc_out_target: Arc<Mutex<(String, u16)>>,
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
            event_sink: state.event_sink.clone(),
            movements: state.movements.clone(),
            pending_move_ids: state.pending_move_ids.clone(),
            move_generation: state.move_generation.clone(),
            merge_runtime: state.merge_runtime.clone(),
            recall_in_progress: state.recall_in_progress.clone(),
            deactivate_gen: state.deactivate_gen.clone(),
            score_timeline: state.score_timeline.clone(),
            osc_out_target: state.osc_out_target.clone(),
            osc_receiver: state.osc_receiver.clone(),
            plugin_registry: state.plugin_registry.clone(),
            plugins_dir: state.plugins_dir.clone(),
        }
    }
}
