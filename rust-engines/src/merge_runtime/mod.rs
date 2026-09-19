//! MergeRuntime — thread unique qui merge les positions de tous les workers,
//! applique les macros spatiales (scale, rotation, shift, radius_scale, height_offset, depth),
//! et envoie l'OSC.
//!
//! Architecture hybride :
//! - Workers (Runtime existants) : évaluent f(t,i) en parallèle, écrivent dans PositionBuffer
//! - MergeRuntime (ce fichier) : lit tous les buffers, merge, post-process, OSC
//!
//! Le MergeRuntime ne gère PAS :
//! - speed (per-move, dans les workers)
//! - loop_mode, direction (per-move, dans les workers)
//! - phase_offset (per-move, dans les workers)
//! - fade in/out du cycle (per-move, dans les workers)
//!
//! Le MergeRuntime gère :
//! - Merge : résoudre les conflits quand plusieurs moves ciblent le même track
//! - Macros spatiales : scale, rotation, shift, radius_scale, height_offset (globales)
//! - Depth : per-track (appliqué post-merge)
//! - Origin : isobarycentre des tracks
//! - OSC output : une seule socket
//! - Callback : un seul event Tauri pour le 3D preview

mod helpers;
mod move_state;
#[cfg(test)]
mod tests;

pub use helpers::{default_post_process_fn, merge_positions, MoveEntry};
pub use move_state::{MergeStrategy, MoveState};

use crate::audio::AudioState;
use crate::kinematics::{apply_modulations, ChannelModulation, KinematicState};
use crate::osc_sender::{OscSender, SpatialChannels};
use crate::position_buffer::PositionBuffer;
use crate::runtime::{
    MacroState, PerfMonitor, PerfStats, PositionCallback, PostProcessContext, PostProcessFn,
};
use rosc::{OscMessage, OscPacket, OscType};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// Runtime global qui merge les positions de tous les workers.
///
/// Une seule thread, une seule socket OSC. Lit les PositionBuffers de tous les
/// moves actifs, merge les positions, applique les macros spatiales, envoie l'OSC.
pub struct MergeRuntime {
    thread: Option<std::thread::JoinHandle<()>>,
    running: Arc<AtomicBool>,
    /// Buffers par move ID
    move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
    /// États des moves actifs
    active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
    /// Macros spatiales (scale, rotation, shift, radius_scale, height_offset)
    /// PAS speed — speed reste per-move dans les workers
    macros: Arc<MacroState>,
    /// Audio state partagé (pour les audio mods qui agissent sur les macros spatiales)
    audio_state: Arc<Mutex<AudioState>>,
    /// Origin = isobarycentre des tracks
    origin: Arc<Mutex<nalgebra::Vector3<f64>>>,
    /// OSC ids globaux (tracks sélectionnées)
    osc_ids: Arc<RwLock<Vec<u32>>>,
    /// Profondeur par track (per-track depth)
    track_depths: Arc<RwLock<Vec<f64>>>,
    /// Stratégie de merge
    merge_strategy: Arc<RwLock<MergeStrategy>>,
    /// Performance monitor global
    perf: Arc<PerfMonitor>,
    /// Callback de position (un seul event pour le 3D preview)
    position_callback: Arc<Mutex<Option<PositionCallback>>>,
    /// OSC sender
    osc_sender: Arc<Mutex<OscSender>>,
    /// Socket UDP
    socket: UdpSocket,
    /// FPS cible
    fps: f64,
    /// Fonction de post-processing (graph global) — hot-swappable
    post_process_fn: Arc<RwLock<PostProcessFn>>,
    /// Positions des tracks .hol (pour Barycenter) — track_id → [x, y, z]
    track_positions: Arc<RwLock<HashMap<u32, [f64; 3]>>>,
    /// Positions manuelles (pour ManualPosition) — object_index → [x, y, z]
    manual_positions: Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    /// Canaux spatiaux étendus par objet (gain, spread, distance, presence,
    /// yaw, aperture, lfe) — object_index → SpatialChannels
    object_channels: Arc<RwLock<HashMap<usize, SpatialChannels>>>,
    /// Règles de modulation cinématique (source cinématique → canal spatial)
    channel_modulations: Arc<RwLock<Vec<ChannelModulation>>>,
    /// Coefficient de lissage des mesures cinématiques [0, 1)
    kinematic_smoothing: Arc<RwLock<f64>>,
    /// Zones d'effets spatiaux (P4) — blend des canaux selon la position
    zones: Arc<RwLock<Vec<crate::zones::Zone>>>,
}

impl MergeRuntime {
    /// Crée un nouveau MergeRuntime
    pub fn new(
        osc_address: String,
        osc_port: u16,
        osc_sender: OscSender,
        fps: f64,
    ) -> crate::error::Result<Self> {
        let socket =
            UdpSocket::bind("0.0.0.0:0").map_err(crate::error::StagespaceError::NetworkError)?;
        socket
            .connect((osc_address.as_str(), osc_port))
            .map_err(crate::error::StagespaceError::NetworkError)?;

        Ok(MergeRuntime {
            thread: None,
            running: Arc::new(AtomicBool::new(false)),
            move_buffers: Arc::new(RwLock::new(HashMap::new())),
            active_moves: Arc::new(RwLock::new(HashMap::new())),
            macros: Arc::new(MacroState::new()),
            audio_state: Arc::new(Mutex::new(AudioState::new())),
            origin: Arc::new(Mutex::new(nalgebra::Vector3::zeros())),
            osc_ids: Arc::new(RwLock::new(Vec::new())),
            track_depths: Arc::new(RwLock::new(Vec::new())),
            merge_strategy: Arc::new(RwLock::new(MergeStrategy::Override)),
            perf: Arc::new(PerfMonitor::new()),
            position_callback: Arc::new(Mutex::new(None)),
            osc_sender: Arc::new(Mutex::new(osc_sender)),
            socket,
            fps,
            post_process_fn: Arc::new(RwLock::new(default_post_process_fn())),
            track_positions: Arc::new(RwLock::new(HashMap::new())),
            manual_positions: Arc::new(RwLock::new(HashMap::new())),
            object_channels: Arc::new(RwLock::new(HashMap::new())),
            channel_modulations: Arc::new(RwLock::new(Vec::new())),
            kinematic_smoothing: Arc::new(RwLock::new(0.5)),
            zones: Arc::new(RwLock::new(Vec::new())),
        })
    }

    /// Définit le callback de position (pour le 3D preview)
    pub fn set_position_callback(&self, callback: PositionCallback) {
        let mut cb = self
            .position_callback
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cb = Some(callback);
    }

    /// Reconfigure la destination OSC (adresse + port + sender)
    /// Utile pour les tests CLI où on veut envoyer vers un listener spécifique
    pub fn set_osc_target(
        &mut self,
        osc_address: String,
        osc_port: u16,
        osc_sender: OscSender,
    ) -> crate::error::Result<()> {
        let socket =
            UdpSocket::bind("0.0.0.0:0").map_err(crate::error::StagespaceError::NetworkError)?;
        socket
            .connect((osc_address.as_str(), osc_port))
            .map_err(crate::error::StagespaceError::NetworkError)?;
        self.socket = socket;
        *self.osc_sender.lock().unwrap_or_else(|e| e.into_inner()) = osc_sender;
        Ok(())
    }

    /// Définit l'origin (isobarycentre des tracks)
    pub fn set_origin(&self, origin: nalgebra::Vector3<f64>) {
        *self.origin.lock().unwrap_or_else(|e| e.into_inner()) = origin;
    }

    /// Définit les OSC ids globaux (tracks sélectionnées)
    pub fn set_osc_ids(&self, osc_ids: Vec<u32>) {
        *self.osc_ids.write().unwrap_or_else(|e| e.into_inner()) = osc_ids;
    }

    /// Récupère les osc_ids globaux actuels
    pub fn osc_ids(&self) -> Vec<u32> {
        self.osc_ids
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Recalcule les osc_ids globaux à partir des moves encore actifs.
    /// À appeler après unregister_move pour éviter l'accumulation d'ids obsolètes.
    pub fn rebuild_osc_ids(&self) {
        let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<u32> = Vec::new();
        for state in moves.values() {
            for &id in &state.osc_ids {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        drop(moves);
        *self.osc_ids.write().unwrap_or_else(|e| e.into_inner()) = ids;
    }

    /// Définit les depths par track
    pub fn set_track_depths(&self, depths: Vec<f64>) {
        *self.track_depths.write().unwrap_or_else(|e| e.into_inner()) = depths;
    }

    /// Définit la stratégie de merge
    pub fn set_merge_strategy(&self, strategy: MergeStrategy) {
        *self
            .merge_strategy
            .write()
            .unwrap_or_else(|e| e.into_inner()) = strategy;
    }

    /// Hot-swap la fonction de post-processing (graph global)
    pub fn swap_post_process_fn(&self, new_fn: PostProcessFn) {
        *self
            .post_process_fn
            .write()
            .unwrap_or_else(|e| e.into_inner()) = new_fn;
    }

    /// Définit les positions des tracks .hol (pour Barycenter)
    pub fn set_track_positions(&self, positions: HashMap<u32, [f64; 3]>) {
        *self
            .track_positions
            .write()
            .unwrap_or_else(|e| e.into_inner()) = positions;
    }

    /// Définit une position manuelle pour un objet (pour ManualPosition)
    pub fn set_manual_position(&self, obj_index: usize, pos: [f64; 3]) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(obj_index, pos);
    }

    /// Efface la position manuelle pour un objet
    pub fn clear_manual_position(&self, obj_index: usize) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&obj_index);
    }

    /// Efface toutes les positions manuelles
    pub fn clear_all_manual_positions(&self) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Définit un canal spatial étendu pour un objet (gain, spread, distance,
    /// presence, yaw, aperture, lfe — envoyé en OSC en plus de la position)
    pub fn set_object_channel(
        &self,
        obj_index: usize,
        channel: crate::osc_sender::SpatialChannel,
        value: f64,
    ) {
        self.object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .entry(obj_index)
            .or_default()
            .set(channel, value);
    }

    /// Efface un canal spatial pour un objet (None = tous les canaux de l'objet)
    pub fn clear_object_channel(
        &self,
        obj_index: usize,
        channel: Option<crate::osc_sender::SpatialChannel>,
    ) {
        let mut channels = self
            .object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner());
        match channel {
            Some(ch) => {
                if let Some(entry) = channels.get_mut(&obj_index) {
                    entry.clear(ch);
                    if entry.is_empty() {
                        channels.remove(&obj_index);
                    }
                }
            }
            None => {
                channels.remove(&obj_index);
            }
        }
    }

    /// Efface tous les canaux spatiaux de tous les objets
    pub fn clear_all_object_channels(&self) {
        self.object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Récupère les canaux spatiaux actuels (pour debug/persistance)
    pub fn object_channels(&self) -> HashMap<usize, SpatialChannels> {
        self.object_channels
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Ajoute une règle de modulation cinématique (source → canal spatial).
    /// Retourne l'index de la règle (pour suppression).
    pub fn add_modulation(&self, rule: ChannelModulation) -> usize {
        let mut rules = self
            .channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner());
        rules.push(rule);
        rules.len() - 1
    }

    /// Supprime une règle de modulation par index
    pub fn remove_modulation(&self, index: usize) -> bool {
        let mut rules = self
            .channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if index < rules.len() {
            rules.remove(index);
            true
        } else {
            false
        }
    }

    /// Efface toutes les règles de modulation
    pub fn clear_modulations(&self) {
        self.channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Récupère les règles de modulation actives (pour debug/persistance)
    pub fn modulations(&self) -> Vec<ChannelModulation> {
        self.channel_modulations
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Définit le lissage cinématique [0, 1) — 0 = brut, 0.9 = très lissé
    pub fn set_kinematic_smoothing(&self, smoothing: f64) {
        *self
            .kinematic_smoothing
            .write()
            .unwrap_or_else(|e| e.into_inner()) = smoothing.clamp(0.0, 0.99);
    }

    /// Ajoute une zone d'effet spatial. Retourne l'index de la zone.
    pub fn add_zone(&self, zone: crate::zones::Zone) -> usize {
        let mut zones = self.zones.write().unwrap_or_else(|e| e.into_inner());
        zones.push(zone);
        zones.len() - 1
    }

    /// Supprime une zone par index
    pub fn remove_zone(&self, index: usize) -> bool {
        let mut zones = self.zones.write().unwrap_or_else(|e| e.into_inner());
        if index < zones.len() {
            zones.remove(index);
            true
        } else {
            false
        }
    }

    /// Efface toutes les zones
    pub fn clear_zones(&self) {
        self.zones
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Récupère les zones actives (pour debug/persistance)
    pub fn zones(&self) -> Vec<crate::zones::Zone> {
        self.zones.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Récupère les macros (pour modification temps réel — fast path atomic)
    pub fn macros(&self) -> Arc<MacroState> {
        self.macros.clone()
    }

    /// Points de sortie pour le routing OSC IN (P3) — le receiver écrit
    /// directement dans ces Arcs partagés depuis son thread, sans lock
    /// supplémentaire dans le chemin temps réel du merge.
    pub fn osc_in_targets(&self) -> crate::osc_receiver::OscInTargets {
        crate::osc_receiver::OscInTargets {
            macros: Some(self.macros.clone()),
            object_channels: Some(self.object_channels.clone()),
            manual_positions: Some(self.manual_positions.clone()),
        }
    }

    /// Récupère l'Arc de l'audio state (pour mise à jour depuis l'app)
    pub fn audio_state_arc(&self) -> Arc<Mutex<AudioState>> {
        self.audio_state.clone()
    }

    /// Récupère les stats de performance
    pub fn get_perf_stats(&self) -> PerfStats {
        self.perf.get_stats()
    }

    /// Enregistre un move actif avec son buffer
    pub fn register_move(
        &self,
        move_id: String,
        buffer: Arc<PositionBuffer>,
        osc_ids: Vec<u32>,
        track_indices: Vec<usize>,
        is_preview: bool,
    ) {
        let state = MoveState::new(osc_ids, track_indices, is_preview);
        self.active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(move_id.clone(), state);
        self.move_buffers
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(move_id, buffer);
    }

    /// Démarre un fade out pour un move (le move sera retiré quand le fade est terminé)
    pub fn start_fade_out(&self, move_id: &str, fade_duration: f64) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.start_fade_out(fade_duration);
        }
    }

    /// Retire un move du merge (sans fade).
    ///
    /// NOTE: les osc_ids globaux sont gérés par le frontend via set_global_osc_ids.
    // On ne reconstruit plus les osc_ids ici — la liste globale doit rester
    // alignée avec les track_indices (indices dans cette liste).
    pub fn unregister_move(&self, move_id: &str) {
        self.active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(move_id);
        self.move_buffers
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(move_id);
    }

    /// Met à jour les osc_ids d'un move actif (pour hot-swap des tracks)
    pub fn update_move_osc_ids(&self, move_id: &str, osc_ids: Vec<u32>) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.osc_ids = osc_ids;
        }
    }

    /// Met à jour les track_indices d'un move actif (pour hot-swap des tracks)
    pub fn update_move_track_indices(&self, move_id: &str, track_indices: Vec<usize>) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.track_indices = track_indices;
        }
    }

    /// Vérifie si le merge runtime est en cours d'exécution
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Démarre le merge thread
    pub fn start(&mut self) -> crate::error::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(()); // Déjà démarré
        }

        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();
        let socket = self
            .socket
            .try_clone()
            .map_err(crate::error::StagespaceError::NetworkError)?;
        let move_buffers = self.move_buffers.clone();
        let active_moves = self.active_moves.clone();
        let macros = self.macros.clone();
        let audio_state_arc = self.audio_state.clone();
        let origin_arc = self.origin.clone();
        let osc_ids_arc = self.osc_ids.clone();
        let track_depths_arc = self.track_depths.clone();
        let merge_strategy_arc = self.merge_strategy.clone();
        let perf = self.perf.clone();
        let position_callback = self.position_callback.clone();
        let osc_sender_arc = self.osc_sender.clone();
        let fps = self.fps;
        let post_process_fn_arc = self.post_process_fn.clone();
        let track_positions_arc = self.track_positions.clone();
        let manual_positions_arc = self.manual_positions.clone();
        let object_channels_arc = self.object_channels.clone();
        let zones_arc = self.zones.clone();
        let channel_modulations_arc = self.channel_modulations.clone();
        let kinematic_smoothing_arc = self.kinematic_smoothing.clone();

        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;
            let mut osc_since_perf = 0u64;
            let mut osc_errors_perf = 0u64;
            // États cinématiques par objet — thread-local, aucun lock.
            // Mesurés sur les positions finales (post-merge + post-process).
            let mut kinematic_states: HashMap<usize, KinematicState> = HashMap::new();
            let mut prev_t: Option<f64> = None;

            while running.load(Ordering::SeqCst) {
                let frame_start = Instant::now();
                let t_real = start.elapsed().as_secs_f64();
                let dt = frame_duration.as_secs_f64();

                // 1. Lire tous les buffers (read lock très court)
                let buffers = move_buffers
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();

                // 2. Collecter les positions par move, avec fade et priorité
                // CRITICAL: ne pas tenir le write lock trop longtemps — register_move
                // a besoin d'accéder à active_moves.write() et sinon il est bloqué
                // pendant des secondes (lock starvation par le merge thread à 60 FPS).
                // Solution: clone les états sous un write lock très court, puis
                // traite tout hors lock.
                let mut move_positions: Vec<MoveEntry> = Vec::new();
                let mut moves_to_remove: Vec<String> = Vec::new();

                // --- Section critique courte: update fades + clone data ---
                let move_snapshots: Vec<(String, f64, u32, Vec<usize>, bool)> = {
                    let mut moves_guard = active_moves.write().unwrap_or_else(|e| e.into_inner());
                    let mut snapshots = Vec::with_capacity(moves_guard.len());
                    for (move_id, state) in moves_guard.iter_mut() {
                        if !state.is_active {
                            moves_to_remove.push(move_id.clone());
                            continue;
                        }
                        let fade = state.update_fade(dt);
                        if !state.is_active {
                            moves_to_remove.push(move_id.clone());
                            continue;
                        }
                        snapshots.push((
                            move_id.clone(),
                            fade,
                            state.priority,
                            state.track_indices.clone(),
                            state.is_preview,
                        ));
                    }
                    for id in &moves_to_remove {
                        moves_guard.remove(id);
                    }
                    snapshots
                };
                // --- Fin section critique: lock relâché ---

                // Lire les buffers et mapper hors lock
                for (move_id, fade, priority, track_indices, _is_preview) in &move_snapshots {
                    if let Some(buffer) = buffers.get(move_id) {
                        let positions = buffer.read();
                        if !positions.is_empty() {
                            let global_positions: Vec<(usize, nalgebra::Vector3<f64>)> =
                                if track_indices.is_empty() {
                                    positions.clone()
                                } else if track_indices.len() == positions.len() {
                                    positions
                                        .iter()
                                        .enumerate()
                                        .map(|(local_idx, (_, pos))| {
                                            (track_indices[local_idx], *pos)
                                        })
                                        .collect()
                                } else {
                                    crate::logging::log_osc_error(&format!(
                                        "MergeRuntime: move {} skipped — track_indices.len()={} != positions.len()={} (invariant violé)",
                                        move_id, track_indices.len(), positions.len()
                                    ));
                                    continue;
                                };
                            move_positions.push((
                                move_id.clone(),
                                *fade,
                                *priority,
                                global_positions,
                            ));
                        }
                    }
                }

                // Nettoyer les buffers des moves retirés (write lock court)
                if !moves_to_remove.is_empty() {
                    let mut bufs = move_buffers.write().unwrap_or_else(|e| e.into_inner());
                    for id in &moves_to_remove {
                        bufs.remove(id);
                    }
                }

                // 3. Merge : résoudre les conflits par track
                // CRITICAL: clone osc_ids et relâcher le read lock immédiatement.
                // Avant, le read lock était tenu pendant merge + post-process + OSC output
                // (presque toute la frame), bloquant set_osc_ids dans register_move
                // pendant des secondes (lock starvation à 60 FPS).
                let osc_ids = osc_ids_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let strategy = *merge_strategy_arc.read().unwrap_or_else(|e| e.into_inner());
                let merged = merge_positions(&move_positions, &osc_ids, strategy);

                // 4. Post-processing via le graph global compilé (PostProcessFn)
                // Clone toutes les données sous des locks courts, puis traite hors lock.
                let origin = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());
                let track_depths = track_depths_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let track_positions = track_positions_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let manual_positions = manual_positions_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let audio_state = audio_state_arc
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();

                let ctx = PostProcessContext {
                    t: t_real,
                    macros: &macros,
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    manual_positions: &manual_positions,
                    origin,
                    track_depths: &track_depths,
                };

                let transformed: Vec<(usize, nalgebra::Vector3<f64>)> = {
                    let pp_fn = post_process_fn_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner());
                    pp_fn(&ctx, merged)
                };

                // 4.5 Cinématique : vitesse/accélération/jerk sur les positions
                // finales (celles réellement envoyées au renderer), dt réel
                // entre frames pour une mesure correcte même en cas de jitter.
                let kin_dt = prev_t.map(|p| (t_real - p).max(1e-6)).unwrap_or(dt);
                prev_t = Some(t_real);
                let kin_smoothing = *kinematic_smoothing_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner());
                let has_modulations = !channel_modulations_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_empty();
                if has_modulations {
                    let present: std::collections::HashSet<usize> =
                        transformed.iter().map(|(i, _)| *i).collect();
                    for (obj_idx, pos) in &transformed {
                        kinematic_states.entry(*obj_idx).or_default().update(
                            *pos,
                            kin_dt,
                            kin_smoothing,
                        );
                    }
                    kinematic_states.retain(|idx, _| present.contains(idx));
                } else if !kinematic_states.is_empty() {
                    kinematic_states.clear();
                }
                let modulated_channels: HashMap<usize, SpatialChannels> = {
                    let rules = channel_modulations_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner());
                    apply_modulations(&rules, &kinematic_states)
                };

                // 4.6 Zones (P4) : snapshot sous read lock court — le blend
                // par objet se fait sans lock dans la boucle d'envoi.
                let zones: Vec<crate::zones::Zone> =
                    zones_arc.read().unwrap_or_else(|e| e.into_inner()).clone();

                // 5. OSC output (une seule socket)
                // Séparer display (tout) de OSC (exclut les moves en preview)
                let preview_tracks: std::collections::HashSet<usize> = {
                    let moves_guard = active_moves.read().unwrap_or_else(|e| e.into_inner());
                    moves_guard
                        .values()
                        .filter(|m| m.is_preview)
                        .flat_map(|m| m.track_indices.iter().copied())
                        .collect()
                };

                let sender = osc_sender_arc.lock().unwrap_or_else(|e| e.into_inner());
                let object_channels = object_channels_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                for (obj_idx, pos) in &transformed {
                    if preview_tracks.contains(obj_idx) {
                        continue; // Skip OSC pour les moves en preview
                    }
                    if let Some(&osc_id) = osc_ids.get(*obj_idx) {
                        // Canaux effectifs = statiques + modulés (modulation
                        // prioritaire sur les canaux qu'elle cible) + zones
                        // (blend par influence, prioritaires sur le reste)
                        let has_zones = crate::zones::any_zone_applies(&zones, *obj_idx, pos);
                        let effective: Option<SpatialChannels> = match (
                            object_channels.get(obj_idx),
                            modulated_channels.get(obj_idx),
                            has_zones,
                        ) {
                            (None, None, false) => None,
                            (s, m, _) => {
                                let mut eff = s.copied().unwrap_or_default();
                                if let Some(mc) = m {
                                    eff.overlay(mc);
                                }
                                crate::zones::apply_zones(&zones, *obj_idx, pos, &mut eff);
                                Some(eff)
                            }
                        };
                        let messages = sender.format_state(osc_id, *pos, effective.as_ref());
                        for (addr, values) in messages {
                            let args: Vec<OscType> =
                                values.iter().map(|v| OscType::Float(*v as f32)).collect();
                            let packet = OscPacket::Message(OscMessage {
                                addr: addr.clone(),
                                args,
                            });
                            if let Ok(bytes) = rosc::encoder::encode(&packet) {
                                if let Err(e) = socket.send(&bytes) {
                                    crate::logging::log_osc_error(&format!(
                                        "MergeRuntime OSC send error: {e}"
                                    ));
                                    osc_errors_perf += 1;
                                } else {
                                    osc_since_perf += 1;
                                }
                            }
                        }
                    }
                }

                // 6. Callback pour le 3D preview (display positions = tout, y compris preview)
                // On récupère le lock même si empoisonné (un panic dans un thread voisin
                // ne doit pas couper silencieusement l'émission de positions au frontend).
                {
                    let cb = position_callback.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref callback) = *cb {
                        callback(t_real, transformed.clone());
                    }
                }

                // 7. Perf monitor + debug log
                frame_count += 1;
                frames_since_perf += 1;
                let perf_elapsed = last_perf_update.elapsed();
                if perf_elapsed.as_millis() >= 500 {
                    let secs = perf_elapsed.as_secs_f64();
                    let fps_actual = frames_since_perf as f64 / secs;
                    let osc_rate = osc_since_perf as f64 / secs;
                    let frame_time_us = frame_start.elapsed().as_micros() as f64;
                    let latency_ms = frame_time_us / 1000.0;
                    let cpu_pct = (latency_ms / (1000.0 / fps)) * 100.0;
                    let total_osc = osc_since_perf + osc_errors_perf;
                    let error_rate = if total_osc > 0 {
                        osc_errors_perf as f64 / total_osc as f64
                    } else {
                        0.0
                    };
                    perf.update_with_error_rate(
                        fps_actual, osc_rate, latency_ms, cpu_pct, error_rate,
                    );
                    frames_since_perf = 0;
                    osc_since_perf = 0;
                    osc_errors_perf = 0;
                    last_perf_update = Instant::now();
                }

                // Timing précis
                let target_time = frame_count as u128 * frame_duration.as_nanos();
                let current_time = start.elapsed().as_nanos();
                if target_time > current_time {
                    let sleep_ns = (target_time - current_time) as u64;
                    // Utiliser std::thread::sleep au lieu de spin_sleep — rend la main à l'OS
                    // au lieu de busy-wait à 100% CPU. Précision ~1-2ms suffisante pour 60 FPS.
                    std::thread::sleep(Duration::from_nanos(sleep_ns));
                }
            }
        });

        self.thread = Some(handle);
        Ok(())
    }

    /// Arrête le merge thread
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }

    /// Applique le post-process global (PostProcessFn) à des samples
    /// de trajectoire déjà calculés (avec macros du movement).
    ///
    /// Utilisé par la visualisation 3D pour que la trajectoire affichée
    /// corresponde à la sortie OSC réelle (qui passe par le post-process).
    ///
    /// `samples` : Vec<(t, x, y, z)> — samples raw d'un movement
    /// `object_index` : l'index de l'objet dans le merge global
    pub fn apply_post_process_to_samples(
        &self,
        samples: Vec<(f64, f64, f64, f64)>,
        object_index: usize,
    ) -> Vec<(f64, f64, f64, f64)> {
        if samples.is_empty() {
            return vec![];
        }

        let macros = self.macros.clone();
        let audio_state = self
            .audio_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let track_positions = self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let manual_positions = self
            .manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let origin = *self.origin.lock().unwrap_or_else(|e| e.into_inner());
        let track_depths = self
            .track_depths
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let pp_fn = self
            .post_process_fn
            .read()
            .unwrap_or_else(|e| e.into_inner());
        let mut result = Vec::with_capacity(samples.len());
        for (t, x, y, z) in samples {
            let ctx = PostProcessContext {
                t,
                macros: &macros,
                audio_state: &audio_state,
                track_positions: &track_positions,
                manual_positions: &manual_positions,
                origin,
                track_depths: &track_depths,
            };
            let pos = nalgebra::Vector3::new(x, y, z);
            let transformed = pp_fn(&ctx, vec![(object_index, pos)]);
            if let Some((_, tp)) = transformed.first() {
                result.push((t, tp.x, tp.y, tp.z));
            } else {
                result.push((t, x, y, z));
            }
        }
        result
    }
}
