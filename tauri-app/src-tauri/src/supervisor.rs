//! Superviseur backend — tourne dans un thread dédié, indépendant du
//! frontend (audit C5 + C7).
//!
//! Deux responsabilités :
//! - **C5** : drainer la file `stale_kill_ids` du MergeRuntime et arrêter
//!   réellement les workers zombies (`runtime.stop()` + retrait de
//!   `movements`). Sans ça, un worker déclaré stale continuait à brûler
//!   du CPU à 100 % indéfiniment — cascade de morts en show.
//! - **C7** : watchdog du merge thread. Avant, le restart était déclenché
//!   par `get_perf_stats` — un polling frontend. Une webview gelée
//!   laissait donc un blackout OSC définitif pendant que les moves
//!   restaient "actifs". Ici le backend se soigne tout seul.
//!
//! Ordre des locks respecté : `pending_move_ids` → `movements` →
//! `merge_runtime` → `osc_receiver` — jamais deux locks imbriqués dans le
//! mauvais sens (les drains se font sous lock court puis le travail
//! hors lock).

use crate::commands::state::{lock_or_recover, Shared};
use crate::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Cadence de supervision — assez rapide pour tuer un zombie avant qu'il
/// ne devienne audible (CPU/batterie), assez lente pour être négligeable.
const TICK: Duration = Duration::from_millis(250);

/// Backoff minimum entre deux restarts du merge — si le thread meurt
/// instantanément à chaque respawn (sink cassé, etc.), on ne boucle pas.
pub(crate) const RESTART_BACKOFF: Duration = Duration::from_secs(2);

/// Démarre le superviseur. Appelé une fois dans `.setup()` — le flag
/// `supervisor_shutdown` d'`AppState` l'arrête proprement à la fermeture.
pub fn start(state: &AppState) {
    let shared = Shared::from_state(state);
    let shutdown = state.supervisor_shutdown.clone();
    std::thread::Builder::new()
        .name("stagespace-supervisor".into())
        .spawn(move || {
            let mut last_restart = Instant::now() - RESTART_BACKOFF;
            loop {
                std::thread::sleep(TICK);
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                tick(&shared, &mut last_restart);
            }
        })
        .map(|_| ())
        .unwrap_or_else(|e| eprintln!("[SUPERVISOR] failed to spawn: {e}"));
}

fn tick(shared: &Shared, last_restart: &mut Instant) {
    drain_stale_kills(shared);
    supervise_merge(shared, last_restart);
}

/// C5 — arrêt réel des workers zombies.
pub(crate) fn drain_stale_kills(shared: &Shared) {
    // Lock merge court — drain puis release AVANT de toucher movements.
    let kills = lock_or_recover(&shared.merge_runtime).drain_stale_kills();
    if kills.is_empty() {
        return;
    }

    let mut stopped_zombies = false;
    let mut removed_ids: Vec<String> = Vec::new();
    {
        let mut movements = lock_or_recover(&shared.movements);
        for (id, stale_buf) in &kills {
            // Test d'identité : ne tuer que si le Movement courant possède
            // bien LE buffer que le merge a observé comme gelé. Un id
            // réutilisé par un move plus récent a un autre buffer → skip.
            let same_worker = movements
                .get(id)
                .and_then(|m| m.runtime.position_buffer_arc())
                .is_some_and(|b| Arc::ptr_eq(&b, stale_buf));
            if !same_worker {
                if movements.contains_key(id) {
                    eprintln!(
                        "[SUPERVISOR] stale-kill '{id}' ignoré — id réutilisé par un move plus récent"
                    );
                }
                continue;
            }
            if let Some(mv) = movements.remove(id) {
                let was_running = mv.runtime.is_running();
                eprintln!(
                    "[SUPERVISOR] move '{}' arrêté — worker {}",
                    mv.name,
                    if was_running {
                        "zombie (encore running, buffer gelé)"
                    } else {
                        "terminé (one-shot fini — nettoyage)"
                    }
                );
                mv.runtime.stop();
                removed_ids.push(id.clone());
                // Toast uniquement pour un vrai zombie — la fin naturelle
                // d'un one-shot est un comportement normal, pas une alerte.
                if was_running {
                    stopped_zombies = true;
                    if let Some(handle) = lock_or_recover(&shared.app_handle).clone() {
                        let _ = handle.emit("move-stale-killed", mv.name.clone());
                    }
                }
            }
        }
    }
    // pending_move_ids après movements (ordre respecté : non imbriqués,
    // libérés séquentiellement — pas de deadlock possible).
    if !removed_ids.is_empty() {
        let kill_ids: std::collections::HashSet<&str> =
            kills.iter().map(|(id, _)| id.as_str()).collect();
        lock_or_recover(&shared.pending_move_ids).retain(|id| !kill_ids.contains(id.as_str()));
        // Le merge a déjà retiré les entrées — on resynchronise le
        // frontend sur la liste réelle des moves.
        if let Some(handle) = lock_or_recover(&shared.app_handle).clone() {
            let _ = handle.emit("active-moves-update", ());
        }
    }
    let _ = stopped_zombies;
}

/// C7 — watchdog du merge thread : restart sans dépendre du polling
/// frontend (`get_perf_stats`). Uniquement sur mort constatée
/// (`thread_died` ou `running=false` avec moves actifs) — jamais sur
/// simple lenteur : `stop()` join le thread et un thread deadlocké
/// gèlerait le superviseur lui-même en gardant le lock merge.
pub(crate) fn supervise_merge(shared: &Shared, last_restart: &mut Instant) {
    let mut merge = lock_or_recover(&shared.merge_runtime);
    if !merge.has_active_moves() {
        return;
    }
    let dead = merge.thread_died() || !merge.is_running();
    if !dead {
        return;
    }
    if last_restart.elapsed() < RESTART_BACKOFF {
        return; // backoff — évite la boucle de respawn
    }

    eprintln!("[SUPERVISOR] merge thread mort avec moves actifs — restart");
    match merge.start() {
        Ok(()) => {
            *last_restart = Instant::now();
            if let Some(handle) = lock_or_recover(&shared.app_handle).clone() {
                let _ = handle.emit("merge-restarted", ());
            }
        }
        Err(e) => {
            *last_restart = Instant::now(); // backoff aussi sur échec
            eprintln!("[SUPERVISOR] merge restart failed: {e}");
            if let Some(handle) = lock_or_recover(&shared.app_handle).clone() {
                let _ = handle.emit("merge-restart-failed", e.to_string());
            }
        }
    }
}
