//! État global du CLI — wrappe le `Shared` du backend Tauri.
//!
//! Le CLI utilise le même MoveService que l'app (`commands::merge_commands::
//! spawn_move` / `remove_move_now`) via `state.shared` — pas de fork des
//! chemins de spawn/stop. `app_handle` est `None` en headless : les events
//! Tauri sont simplement skipés.

use stagespace_engines::{AudioState, MergeRuntime, OscReceiver, OscSender};
use stagespace_tauri::commands::state::Shared;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HolTrack {
    pub id: u32,
    pub name: String,
    pub position: [f64; 3],
    pub color: String,
}

/// État global du CLI — persiste en mémoire pendant la session
pub struct CliState {
    /// État moteur partagé — même struct que l'AppState Tauri
    /// (`Shared::from_state`), avec `app_handle: None` (headless).
    /// movements/pending/generation/recall vivent dedans : les guards
    /// anti-doublon et anti-race du MoveService s'appliquent aussi au CLI.
    pub shared: Shared,
    pub hol_tracks: Mutex<Vec<HolTrack>>,
    pub manual_osc_ids: Mutex<Vec<u32>>,
    /// Compteur pour générer des IDs uniques
    pub move_counter: Mutex<usize>,
}

impl CliState {
    pub fn new() -> Result<Self, String> {
        let osc_sender = OscSender::default();
        // AudioState maître partagé avec le merge (même pattern que l'app).
        let audio_state = Arc::new(Mutex::new(AudioState::default()));
        let merge_runtime = Arc::new(Mutex::new(
            MergeRuntime::new_with_audio_state(
                "127.0.0.1".to_string(),
                8000,
                osc_sender,
                60.0,
                audio_state.clone(),
            )
            .map_err(|e| format!("Failed to create MergeRuntime: {e}"))?,
        ));

        // Receiver OSC IN — connecté aux destinations du MergeRuntime
        // (macros, canaux, positions manuelles). Socket non démarré par défaut
        // (osc-in start --port N) mais handle_message fonctionne (osc-inject).
        let osc_receiver = OscReceiver::new(8001);
        osc_receiver.set_targets(
            merge_runtime
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .osc_in_targets(),
        );

        let shared = Shared {
            audio_state,
            app_handle: Arc::new(Mutex::new(None)),
            movements: Arc::new(Mutex::new(HashMap::new())),
            pending_move_ids: Arc::new(Mutex::new(HashSet::new())),
            move_generation: Arc::new(AtomicU64::new(0)),
            merge_runtime,
            recall_in_progress: Arc::new(AtomicBool::new(false)),
            osc_receiver: Arc::new(Mutex::new(osc_receiver)),
            plugin_registry: None,
        };

        Ok(Self {
            shared,
            hol_tracks: Mutex::new(Vec::new()),
            manual_osc_ids: Mutex::new(vec![1, 2, 3, 4, 5, 6, 7, 8]),
            move_counter: Mutex::new(0),
        })
    }

    /// OSC IDs disponibles (depuis .hol ou manuels)
    pub fn get_osc_ids(&self) -> Vec<u32> {
        let tracks = self.hol_tracks.lock().unwrap_or_else(|e| e.into_inner());
        if !tracks.is_empty() {
            tracks.iter().map(|t| t.id).collect()
        } else {
            self.manual_osc_ids
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        }
    }

    /// Nombre de tracks
    pub fn track_count(&self) -> usize {
        let tracks = self.hol_tracks.lock().unwrap_or_else(|e| e.into_inner());
        if !tracks.is_empty() {
            tracks.len()
        } else {
            self.manual_osc_ids
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .len()
        }
    }

    /// Isobarycentre des tracks données par indice
    pub fn compute_centroid(&self, track_indices: &[usize]) -> [f64; 3] {
        let tracks = self.hol_tracks.lock().unwrap_or_else(|e| e.into_inner());
        if tracks.is_empty() {
            return [0.0, 0.0, 0.0];
        }
        let mut sum = [0.0, 0.0, 0.0];
        let mut count = 0;
        for &idx in track_indices {
            if let Some(track) = tracks.get(idx) {
                sum[0] += track.position[0];
                sum[1] += track.position[1];
                sum[2] += track.position[2];
                count += 1;
            }
        }
        if count > 0 {
            [
                sum[0] / count as f64,
                sum[1] / count as f64,
                sum[2] / count as f64,
            ]
        } else {
            [0.0, 0.0, 0.0]
        }
    }

    /// Génère un ID unique pour un move (utilise le name si fourni)
    pub fn next_move_id(&self, key: &str) -> String {
        let mut counter = self.move_counter.lock().unwrap_or_else(|e| e.into_inner());
        *counter += 1;
        // Sanitize le key : lowercase, alphanum + hyphens
        let safe = key
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        format!("{safe}-{}", *counter)
    }
}

/// État global statique — une seule instance par processus CLI
static CLI_STATE: std::sync::OnceLock<CliState> = std::sync::OnceLock::new();

/// Initialise l'état global (appelé une fois au démarrage)
pub fn init_state() -> Result<(), String> {
    if CLI_STATE.get().is_some() {
        return Ok(());
    }
    let state = CliState::new()?;
    // On oublie l'erreur si déjà initialisé (race impossible — single-threaded init)
    let _ = CLI_STATE.set(state);
    Ok(())
}

/// Retourne une référence à l'état global
pub fn state() -> &'static CliState {
    CLI_STATE
        .get()
        .expect("CLI state not initialized — call init_state() first")
}
