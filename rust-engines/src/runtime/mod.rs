use crate::animation::AnimationState;
use crate::audio::AudioState;
use crate::engines::EngineParams;
use crate::error::{Result, StagespaceError};
use crate::logging::{
    log_osc_error, log_osc_message, log_playback_start, log_playback_stop, log_runtime_init,
};
use crate::osc_sender::OscSender;
use crate::position_buffer::PositionBuffer;
use rosc::{OscMessage, OscPacket, OscType};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

mod config;
mod macros;
mod overrides;
mod perf;
mod types;
#[cfg(test)]
mod tests;


pub use config::*;
pub use macros::*;
pub use overrides::*;
pub use perf::*;
pub use types::*;

/// Runtime pour le playback temps réel — conçu pour le live
pub struct Runtime {
    socket: UdpSocket,
    running: Arc<AtomicBool>,
    position_fn: Arc<Mutex<PositionFn>>,
    position_callback: Arc<Mutex<Option<PositionCallback>>>,
    osc_sender: Arc<Mutex<OscSender>>,
    macros: Arc<MacroState>,
    config: Arc<RuntimeConfig>,
    perf: Arc<PerfMonitor>,
    overrides: OverrideManager,
    /// Origin = isobarycentre des tracks ciblées — la trajectoire est centrée dessus
    origin: Arc<Mutex<nalgebra::Vector3<f64>>>,
    /// Animation state — depth + phase_offset par track + audio mods
    animation_state: Arc<Mutex<Option<AnimationState>>>,
    /// Audio state — partagé avec l'app, lu à chaque frame pour les audio mods
    audio_state: Arc<Mutex<AudioState>>,
    /// Audio param overrides — calculés à chaque frame à partir des audio_mods,
    /// lus par la closure compilée pour injecter radius/height/turns/offset/rotation
    audio_param_overrides: Arc<Mutex<HashMap<String, f64>>>,
    /// Buffer de positions — en mode "worker", le runtime écrit ses positions
    /// dans ce buffer au lieu d'envoyer l'OSC directement. Le MergeRuntime lit
    /// tous les buffers pour faire le merge + post-processing + OSC.
    /// None = mode legacy (OSC direct, compatibilité)
    /// Some(buf) = mode worker (écrit dans le buffer, pas d'OSC, pas de macros spatiales)
    position_buffer: Mutex<Option<Arc<PositionBuffer>>>,
    /// Duration du move — stockée en ms (AtomicU64) pour hot-swap en live.
    /// Le worker thread lit cette valeur à chaque frame au lieu de capturer
    /// la duration dans sa closure.
    duration_ms: Arc<std::sync::atomic::AtomicU64>,
    /// OSC ids du move — hot-swappable en live via set_osc_ids.
    /// Le worker thread lit cette valeur à chaque frame pour savoir
    /// combien de positions calculer.
    osc_ids_arc: Arc<std::sync::RwLock<Vec<u32>>>,
}

impl Runtime {
    /// Crée un nouveau runtime
    pub fn new(osc_address: String, osc_port: u16, osc_sender: OscSender) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").map_err(StagespaceError::NetworkError)?;
        socket
            .connect((osc_address.as_str(), osc_port))
            .map_err(StagespaceError::NetworkError)?;

        // Runtime démarre avec une fonction identité — sera hot-swappée avant play
        let initial_fn: PositionFn = Box::new(|_t, _i| nalgebra::Vector3::zeros());
        Ok(Runtime {
            socket,
            running: Arc::new(AtomicBool::new(false)),
            position_fn: Arc::new(Mutex::new(initial_fn)),
            position_callback: Arc::new(Mutex::new(None)),
            osc_sender: Arc::new(Mutex::new(osc_sender)),
            macros: Arc::new(MacroState::new()),
            config: Arc::new(RuntimeConfig::new()),
            perf: Arc::new(PerfMonitor::new()),
            overrides: OverrideManager::new(),
            origin: Arc::new(Mutex::new(nalgebra::Vector3::zeros())),
            animation_state: Arc::new(Mutex::new(None)),
            audio_state: Arc::new(Mutex::new(AudioState::new())),
            audio_param_overrides: Arc::new(Mutex::new(HashMap::new())),
            position_buffer: Mutex::new(None),
            duration_ms: Arc::new(std::sync::atomic::AtomicU64::new(4000)),
            osc_ids_arc: Arc::new(std::sync::RwLock::new(Vec::new())),
        })
    }

    /// Définit la duration du move (en secondes) — hot-swappable en live
    pub fn set_duration(&self, duration_secs: f64) {
        let ms = (duration_secs * 1000.0).max(1.0) as u64;
        self.duration_ms.store(ms, Ordering::Relaxed);
    }

    /// Définit les osc_ids du move — hot-swappable en live
    pub fn set_osc_ids(&self, osc_ids: Vec<u32>) {
        *self.osc_ids_arc.write().unwrap_or_else(|e| e.into_inner()) = osc_ids;
    }

    /// Récupère la duration actuelle (en secondes)
    pub fn duration(&self) -> f64 {
        self.duration_ms.load(Ordering::Relaxed) as f64 / 1000.0
    }

    /// Définit le callback de position appelé à chaque frame
    pub fn set_position_callback(&self, callback: PositionCallback) {
        let mut cb = self
            .position_callback
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cb = Some(callback);
    }

    /// Active le mode "worker" : le runtime écrit ses positions dans le buffer
    /// au lieu d'envoyer l'OSC directement. Le MergeRuntime fera le merge + post-processing.
    /// En mode worker, le runtime n'applique PAS les macros spatiales (scale, rotation, shift,
    /// radius_scale, height_offset) ni le depth — ces transformations montent dans le merge thread.
    /// Le runtime garde : speed, loop_mode, direction, phase_offset, fade, overrides.
    pub fn set_position_buffer(&self, buffer: Arc<PositionBuffer>) {
        let mut buf = self
            .position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *buf = Some(buffer);
    }

    /// Désactive le mode "worker" : retour au mode legacy (OSC direct).
    pub fn unset_position_buffer(&self) {
        let mut buf = self
            .position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *buf = None;
    }

    /// Vérifie si le runtime est en mode worker (buffer) ou legacy (OSC direct)
    pub fn is_worker_mode(&self) -> bool {
        self.position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    /// Définit l'origin (isobarycentre des tracks ciblées)
    /// La trajectoire est centrée sur ce point : pos_final = (pos * scale * rot) + origin + shift
    pub fn set_origin(&self, origin: nalgebra::Vector3<f64>) {
        let mut o = self.origin.lock().unwrap_or_else(|e| e.into_inner());
        *o = origin;
    }

    /// Récupère l'origin actuelle
    pub fn get_origin(&self) -> nalgebra::Vector3<f64> {
        *self.origin.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Définit l'animation state (depth + phase_offset par track + audio mods)
    pub fn set_animation_state(&self, state: AnimationState) {
        let mut s = self
            .animation_state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *s = Some(state);
    }

    /// Met à jour l'audio state (appelé à chaque frame par l'app)
    pub fn set_audio_state(&self, audio: AudioState) {
        let mut s = self.audio_state.lock().unwrap_or_else(|e| e.into_inner());
        *s = audio;
    }

    /// Récupère l'Arc des audio param overrides — à passer à compile_with_audio_and_overrides
    pub fn audio_param_overrides(&self) -> Arc<Mutex<HashMap<String, f64>>> {
        self.audio_param_overrides.clone()
    }

    /// Récupère l'Arc de l'audio state — permet de mettre à jour sans locker state.movements
    pub fn audio_state_arc(&self) -> Arc<Mutex<AudioState>> {
        self.audio_state.clone()
    }

    /// Définit le sender OSC
    pub fn set_osc_sender(&self, osc_sender: OscSender) {
        let mut sender = self.osc_sender.lock().unwrap_or_else(|e| e.into_inner());
        *sender = osc_sender;
    }

    /// Hot-swap la fonction de position — pour cue recall sans arrêter le playback
    pub fn swap_position_fn(&self, new_fn: PositionFn) {
        let mut old = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        *old = new_fn;
    }

    /// Échantillonne la trajectoire compilée pour un objet donné sur N points
    /// Applique les macros (scale, rotation, shift) pour refléter le rendu réel
    /// Retourne Vec<(t, x, y, z)> — utilisé par le frontend pour visualiser le chemin
    pub fn sample_trajectory(
        &self,
        object_index: usize,
        n_samples: usize,
        duration: f64,
    ) -> Vec<(f64, f64, f64, f64)> {
        let fn_ref = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        let scale = self.macros.get_scale();
        let shift = self.macros.get_shift();
        let (yaw, pitch, roll) = self.macros.get_rotation();

        // Précalculer la matrice de rotation si rotation non-nulle
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

        let mut samples = Vec::with_capacity(n_samples);
        for i in 0..n_samples {
            let t = (i as f64 / (n_samples - 1).max(1) as f64) * duration;
            let pos = fn_ref(t, object_index);
            // Appliquer macros: scale → rotation → shift (comme dans le playback loop)
            let pos_scaled = pos * scale;
            let pos_rotated = if let Some(ref rot) = rot_matrix {
                rot * pos_scaled
            } else {
                pos_scaled
            };
            let pos_final = pos_rotated + shift;
            samples.push((t, pos_final.x, pos_final.y, pos_final.z));
        }
        samples
    }

    /// Récupère l'état des macros (pour modification temps réel)
    pub fn macros(&self) -> Arc<MacroState> {
        self.macros.clone()
    }

    pub fn set_loop_mode(&self, mode: LoopMode) {
        self.config.set_loop_mode(mode);
    }
    pub fn set_direction(&self, dir: PlayDirection) {
        self.config.set_direction(dir);
    }
    pub fn set_fade(&self, fade_in: f64, fade_out: f64) {
        self.config.set_fade(fade_in, fade_out);
    }

    /// Démarre le playback avec une fonction compilée
    /// Le runtime tourne en boucle infinie jusqu'à stop()
    pub fn play_compiled(
        &self,
        position_fn: PositionFn,
        params: EngineParams,
        osc_ids: Vec<u32>,
    ) -> Result<std::thread::JoinHandle<()>> {
        log_runtime_init(params.fps, params.n_objects);
        log_playback_start(
            params.duration,
            self.osc_sender
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .profile_name(),
        );

        // Hot-swap la fonction
        self.swap_position_fn(position_fn);

        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();
        let socket = self
            .socket
            .try_clone()
            .map_err(StagespaceError::NetworkError)?;
        // Stocker la duration dans le champ partagé pour hot-swap en live
        self.set_duration(params.duration);
        // Stocker les osc_ids dans le champ partagé pour hot-swap en live
        self.set_osc_ids(osc_ids.clone());
        let duration_arc = self.duration_ms.clone();
        let osc_ids_arc = self.osc_ids_arc.clone();
        let position_fn_arc = self.position_fn.clone();
        let position_callback = self.position_callback.clone();
        let osc_sender_arc = self.osc_sender.clone();
        let macros = self.macros.clone();
        let config = self.config.clone();
        let perf = self.perf.clone();
        let overrides = self.overrides.clone();
        let origin_arc = self.origin.clone();
        let anim_state_arc = self.animation_state.clone();
        let audio_state_arc = self.audio_state.clone();
        let audio_param_overrides_arc = self.audio_param_overrides.clone();
        let position_buffer_arc = self
            .position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / params.fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;
            let mut osc_since_perf = 0u64;

            while running.load(Ordering::SeqCst) {
                let elapsed = start.elapsed();
                let t_real = elapsed.as_secs_f64();

                // Lire la duration (hot-swappable) depuis l'AtomicU64
                let duration = duration_arc.load(Ordering::Relaxed) as f64 / 1000.0;

                // Lire les macros temps réel (base)
                let speed = macros.get_speed();
                let scale = macros.get_scale();
                let shift = macros.get_shift();
                let (yaw, pitch, roll) = macros.get_rotation();
                let radius_scale = macros.get_radius_scale();
                let height_offset = macros.get_height_offset();

                // Appliquer speed: temps virtuel
                let t_virtual = t_real * speed;

                // Lire la direction
                let dir = config.get_direction();

                // Gérer loop vs one-shot
                let loop_is_on = config.get_loop_mode() == LoopMode::Loop;
                let t = if loop_is_on && duration > 0.0 {
                    let t_mod = t_virtual % duration;
                    // Appliquer la direction
                    match dir {
                        PlayDirection::Backward => duration - t_mod,
                        PlayDirection::PingPong => {
                            // PingPong
                            let cycle = (t_virtual / duration) as u64;
                            if cycle.is_multiple_of(2) {
                                t_mod
                            } else {
                                duration - t_mod
                            }
                        }
                        PlayDirection::Forward => t_mod,
                    }
                } else if !loop_is_on && t_virtual >= duration {
                    break; // One-shot: arrêter à la fin
                } else {
                    t_virtual
                };

                // Lire l'animation state (depth + phase_offset par track)
                let (track_depths, track_phase_offsets, audio_param_overrides) = {
                    let mut anim_guard = anim_state_arc.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref mut anim_state) = *anim_guard {
                        let audio = audio_state_arc.lock().unwrap_or_else(|e| e.into_inner());
                        let audio_params = anim_state.compute_audio_modulated_params(&audio);
                        (
                            anim_state.track_depths.clone(),
                            anim_state.track_phase_offsets.clone(),
                            audio_params,
                        )
                    } else {
                        (Vec::new(), Vec::new(), std::collections::HashMap::new())
                    }
                };

                // Mettre à jour les audio param overrides (pour la closure compilée)
                // NOTE: les audio mods ne vont plus dans params.extra — ils agissent sur les macros
                {
                    let mut ovr = audio_param_overrides_arc
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    *ovr = audio_param_overrides.clone();
                }

                // ── Système unifié : audio mods = deltas sur les macros ──
                // macro_effective = macro_base + audio_delta
                let effective_speed =
                    speed + audio_param_overrides.get("speed").copied().unwrap_or(0.0);
                let effective_scale =
                    scale + audio_param_overrides.get("scale").copied().unwrap_or(0.0);
                let effective_radius_scale = radius_scale
                    + audio_param_overrides
                        .get("radius_scale")
                        .copied()
                        .unwrap_or(0.0);
                let effective_height_offset = height_offset
                    + audio_param_overrides
                        .get("height_offset")
                        .copied()
                        .unwrap_or(0.0);

                let eff_shift = nalgebra::Vector3::new(
                    shift.x
                        + audio_param_overrides
                            .get("offset_x")
                            .copied()
                            .unwrap_or(0.0),
                    shift.y
                        + audio_param_overrides
                            .get("offset_y")
                            .copied()
                            .unwrap_or(0.0),
                    shift.z
                        + audio_param_overrides
                            .get("offset_z")
                            .copied()
                            .unwrap_or(0.0),
                );
                let eff_yaw = yaw + audio_param_overrides.get("yaw").copied().unwrap_or(0.0);
                let eff_pitch = pitch + audio_param_overrides.get("pitch").copied().unwrap_or(0.0);
                let eff_roll = roll + audio_param_overrides.get("roll").copied().unwrap_or(0.0);

                // Recalculer le temps virtuel avec le speed effectif (audio-modulé)
                let t_virtual_eff = t_real * effective_speed;
                let t_eff = if loop_is_on && duration > 0.0 {
                    t_virtual_eff % duration
                } else if !loop_is_on && t_virtual_eff >= duration {
                    break;
                } else {
                    t_virtual_eff
                };

                // Calculer le facteur de fade (0→1 pendant fade_in, 1→0 pendant fade_out)
                let (fade_in_s, fade_out_s) = config.get_fade();
                let t_eff_secs = t_real; // temps réel pour le fade (pas affecté par speed)
                let fade_factor = {
                    let mut f = 1.0;
                    if fade_in_s > 0.0 && t_eff_secs < fade_in_s {
                        f *= t_eff_secs / fade_in_s;
                    }
                    if fade_out_s > 0.0 && loop_is_on {
                        // En loop: fade out à la fin de chaque cycle
                        let t_in_cycle = if duration > 0.0 {
                            t_eff % duration
                        } else {
                            t_eff
                        };
                        if t_in_cycle > duration - fade_out_s && duration > fade_out_s {
                            f *= (duration - t_in_cycle) / fade_out_s;
                        }
                    } else if fade_out_s > 0.0 && !loop_is_on && t_eff_secs > duration - fade_out_s
                    {
                        // One-shot: fade out à la fin
                        let remaining = duration - t_eff_secs;
                        if remaining > 0.0 {
                            f *= remaining / fade_out_s;
                        }
                    }
                    f.clamp(0.0, 1.0)
                };

                // Lire la fonction de position (hot-swappable)
                // ── Mode worker : calculer juste raw_pos (avec speed, loop, direction, phase_offset, overrides)
                //    et écrire dans le buffer. Le MergeRuntime fera le merge + post-processing + OSC.
                // ── Mode legacy : calculer raw_pos + radius_scale + height_offset + depth,
                //    puis envoyer OSC + callback (comportement actuel).
                if let Some(ref buffer) = position_buffer_arc {
                    // ── Mode worker ──
                    // Lire les osc_ids (hot-swappable) depuis l'arc
                    let osc_ids = osc_ids_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                    let positions: Vec<(usize, nalgebra::Vector3<f64>)> = {
                        let fn_ref = position_fn_arc.lock().unwrap_or_else(|e| e.into_inner());
                        let ovr = overrides.lock();
                        osc_ids
                            .iter()
                            .enumerate()
                            .map(|(obj_idx, &_osc_id)| {
                                // Si un override existe pour cet objet, l'utiliser
                                let raw_pos = if let Some(override_pos) = ovr.get(&obj_idx) {
                                    *override_pos
                                } else {
                                    // Appliquer le phase_offset pour cette track
                                    let phase_off =
                                        track_phase_offsets.get(obj_idx).copied().unwrap_or(0.0);
                                    let t_with_phase = if duration > 0.0 {
                                        t_eff + (phase_off / 360.0) * duration
                                    } else {
                                        t_eff
                                    };
                                    let t_looped = if loop_is_on && duration > 0.0 {
                                        t_with_phase % duration
                                    } else {
                                        t_with_phase
                                    };
                                    // catch_unwind: la position_fn peut panic si obj_idx
                                    // dépasse le n_objects pour lequel elle a été compilée
                                    // (race condition lors du hot-swap des osc_ids avant
                                    // le recall_cue). On retourne zeros plutôt que de laisser
                                    // le thread mourir.
                                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                        fn_ref(t_looped, obj_idx)
                                    }))
                                        .unwrap_or_else(|_e| {
                                            nalgebra::Vector3::zeros()
                                        })
                                };
                                (obj_idx, raw_pos)
                            })
                            .collect()
                    };
                    // Écrire dans le buffer pour le MergeRuntime
                    buffer.write(positions);

                    frame_count += 1;
                    frames_since_perf += 1;

                    // Update perf stats every ~500ms
                    let perf_elapsed = last_perf_update.elapsed();
                    if perf_elapsed.as_millis() >= 500 {
                        let secs = perf_elapsed.as_secs_f64();
                        let fps = frames_since_perf as f64 / secs;
                        let frame_time_us = start.elapsed().as_micros() as f64 / frame_count as f64;
                        let latency_ms = frame_time_us / 1000.0;
                        let cpu_pct = (latency_ms / (1000.0 / params.fps)) * 100.0;
                        perf.update(fps, 0.0, latency_ms, cpu_pct);
                        frames_since_perf = 0;
                        last_perf_update = Instant::now();
                    }

                    // Timing précis
                    let target_time = frame_count as u128 * frame_duration.as_nanos();
                    let current_time = start.elapsed().as_nanos();
                    if target_time > current_time {
                        let sleep_ns = (target_time - current_time) as u64;
                        std::thread::sleep(Duration::from_nanos(sleep_ns));
                    }
                    continue; // Skip OSC + callback (géré par le MergeRuntime)
                }

                // ── Mode legacy (OSC direct) ──
                // Lire les osc_ids (hot-swappable) depuis l'arc
                let osc_ids = osc_ids_arc.read().unwrap_or_else(|e| e.into_inner()).clone();
                let positions: Vec<(usize, nalgebra::Vector3<f64>)> = {
                    let fn_ref = position_fn_arc.lock().unwrap_or_else(|e| e.into_inner());
                    let ovr = overrides.lock();
                    let origin_local = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());
                    osc_ids
                        .iter()
                        .enumerate()
                        .map(|(obj_idx, &_osc_id)| {
                            // Si un override existe pour cet objet, l'utiliser
                            let raw_pos = if let Some(override_pos) = ovr.get(&obj_idx) {
                                *override_pos
                            } else {
                                // Appliquer le phase_offset pour cette track
                                let phase_off =
                                    track_phase_offsets.get(obj_idx).copied().unwrap_or(0.0);
                                let t_with_phase = if duration > 0.0 {
                                    t_eff + (phase_off / 360.0) * duration
                                } else {
                                    t_eff
                                };
                                let t_looped = if loop_is_on && duration > 0.0 {
                                    t_with_phase % duration
                                } else {
                                    t_with_phase
                                };
                                // catch_unwind: protection contre les panics de position_fn
                                // lors du hot-swap (obj_idx > n_objects compilé)
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    fn_ref(t_looped, obj_idx)
                                }))
                                    .unwrap_or_else(|_| nalgebra::Vector3::zeros())
                            };

                            // Appliquer radius_scale : scaling radial par rapport à l'origin
                            // (multiplie la distance à l'origin, pas la position absolue)
                            let pos_scaled_radius = if (effective_radius_scale - 1.0).abs() > 1e-10
                            {
                                origin_local + (raw_pos - origin_local) * effective_radius_scale
                            } else {
                                raw_pos
                            };

                            // Appliquer height_offset : translation Y post-engine
                            let pos_with_height = if effective_height_offset.abs() > 1e-10 {
                                nalgebra::Vector3::new(
                                    pos_scaled_radius.x,
                                    pos_scaled_radius.y + effective_height_offset,
                                    pos_scaled_radius.z,
                                )
                            } else {
                                pos_scaled_radius
                            };

                            // Appliquer le depth : interpoler entre origin et raw_pos, multiplié par le fade
                            let depth =
                                track_depths.get(obj_idx).copied().unwrap_or(1.0) * fade_factor;
                            let pos_with_depth =
                                origin_local + (pos_with_height - origin_local) * depth;

                            (obj_idx, pos_with_depth)
                        })
                        .collect()
                };

                // Lire l'osc sender (hot-swappable pour profil/offset)
                let sender = osc_sender_arc.lock().unwrap_or_else(|e| e.into_inner());

                // Précalculer la matrice de rotation si rotation non-nulle
                let has_rotation = eff_yaw != 0.0 || eff_pitch != 0.0 || eff_roll != 0.0;
                let rot_matrix = if has_rotation {
                    use nalgebra::Rotation3;
                    let ry = Rotation3::from_axis_angle(
                        &nalgebra::Vector3::y_axis(),
                        eff_yaw.to_radians(),
                    );
                    let rx = Rotation3::from_axis_angle(
                        &nalgebra::Vector3::x_axis(),
                        eff_pitch.to_radians(),
                    );
                    let rz = Rotation3::from_axis_angle(
                        &nalgebra::Vector3::z_axis(),
                        eff_roll.to_radians(),
                    );
                    Some(rz * rx * ry)
                } else {
                    None
                };

                // Lire l'origin (isobarycentre des tracks)
                let origin = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());

                // Envoyer OSC pour tous les objets (sauf en mode preview)
                let is_preview = config.is_preview_mode();
                if !is_preview {
                    for (obj_idx, pos) in &positions {
                        let osc_id = osc_ids[*obj_idx];
                        // Appliquer macros: effective_scale → rotation → origin + shift
                        // Note: pos contient déjà le depth appliqué, on scale par rapport à origin
                        let pos_scaled = pos * effective_scale;
                        let pos_rotated = if let Some(ref rot) = rot_matrix {
                            rot * pos_scaled
                        } else {
                            pos_scaled
                        };
                        let pos_final = pos_rotated + origin + eff_shift;
                        let (addr, values) = sender.format_position(osc_id, pos_final);
                        let args: Vec<OscType> =
                            values.iter().map(|v| OscType::Float(*v as f32)).collect();

                        let packet = OscPacket::Message(OscMessage {
                            addr: addr.clone(),
                            args,
                        });

                        if let Ok(bytes) = rosc::encoder::encode(&packet) {
                            if let Err(e) = socket.send(&bytes) {
                                log_osc_error(&format!("Failed to send OSC: {e}"));
                            } else {
                                log_osc_message(&addr, values.len());
                                osc_since_perf += 1;
                            }
                        }
                    }
                }

                // Appeler le callback avec les positions transformées (pour preview 3D)
                if let Ok(cb) = position_callback.lock() {
                    if let Some(ref callback) = *cb {
                        let transformed: Vec<(usize, nalgebra::Vector3<f64>)> = positions
                            .iter()
                            .map(|(idx, pos)| {
                                let ps = pos * effective_scale;
                                let pr = if let Some(ref rot) = rot_matrix {
                                    rot * ps
                                } else {
                                    ps
                                };
                                (*idx, pr + origin + eff_shift)
                            })
                            .collect();
                        callback(t, transformed);
                    }
                }

                frame_count += 1;
                frames_since_perf += 1;

                // Update perf stats every ~500ms
                let perf_elapsed = last_perf_update.elapsed();
                if perf_elapsed.as_millis() >= 500 {
                    let secs = perf_elapsed.as_secs_f64();
                    let fps = frames_since_perf as f64 / secs;
                    let osc_rate = osc_since_perf as f64 / secs;
                    let frame_time_us = start.elapsed().as_micros() as f64 / frame_count as f64;
                    let latency_ms = frame_time_us / 1000.0;
                    let cpu_pct = (latency_ms / (1000.0 / params.fps)) * 100.0;

                    perf.update(fps, osc_rate, latency_ms, cpu_pct);

                    frames_since_perf = 0;
                    osc_since_perf = 0;
                    last_perf_update = Instant::now();
                }

                // Timing précis — std::thread::sleep rend la main à l'OS
                let target_time = frame_count as u128 * frame_duration.as_nanos();
                let current_time = start.elapsed().as_nanos();

                if target_time > current_time {
                    let sleep_ns = (target_time - current_time) as u64;
                    std::thread::sleep(Duration::from_nanos(sleep_ns));
                }
            }
        });
        Ok(handle)
    }

    /// Arrête le playback
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        log_playback_stop();
    }

    pub fn get_perf_stats(&self) -> PerfStats {
        self.perf.get_stats()
    }
    pub fn set_override(&self, obj_index: usize, pos: nalgebra::Vector3<f64>) {
        self.overrides.set(obj_index, pos);
    }
    pub fn clear_override(&self, obj_index: usize) {
        self.overrides.clear(obj_index);
    }
    pub fn clear_all_overrides(&self) {
        self.overrides.clear_all();
    }
    pub fn set_preview_mode(&self, enabled: bool) {
        self.config.set_preview_mode(enabled);
    }
    pub fn is_preview_mode(&self) -> bool {
        self.config.is_preview_mode()
    }

    /// Vérifie si le runtime est en cours d'exécution
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Recall d'un cue avec crossfade — hot-swap la position_fn avec interpolation
    /// `from_fn` = fonction actuelle, `to_fn` = fonction du cue cible
    /// `fade_duration` = durée du crossfade en secondes (0 = instantané)
    pub fn recall_cue(&self, to_fn: PositionFn, fade_duration: f64) {
        if fade_duration <= 0.0 {
            // Recall instantané
            self.swap_position_fn(to_fn);
            return;
        }

        // Capturer la fonction actuelle et créer un crossfade
        let from_fn = {
            // On ne peut pas cloner Box<dyn Fn>, donc on swap avec un placeholder
            // et on prend ownership de l'ancienne fn pour le crossfade
            let placeholder: PositionFn = Box::new(|_t, _i| nalgebra::Vector3::zeros());
            let mut guard = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());

            std::mem::replace(&mut *guard, placeholder)
        };

        let fade_start = Instant::now();
        let crossfade_fn: PositionFn = Box::new(move |t, i| {
            let elapsed = fade_start.elapsed().as_secs_f64();
            if elapsed >= fade_duration {
                to_fn(t, i)
            } else {
                let blend = elapsed / fade_duration;
                // smoothstep ease in-out
                let blend = blend * blend * (3.0 - 2.0 * blend);
                let from_pos = from_fn(t, i);
                let to_pos = to_fn(t, i);
                from_pos + (to_pos - from_pos) * blend
            }
        });

        self.swap_position_fn(crossfade_fn);
    }
}
