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

use crate::osc_sender::OscSender;
use crate::position_buffer::PositionBuffer;
use crate::runtime::{MacroState, PerfMonitor, PerfStats, PositionCallback, PostProcessFn, PostProcessContext};
use crate::audio::AudioState;
use rosc::{OscMessage, OscPacket, OscType};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// Stratégie de merge quand plusieurs moves ciblent le même track
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MergeStrategy {
    /// Dernier move activé gagne (par poids/fade le plus élevé)
    Override,
    /// Blend linéaire pondéré par weight * fade
    Crossfade,
    /// Moyenne pondérée de toutes les positions
    Blend,
    /// Move avec la priorité la plus haute gagne
    Priority,
}

impl Default for MergeStrategy {
    fn default() -> Self {
        MergeStrategy::Override
    }
}

/// État d'un move actif dans le MergeRuntime
#[derive(Debug, Clone)]
pub struct MoveState {
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub fade_in_remaining: f64,
    pub fade_out_remaining: f64,
    pub fade_in_duration: f64,
    pub fade_out_duration: f64,
    pub weight: f64,
    pub is_active: bool,
    pub is_preview: bool,
    /// Priorité pour la stratégie Priority (plus élevé = gagne)
    pub priority: u32,
    /// Frame count au dernier write — pour détecter les workers stale
    pub last_frame_count: u64,
}

impl MoveState {
    pub fn new(osc_ids: Vec<u32>, track_indices: Vec<usize>, is_preview: bool) -> Self {
        MoveState {
            osc_ids,
            track_indices,
            fade_in_remaining: 0.0,
            fade_out_remaining: 0.0,
            fade_in_duration: 0.0,
            fade_out_duration: 0.0,
            weight: 1.0,
            is_active: true,
            is_preview,
            priority: 0,
            last_frame_count: 0,
        }
    }

    /// Démarre un fade in
    pub fn start_fade_in(&mut self, duration: f64) {
        self.fade_in_duration = duration;
        self.fade_in_remaining = duration;
    }

    /// Démarre un fade out
    pub fn start_fade_out(&mut self, duration: f64) {
        self.fade_out_duration = duration;
        self.fade_out_remaining = duration;
    }

    /// Avance le fade d'un delta de temps. Retourne le facteur de fade actuel (0.0 → 1.0).
    pub fn update_fade(&mut self, dt: f64) -> f64 {
        let mut fade = 1.0;
        if self.fade_in_remaining > 0.0 {
            self.fade_in_remaining -= dt;
            let progress = 1.0 - (self.fade_in_remaining / self.fade_in_duration).clamp(0.0, 1.0);
            fade *= progress;
        }
        if self.fade_out_remaining > 0.0 {
            self.fade_out_remaining -= dt;
            if self.fade_out_remaining <= 0.0 {
                self.is_active = false;
                return 0.0;
            }
            let progress = (self.fade_out_remaining / self.fade_out_duration).clamp(0.0, 1.0);
            fade *= progress;
        }
        fade.clamp(0.0, 1.0)
    }

    /// Vrai si le move est en train de fader out
    pub fn is_fading_out(&self) -> bool {
        self.fade_out_remaining > 0.0
    }
}

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
}

impl MergeRuntime {
    /// Crée un nouveau MergeRuntime
    pub fn new(osc_address: String, osc_port: u16, osc_sender: OscSender, fps: f64) -> crate::error::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").map_err(crate::error::StagespaceError::NetworkError)?;
        socket.connect((osc_address.as_str(), osc_port)).map_err(crate::error::StagespaceError::NetworkError)?;

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
        })
    }

    /// Définit le callback de position (pour le 3D preview)
    pub fn set_position_callback(&self, callback: PositionCallback) {
        let mut cb = self.position_callback.lock().unwrap_or_else(|e| e.into_inner());
        *cb = Some(callback);
    }

    /// Définit l'origin (isobarycentre des tracks)
    pub fn set_origin(&self, origin: nalgebra::Vector3<f64>) {
        *self.origin.lock().unwrap_or_else(|e| e.into_inner()) = origin;
    }

    /// Définit les OSC ids globaux (tracks sélectionnées)
    pub fn set_osc_ids(&self, osc_ids: Vec<u32>) {
        *self.osc_ids.write().unwrap_or_else(|e| e.into_inner()) = osc_ids;
    }

    /// Définit les depths par track
    pub fn set_track_depths(&self, depths: Vec<f64>) {
        *self.track_depths.write().unwrap_or_else(|e| e.into_inner()) = depths;
    }

    /// Définit la stratégie de merge
    pub fn set_merge_strategy(&self, strategy: MergeStrategy) {
        *self.merge_strategy.write().unwrap_or_else(|e| e.into_inner()) = strategy;
    }

    /// Hot-swap la fonction de post-processing (graph global)
    pub fn swap_post_process_fn(&self, new_fn: PostProcessFn) {
        *self.post_process_fn.write().unwrap_or_else(|e| e.into_inner()) = new_fn;
    }

    /// Définit les positions des tracks .hol (pour Barycenter)
    pub fn set_track_positions(&self, positions: HashMap<u32, [f64; 3]>) {
        *self.track_positions.write().unwrap_or_else(|e| e.into_inner()) = positions;
    }

    /// Définit une position manuelle pour un objet (pour ManualPosition)
    pub fn set_manual_position(&self, obj_index: usize, pos: [f64; 3]) {
        self.manual_positions.write().unwrap_or_else(|e| e.into_inner()).insert(obj_index, pos);
    }

    /// Efface la position manuelle pour un objet
    pub fn clear_manual_position(&self, obj_index: usize) {
        self.manual_positions.write().unwrap_or_else(|e| e.into_inner()).remove(&obj_index);
    }

    /// Efface toutes les positions manuelles
    pub fn clear_all_manual_positions(&self) {
        self.manual_positions.write().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// Récupère les macros (pour modification temps réel — fast path atomic)
    pub fn macros(&self) -> Arc<MacroState> {
        self.macros.clone()
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
        self.active_moves.write().unwrap_or_else(|e| e.into_inner()).insert(move_id.clone(), state);
        self.move_buffers.write().unwrap_or_else(|e| e.into_inner()).insert(move_id, buffer);
    }

    /// Démarre un fade out pour un move (le move sera retiré quand le fade est terminé)
    pub fn start_fade_out(&self, move_id: &str, fade_duration: f64) {
        if let Some(state) = self.active_moves.write().unwrap_or_else(|e| e.into_inner()).get_mut(move_id) {
            state.start_fade_out(fade_duration);
        }
    }

    /// Retire un move du merge (sans fade)
    pub fn unregister_move(&self, move_id: &str) {
        self.active_moves.write().unwrap_or_else(|e| e.into_inner()).remove(move_id);
        self.move_buffers.write().unwrap_or_else(|e| e.into_inner()).remove(move_id);
    }

    /// Vérifie si le merge runtime est en cours d'exécution
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Démarre le merge thread
    pub fn start(&mut self) -> crate::error::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(());  // Déjà démarré
        }

        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();
        let socket = self.socket.try_clone().map_err(crate::error::StagespaceError::NetworkError)?;
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

        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;
            let mut osc_since_perf = 0u64;

            while running.load(Ordering::SeqCst) {
                let frame_start = Instant::now();
                let t_real = start.elapsed().as_secs_f64();
                let dt = frame_duration.as_secs_f64();

                // 1. Lire tous les buffers
                let buffers = move_buffers.read().unwrap_or_else(|e| e.into_inner()).clone();
                let mut moves_guard = active_moves.write().unwrap_or_else(|e| e.into_inner());

                // 2. Collecter les positions par move, avec fade
                let mut move_positions: Vec<(String, f64, Vec<(usize, nalgebra::Vector3<f64>)>)> = Vec::new();
                let mut moves_to_remove: Vec<String> = Vec::new();

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

                    if let Some(buffer) = buffers.get(move_id) {
                        let positions = buffer.read();
                        if !positions.is_empty() {
                            // Remapper les positions locales (0..N du move) vers les indices globaux
                            // en utilisant track_indices du MoveState.
                            // Sans track_indices, on garde les indices locaux (compat).
                            let global_positions: Vec<(usize, nalgebra::Vector3<f64>)> =
                                if state.track_indices.len() == positions.len() {
                                    positions.iter().enumerate().map(|(local_idx, (_, pos))| {
                                        (state.track_indices[local_idx], *pos)
                                    }).collect()
                                } else {
                                    positions.clone()
                                };
                            move_positions.push((move_id.clone(), fade, global_positions));
                        }
                    }
                }

                // Retirer les moves inactifs
                for id in &moves_to_remove {
                    moves_guard.remove(id);
                }
                drop(moves_guard);

                // Nettoyer aussi les buffers des moves retirés
                if !moves_to_remove.is_empty() {
                    let mut bufs = move_buffers.write().unwrap_or_else(|e| e.into_inner());
                    for id in &moves_to_remove {
                        bufs.remove(id);
                    }
                }

                // 3. Merge : résoudre les conflits par track
                let osc_ids = osc_ids_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                let strategy = *merge_strategy_arc.read().unwrap_or_else(|e| e.into_inner());
                let merged = merge_positions(&move_positions, &osc_ids, strategy);

                // 4. Post-processing via le graph global compilé (PostProcessFn)
                let origin = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());
                let track_depths = track_depths_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                let track_positions = track_positions_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                let manual_positions = manual_positions_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                let audio_state = audio_state_arc.lock().unwrap_or_else(|e| e.into_inner()).clone();

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
                    let pp_fn = post_process_fn_arc.read().unwrap_or_else(|e| e.into_inner());
                    pp_fn(&ctx, merged)
                };

                // 5. OSC output (une seule socket)
                // Séparer display (tout) de OSC (exclut les moves en preview)
                let moves_guard = active_moves.read().unwrap_or_else(|e| e.into_inner());
                let preview_tracks: std::collections::HashSet<usize> = moves_guard
                    .values()
                    .filter(|m| m.is_preview)
                    .flat_map(|m| m.track_indices.iter().copied())
                    .collect();
                drop(moves_guard);

                let sender = osc_sender_arc.lock().unwrap_or_else(|e| e.into_inner());
                for (obj_idx, pos) in &transformed {
                    if preview_tracks.contains(obj_idx) {
                        continue;  // Skip OSC pour les moves en preview
                    }
                    if let Some(&osc_id) = osc_ids.get(*obj_idx) {
                        let (addr, values) = sender.format_position(osc_id, *pos);
                        let args: Vec<OscType> = values.iter().map(|v| OscType::Float(*v as f32)).collect();
                        let packet = OscPacket::Message(OscMessage { addr: addr.clone(), args });
                        if let Ok(bytes) = rosc::encoder::encode(&packet) {
                            if let Err(e) = socket.send(&bytes) {
                                crate::logging::log_osc_error(&format!("MergeRuntime OSC send error: {}", e));
                            } else {
                                osc_since_perf += 1;
                            }
                        }
                    }
                }

                // 6. Callback pour le 3D preview (display positions = tout, y compris preview)
                if let Ok(cb) = position_callback.lock() {
                    if let Some(ref callback) = *cb {
                        callback(t_real, transformed.clone());
                    }
                }

                // 7. Perf monitor
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
                    perf.update(fps_actual, osc_rate, latency_ms, cpu_pct);
                    frames_since_perf = 0;
                    osc_since_perf = 0;
                    last_perf_update = Instant::now();
                }

                // Timing précis
                let target_time = frame_count as u128 * frame_duration.as_nanos();
                let current_time = start.elapsed().as_nanos();
                if target_time > current_time {
                    let sleep_ns = (target_time - current_time) as u64;
                    spin_sleep::sleep(Duration::from_nanos(sleep_ns));
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
}

/// Merge les positions de plusieurs moves en un seul vecteur de positions par track.
///
/// Pour chaque track (object_index), résoudre les positions multiples selon la stratégie.
fn merge_positions(
    move_positions: &[(String, f64, Vec<(usize, nalgebra::Vector3<f64>)>)],
    osc_ids: &[u32],
    strategy: MergeStrategy,
) -> Vec<(usize, nalgebra::Vector3<f64>)> {
    if move_positions.is_empty() {
        // Pas de moves actifs : retourner des positions zero pour chaque track
        return (0..osc_ids.len())
            .map(|i| (i, nalgebra::Vector3::zeros()))
            .collect();
    }

    // Si un seul move, pas de merge nécessaire
    if move_positions.len() == 1 {
        return move_positions[0].2.clone();
    }

    // Collecter toutes les positions par object_index
    let mut positions_by_index: HashMap<usize, Vec<(f64, nalgebra::Vector3<f64>)>> = HashMap::new();
    for (_, fade, positions) in move_positions {
        for (idx, pos) in positions {
            positions_by_index.entry(*idx).or_default().push((*fade, *pos));
        }
    }

    // Résoudre selon la stratégie
    let n_objects = osc_ids.len();
    (0..n_objects)
        .map(|obj_idx| {
            let candidates = positions_by_index.get(&obj_idx);
            let pos = match (strategy, candidates) {
                (_, None) => nalgebra::Vector3::zeros(),
                (_, Some(c)) if c.is_empty() => nalgebra::Vector3::zeros(),
                // Override : prendre la position avec le fade le plus élevé
                (MergeStrategy::Override, Some(c)) => {
                    c.iter().max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
                        .map(|(_, pos)| *pos)
                        .unwrap_or(nalgebra::Vector3::zeros())
                }
                // Crossfade / Blend : moyenne pondérée par fade
                (MergeStrategy::Crossfade, Some(c)) | (MergeStrategy::Blend, Some(c)) => {
                    let total_weight: f64 = c.iter().map(|(f, _)| f.abs()).sum();
                    if total_weight > 1e-10 {
                        c.iter().map(|(f, pos)| pos * (*f / total_weight)).sum()
                    } else {
                        c[0].1
                    }
                }
                // Priority : pour l'instant, même chose que Override
                // (TODO: ajouter un champ priority à MoveState)
                (MergeStrategy::Priority, Some(c)) => {
                    c.iter().max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
                        .map(|(_, pos)| *pos)
                        .unwrap_or(nalgebra::Vector3::zeros())
                }
            };
            (obj_idx, pos)
        })
        .collect()
}

/// PostProcessFn par défaut — reproduit le comportement hardcodé d'avant la Phase 2.
///
/// Ordre d'application :
/// 1. radius_scale (radial scaling par rapport à l'origin)
/// 2. height_offset (translation Y)
/// 3. depth (interpolation origin ↔ pos)
/// 4. scale (uniform scaling)
/// 5. rotation (yaw → pitch → roll)
/// 6. origin + shift (translation finale)
fn default_post_process_fn() -> PostProcessFn {
    Box::new(|ctx: &PostProcessContext, positions| {
        let scale = ctx.macros.get_scale();
        let shift = ctx.macros.get_shift();
        let (yaw, pitch, roll) = ctx.macros.get_rotation();
        let radius_scale = ctx.macros.get_radius_scale();
        let height_offset = ctx.macros.get_height_offset();
        let origin = ctx.origin;

        // Précalculer la matrice de rotation
        let has_rotation = yaw != 0.0 || pitch != 0.0 || roll != 0.0;
        let rot_matrix = if has_rotation {
            use nalgebra::Rotation3;
            let ry = Rotation3::from_axis_angle(&nalgebra::Vector3::y_axis(), yaw.to_radians());
            let rx = Rotation3::from_axis_angle(&nalgebra::Vector3::x_axis(), pitch.to_radians());
            let rz = Rotation3::from_axis_angle(&nalgebra::Vector3::z_axis(), roll.to_radians());
            Some(rz * rx * ry)
        } else {
            None
        };

        positions
            .iter()
            .map(|(obj_idx, pos)| {
                // ManualPosition : si une position manuelle existe, l'utiliser
                let pos = if let Some(manual) = ctx.manual_positions.get(obj_idx) {
                    nalgebra::Vector3::new(manual[0], manual[1], manual[2])
                } else {
                    *pos
                };

                // radius_scale : scaling radial par rapport à l'origin
                let pos_scaled_radius = if (radius_scale - 1.0).abs() > 1e-10 {
                    origin + (pos - origin) * radius_scale
                } else {
                    pos
                };

                // height_offset : translation Y post-engine
                let pos_with_height = if height_offset.abs() > 1e-10 {
                    nalgebra::Vector3::new(
                        pos_scaled_radius.x,
                        pos_scaled_radius.y + height_offset,
                        pos_scaled_radius.z,
                    )
                } else {
                    pos_scaled_radius
                };

                // depth : interpoler entre origin et pos
                let depth = ctx.track_depths.get(*obj_idx).copied().unwrap_or(1.0);
                let pos_with_depth = origin + (pos_with_height - origin) * depth;

                // scale → rotation → origin + shift
                let pos_scaled = pos_with_depth * scale;
                let pos_rotated = if let Some(ref rot) = rot_matrix {
                    rot * pos_scaled
                } else {
                    pos_scaled
                };
                let pos_final = pos_rotated + origin + shift;

                (*obj_idx, pos_final)
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osc_sender::OscProfile;

    #[test]
    fn test_merge_override() {
        let move_a = ("a".to_string(), 1.0, vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
        ]);
        let move_b = ("b".to_string(), 0.5, vec![
            (0, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
        ]);
        let osc_ids = vec![1, 2];
        let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Override);
        // Override : fade le plus élevé gagne → move_a (fade 1.0)
        assert!((merged[0].1.x - 1.0).abs() < 1e-10);
        assert!((merged[1].1.x - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_merge_crossfade() {
        let move_a = ("a".to_string(), 1.0, vec![
            (0, nalgebra::Vector3::new(0.0, 0.0, 0.0)),
        ]);
        let move_b = ("b".to_string(), 1.0, vec![
            (0, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
        ]);
        let osc_ids = vec![1];
        let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Crossfade);
        // Crossfade : moyenne pondérée → (0 + 10) / 2 = 5
        assert!((merged[0].1.x - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_merge_single_move() {
        let move_a = ("a".to_string(), 1.0, vec![
            (0, nalgebra::Vector3::new(1.0, 2.0, 3.0)),
        ]);
        let osc_ids = vec![1];
        let merged = merge_positions(&[move_a], &osc_ids, MergeStrategy::Override);
        assert_eq!(merged.len(), 1);
        assert!((merged[0].1.x - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_merge_empty() {
        let osc_ids = vec![1, 2];
        let merged = merge_positions(&[], &osc_ids, MergeStrategy::Override);
        assert_eq!(merged.len(), 2);
        assert!(merged[0].1.x.abs() < 1e-10);
        assert!(merged[1].1.x.abs() < 1e-10);
    }

    #[test]
    fn test_merge_disjoint_tracks() {
        // Move A contrôle tracks [0, 1, 2] (positions locales 0,1,2)
        // Move B contrôle tracks [3, 4, 5] (positions locales 0,1,2 → remappées en 3,4,5)
        // Après remapping, le merge ne doit pas écraser les positions de A avec celles de B
        let move_a = ("a".to_string(), 1.0, vec![
            (0, nalgebra::Vector3::new(1.0, 0.0, 0.0)),
            (1, nalgebra::Vector3::new(2.0, 0.0, 0.0)),
            (2, nalgebra::Vector3::new(3.0, 0.0, 0.0)),
        ]);
        // Move B avec indices déjà remappés (3,4,5)
        let move_b = ("b".to_string(), 1.0, vec![
            (3, nalgebra::Vector3::new(10.0, 0.0, 0.0)),
            (4, nalgebra::Vector3::new(20.0, 0.0, 0.0)),
            (5, nalgebra::Vector3::new(30.0, 0.0, 0.0)),
        ]);
        let osc_ids = vec![1, 2, 3, 4, 5, 6];
        let merged = merge_positions(&[move_a, move_b], &osc_ids, MergeStrategy::Override);
        assert_eq!(merged.len(), 6);
        // Tracks 0-2 : move A
        assert!((merged[0].1.x - 1.0).abs() < 1e-10);
        assert!((merged[1].1.x - 2.0).abs() < 1e-10);
        assert!((merged[2].1.x - 3.0).abs() < 1e-10);
        // Tracks 3-5 : move B
        assert!((merged[3].1.x - 10.0).abs() < 1e-10);
        assert!((merged[4].1.x - 20.0).abs() < 1e-10);
        assert!((merged[5].1.x - 30.0).abs() < 1e-10);
    }

    #[test]
    fn test_move_state_fade_in() {
        let mut state = MoveState::new(vec![1], vec![0], false);
        state.start_fade_in(1.0);
        let fade = state.update_fade(0.5);
        assert!((fade - 0.5).abs() < 1e-10);
        let fade = state.update_fade(0.5);
        assert!((fade - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_move_state_fade_out() {
        let mut state = MoveState::new(vec![1], vec![0], false);
        state.start_fade_out(1.0);
        let fade = state.update_fade(0.5);
        assert!((fade - 0.5).abs() < 1e-10);
        assert!(state.is_active);
        let fade = state.update_fade(0.5);
        assert!((fade - 0.0).abs() < 1e-10);
        assert!(!state.is_active);
    }

    #[test]
    fn test_merge_runtime_creation() {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0);
        assert!(rt.is_ok());
        let rt = rt.unwrap();
        assert!(!rt.is_running());
    }

    #[test]
    fn test_register_unregister_move() {
        let sender = OscSender::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000);
        let rt = MergeRuntime::new("127.0.0.1".to_string(), 7000, sender, 60.0).unwrap();
        let buffer = Arc::new(PositionBuffer::new());
        rt.register_move("move1".to_string(), buffer, vec![1, 2], vec![0, 1], false);
        assert_eq!(rt.active_moves.read().unwrap().len(), 1);
        rt.unregister_move("move1");
        assert_eq!(rt.active_moves.read().unwrap().len(), 0);
    }
}
