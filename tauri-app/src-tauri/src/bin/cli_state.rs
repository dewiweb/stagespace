//! État global du CLI — équivalent de l'AppState Tauri mais sans AppHandle.

use stagespace_engines::{AudioState, MergeRuntime, OscSender, Runtime};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Un movement = un runtime worker + metadata
#[allow(dead_code)]
pub struct CliMovement {
    pub id: String,
    pub name: String,
    pub runtime: Runtime,
    pub osc_ids: Vec<u32>,
    pub is_preview: bool,
    pub track_indices: Vec<usize>,
    pub thread_handle: Option<std::thread::JoinHandle<()>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HolTrack {
    pub id: u32,
    pub name: String,
    pub position: [f64; 3],
    pub color: String,
}

/// État global du CLI — persiste en mémoire pendant la session
pub struct CliState {
    pub audio_state: Arc<Mutex<AudioState>>,
    pub movements: Mutex<HashMap<String, CliMovement>>,
    pub merge_runtime: Mutex<MergeRuntime>,
    pub hol_tracks: Mutex<Vec<HolTrack>>,
    pub manual_osc_ids: Mutex<Vec<u32>>,
    /// Compteur pour générer des IDs uniques
    pub move_counter: Mutex<usize>,
}

impl CliState {
    pub fn new() -> Result<Self, String> {
        let osc_sender = OscSender::default();
        let merge_runtime = MergeRuntime::new("127.0.0.1".to_string(), 8000, osc_sender, 60.0)
            .map_err(|e| format!("Failed to create MergeRuntime: {e}"))?;

        Ok(Self {
            audio_state: Arc::new(Mutex::new(AudioState::default())),
            movements: Mutex::new(HashMap::new()),
            merge_runtime: Mutex::new(merge_runtime),
            hol_tracks: Mutex::new(Vec::new()),
            manual_osc_ids: Mutex::new(vec![1, 2, 3, 4, 5, 6, 7, 8]),
            move_counter: Mutex::new(0),
        })
    }

    /// OSC IDs disponibles (depuis .hol ou manuels)
    pub fn get_osc_ids(&self) -> Vec<u32> {
        let tracks = self.hol_tracks.lock().unwrap();
        if !tracks.is_empty() {
            tracks.iter().map(|t| t.id).collect()
        } else {
            self.manual_osc_ids.lock().unwrap().clone()
        }
    }

    /// Nombre de tracks
    pub fn track_count(&self) -> usize {
        let tracks = self.hol_tracks.lock().unwrap();
        if !tracks.is_empty() {
            tracks.len()
        } else {
            self.manual_osc_ids.lock().unwrap().len()
        }
    }

    /// Isobarycentre des tracks données par indice
    pub fn compute_centroid(&self, track_indices: &[usize]) -> [f64; 3] {
        let tracks = self.hol_tracks.lock().unwrap();
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
        let mut counter = self.move_counter.lock().unwrap();
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
