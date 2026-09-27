use crate::animation::AnimationState;
use crate::audio::AudioState;
use crate::engines::EngineParams;
use crate::error::{Result, StagespaceError};
use crate::logging::{log_playback_start, log_playback_stop, log_runtime_init};
use crate::position_buffer::PositionBuffer;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

mod config;
mod macros;
mod overrides;
mod perf;
#[cfg(test)]
mod tests;
mod types;

pub use config::*;
pub use macros::*;
pub use overrides::*;
pub use perf::*;
pub use types::*;

/// Worker de move pour le playback temps réel — conçu pour le live.
/// Calcule les positions et les écrit dans son `PositionBuffer` ; le
/// `MergeRuntime` se charge du merge, du post-processing global et de
/// l'envoi via le `PositionSink` injecté (aucun OSC direct ici).
pub struct Runtime {
    running: Arc<AtomicBool>,
    position_fn: Arc<Mutex<PositionFn>>,
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
    /// Buffer de positions — le worker écrit ses positions (world-space)
    /// à chaque frame ; le MergeRuntime lit tous les buffers pour faire
    /// le merge + post-processing + envoi via le sink.
    /// Requis pour `play_compiled` — `set_position_buffer` doit être
    /// appelé avant de démarrer le playback.
    position_buffer: Mutex<Option<Arc<PositionBuffer>>>,
    /// Duration du move — stockée en ms (AtomicU64) pour hot-swap en live.
    /// Le worker thread lit cette valeur à chaque frame au lieu de capturer
    /// la duration dans sa closure.
    duration_ms: Arc<std::sync::atomic::AtomicU64>,
    /// OSC ids du move — hot-swappable en live via set_osc_ids.
    /// Le worker thread lit cette valeur à chaque frame pour savoir
    /// combien de positions calculer.
    osc_ids_arc: Arc<std::sync::RwLock<Vec<u32>>>,
    /// Handle du thread de playback — join propre dans stop()
    thread_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Runtime {
    /// Crée un nouveau worker de move
    pub fn new() -> Self {
        Self::new_with_audio_state(Arc::new(Mutex::new(AudioState::new())))
    }

    /// Worker partageant l'`AudioState` de l'app — une seule source de vérité :
    /// le poller écrit dans l'Arc maître, tous les workers le lisent à chaque
    /// frame (plus de copies synchronisées par polling, plus de lag de 100ms).
    pub fn new_with_audio_state(audio_state: Arc<Mutex<AudioState>>) -> Self {
        // Runtime démarre avec une fonction identité — sera hot-swappée avant play
        let initial_fn: PositionFn = Box::new(|_t, _i| nalgebra::Vector3::zeros());
        Runtime {
            running: Arc::new(AtomicBool::new(false)),
            position_fn: Arc::new(Mutex::new(initial_fn)),
            macros: Arc::new(MacroState::new()),
            config: Arc::new(RuntimeConfig::new()),
            perf: Arc::new(PerfMonitor::new()),
            overrides: OverrideManager::new(),
            origin: Arc::new(Mutex::new(nalgebra::Vector3::zeros())),
            animation_state: Arc::new(Mutex::new(None)),
            audio_state,
            audio_param_overrides: Arc::new(Mutex::new(HashMap::new())),
            position_buffer: Mutex::new(None),
            duration_ms: Arc::new(std::sync::atomic::AtomicU64::new(4000)),
            osc_ids_arc: Arc::new(std::sync::RwLock::new(Vec::new())),
            thread_handle: Mutex::new(None),
        }
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

    /// Attache le buffer de positions — le worker y écrit ses positions
    /// (world-space) à chaque frame. Le MergeRuntime fait le merge +
    /// post-processing + envoi. Requis avant `play_compiled`.
    /// Le worker applique : speed, loop_mode, direction, phase_offset,
    /// fade, overrides, et le transform per-move complet
    /// (radius_scale → height_offset → fade/depth → scale → rotation →
    /// + origin + shift). Le merge applique les transforms globaux.
    pub fn set_position_buffer(&self, buffer: Arc<PositionBuffer>) {
        let mut buf = self
            .position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *buf = Some(buffer);
    }

    /// Accès au `Arc<PositionBuffer>` pour le test d'identité `ptr_eq` —
    /// utilisé par le superviseur backend (audit C5) pour vérifier qu'un
    /// stale-kill vise bien le worker de ce runtime et pas un move plus
    /// récent ayant réutilisé le même id.
    pub fn position_buffer_arc(&self) -> Option<Arc<PositionBuffer>> {
        self.position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
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

    /// Lecture de l'animation state courant — utilisé par store_cue pour
    /// snapshoter depths/phases/audio mods (le recall les restaure).
    pub fn animation_state(&self) -> Option<AnimationState> {
        self.animation_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Enveloppe de fade du cycle (worker) — pour snapshot cue.
    pub fn fade(&self) -> (f64, f64) {
        self.config.get_fade()
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

    /// Hot-swap la fonction de position — pour cue recall sans arrêter le playback
    pub fn swap_position_fn(&self, new_fn: PositionFn) {
        let mut old = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        *old = new_fn;
    }

    /// Handle échantillonneur cheap-cloneable — capture les Arc nécessaires
    /// pour sampler HORS du lock `movements` (qui sinon bloque stop/recall
    /// pendant des milliers d'évaluations).
    pub fn sampler(&self) -> TrajectorySampler {
        TrajectorySampler {
            position_fn: self.position_fn.clone(),
            macros: self.macros.clone(),
            origin: self.origin.clone(),
        }
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
        self.sampler().sample(object_index, n_samples, duration)
    }
}

/// Échantillonneur detaché du Runtime — les mêmes Arc partagées, sans
/// besoin de tenir le lock `movements` du côté command.
#[derive(Clone)]
pub struct TrajectorySampler {
    position_fn: Arc<Mutex<PositionFn>>,
    macros: Arc<MacroState>,
    origin: Arc<Mutex<nalgebra::Vector3<f64>>>,
}

impl TrajectorySampler {
    /// Même sémantique que l'ancien `Runtime::sample_trajectory`.
    pub fn sample(
        &self,
        object_index: usize,
        n_samples: usize,
        duration: f64,
    ) -> Vec<(f64, f64, f64, f64)> {
        let msnap = self.macros.snapshot();
        let scale = msnap.scale;
        let shift = msnap.shift;
        let (yaw, pitch, roll) = (msnap.yaw, msnap.pitch, msnap.roll);
        let radius_scale = msnap.radius_scale;
        let height_offset = msnap.height_offset;

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
        // Origin du move : appliquée comme dans le playback loop (mode worker)
        // pour que les samples soient en world-space, cohérents avec le buffer.
        let origin = *self.origin.lock().unwrap_or_else(|e| e.into_inner());
        // Lock par chunks : tenir `position_fn` pendant tout le sampling
        // affame le worker live → stale-kill par le merge au-delà de ~0.5s.
        const SAMPLE_CHUNK: usize = 512;
        for chunk_start in (0..n_samples).step_by(SAMPLE_CHUNK) {
            let chunk_end = (chunk_start + SAMPLE_CHUNK).min(n_samples);
            {
                let fn_ref = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());
                for i in chunk_start..chunk_end {
                    let t = (i as f64 / (n_samples - 1).max(1) as f64) * duration;
                    let pos = fn_ref(t, object_index);
                    // Même chaîne que le worker : radius_scale → height_offset →
                    // (fade=1) → scale → rotation → + origin + shift
                    let pos_final = move_transform(
                        pos,
                        origin,
                        scale,
                        shift,
                        rot_matrix.as_ref(),
                        radius_scale,
                        height_offset,
                        1.0,
                    );
                    samples.push((t, pos_final.x, pos_final.y, pos_final.z));
                }
            }
        }
        samples
    }
}

impl Runtime {
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
    ) -> Result<()> {
        // Garde anti double-spawn : un second appel orphelinerait le worker
        // existant — les deux threads écriraient dans le même PositionBuffer
        // à des horloges indépendantes. CAS pour être race-safe.
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(StagespaceError::RuntimeError(
                "Runtime is already running — call stop() before play_compiled()".to_string(),
            ));
        }

        // Un worker sans buffer n'a aucune sortie — refuser plutôt que
        // de tourner dans le vide en silence.
        let buffer = self
            .position_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| {
                // Rollback du flag running — le spawn n'aura pas lieu
                self.running.store(false, Ordering::SeqCst);
                StagespaceError::RuntimeError(
                    "play_compiled requires a PositionBuffer — call set_position_buffer() first"
                        .to_string(),
                )
            })?;

        log_runtime_init(params.fps, params.n_objects);
        log_playback_start(params.duration);

        // Hot-swap la fonction
        self.swap_position_fn(position_fn);

        let running = self.running.clone();
        // Stocker la duration dans le champ partagé pour hot-swap en live
        self.set_duration(params.duration);
        // Stocker les osc_ids dans le champ partagé pour hot-swap en live
        self.set_osc_ids(osc_ids.clone());
        let duration_arc = self.duration_ms.clone();
        let osc_ids_arc = self.osc_ids_arc.clone();
        let position_fn_arc = self.position_fn.clone();
        let macros = self.macros.clone();
        let config = self.config.clone();
        let perf = self.perf.clone();
        let overrides = self.overrides.clone();
        let origin_arc = self.origin.clone();
        let anim_state_arc = self.animation_state.clone();
        let audio_state_arc = self.audio_state.clone();
        let audio_param_overrides_arc = self.audio_param_overrides.clone();

        let handle = std::thread::spawn(move || {
            // RAII : si la closure panique (bug engine, poison critique),
            // `running` resterait true pour toujours — le merge et l'UI
            // croiraient le worker vivant (zombie silencieux). Le guard
            // garantit is_running() honnête quel que soit le chemin de sortie.
            struct ClearRunning(Arc<std::sync::atomic::AtomicBool>);
            impl Drop for ClearRunning {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::SeqCst);
                }
            }
            let _clear_running = ClearRunning(running.clone());

            let start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / params.fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;

            while running.load(Ordering::SeqCst) {
                let elapsed = start.elapsed();
                let t_real = elapsed.as_secs_f64();

                // Lire la duration (hot-swappable) depuis l'AtomicU64
                let duration = duration_arc.load(Ordering::Relaxed) as f64 / 1000.0;

                // Lire les macros temps réel — snapshot seqlock : les 6
                // champs viennent de la même écriture (pas de transform mixte).
                let msnap = macros.snapshot();
                let speed = msnap.speed;
                let scale = msnap.scale;
                let shift = msnap.shift;
                let (yaw, pitch, roll) = (msnap.yaw, msnap.pitch, msnap.roll);
                let radius_scale = msnap.radius_scale;
                let height_offset = msnap.height_offset;

                // Appliquer speed: temps virtuel — clamp >= 0 : un speed
                // négatif (macro ou audio mod) enverrait un t négatif aux
                // engines (les sims freezent, les sinusoïdes tournent à rebours)
                // Lire la direction
                let dir = config.get_direction();

                // Gérer loop vs one-shot
                let loop_is_on = config.get_loop_mode() == LoopMode::Loop;

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

                // Recalculer le temps virtuel avec le speed effectif
                // (audio-modulé) — même clamp >= 0 que ci-dessus
                let t_virtual_eff = (t_real * effective_speed).max(0.0);
                let t_eff = if loop_is_on && duration > 0.0 {
                    let t_mod = t_virtual_eff % duration;
                    // Appliquer la direction (Forward/Backward/PingPong)
                    match dir {
                        PlayDirection::Backward => duration - t_mod,
                        PlayDirection::PingPong => {
                            let cycle = (t_virtual_eff / duration) as u64;
                            if cycle.is_multiple_of(2) {
                                t_mod
                            } else {
                                duration - t_mod
                            }
                        }
                        PlayDirection::Forward => t_mod,
                    }
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

                // Calculer la position MONDE du move — transform per-move :
                // radius_scale → height_offset → fade×depth → scale →
                // rotation → + origin + shift — et écrire dans le buffer.
                // Le MergeRuntime fera le merge + post-processing GLOBAL.
                // Lire les osc_ids (hot-swappable) depuis l'arc
                let osc_ids = osc_ids_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                // Origin du move (ancre monde de la trajectoire) — lue à
                // chaque frame pour refléter un set_origin en cours de jeu.
                let move_origin = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());
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
                                .unwrap_or_else(|_e| nalgebra::Vector3::zeros())
                            };
                            // Depth per-track × fade cycle — les deux contractent
                            // la trajectoire vers l'ancre du move (même sémantique
                            // radiale, composées comme dans l'ancienne chaîne).
                            let radial =
                                track_depths.get(obj_idx).copied().unwrap_or(1.0) * fade_factor;
                            let pos = move_transform(
                                raw_pos,
                                move_origin,
                                effective_scale,
                                eff_shift,
                                rot_matrix.as_ref(),
                                effective_radius_scale,
                                effective_height_offset,
                                radial,
                            );
                            (obj_idx, pos)
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

                // Timing précis — std::thread::sleep rend la main à l'OS.
                // Ré-ancrage après un stall (>30 frames de retard) pour éviter
                // une rafale de packets OSC stale — même politique que le
                // MergeRuntime.
                pace_frame_clock(&mut frame_count, frame_duration, start);
            }

            // Sortie naturelle du loop (one-shot terminé, erreur, etc.) :
            // on nettoie le flag pour que is_running() ne reste pas stale true.
            running.store(false, Ordering::SeqCst);
        });
        // Stocker le handle pour join propre dans stop()
        *self.thread_handle.lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);
        Ok(())
    }

    /// Arrête le playback et join le thread proprement — idempotent
    /// (appelable plusieurs fois, y compris depuis Drop)
    pub fn stop(&self) {
        let was_running = self.running.swap(false, Ordering::SeqCst);
        // Join le thread pour éviter stale OSC + use-after-free
        if let Some(handle) = self
            .thread_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = handle.join();
        }
        if was_running {
            log_playback_stop();
        }
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
        // Tout le swap se fait sous UN SEUL hold du lock : un frame live ne
        // peut jamais évaluer le placeholder zeros (sinon tous les tracks
        // sauteraient à l'origine pendant ~16ms à chaque cue fade).
        let mut guard = self.position_fn.lock().unwrap_or_else(|e| e.into_inner());
        if fade_duration <= 0.0 {
            // Recall instantané
            *guard = to_fn;
            return;
        }

        // On ne peut pas cloner Box<dyn Fn> : on prend ownership de l'ancienne
        // fn via mem::replace, puis on ré-assigne immédiatement le crossfade
        // sous le même guard — le placeholder n'est jamais visible.
        let placeholder: PositionFn = Box::new(|_t, _i| nalgebra::Vector3::zeros());
        let from_fn = std::mem::replace(&mut *guard, placeholder);

        let fade_start = Instant::now();
        *guard = Box::new(move |t, i| {
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
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Runtime {
    /// Live-safety : drop sans stop() explicite join quand même le worker —
    /// sinon le thread orphelin continue d'émettre de l'OSC / d'écrire dans
    /// le PositionBuffer après la mort du Runtime.
    fn drop(&mut self) {
        self.stop();
    }
}

/// Seuil de frames de retard tolérées avant de ré-ancrer le frame clock.
/// Au-delà, on saute les frames manquées plutôt que de bourster des packets
/// OSC stale (même politique que le MergeRuntime : >30 frames).
const MAX_CATCHUP_FRAMES: u64 = 30;

/// Pacing du worker : dort jusqu'au timeslot de `frame_count`. Si le retard
/// dépasse `MAX_CATCHUP_FRAMES` (stall du scheduler, breakpoint, etc.),
/// avance `frame_count` pour se ré-ancrer sur l'horloge réelle — évite une
/// rafale de frames obsolètes. `t` reste monotone (basé sur `start`).
fn pace_frame_clock(frame_count: &mut u64, frame_duration: Duration, start: Instant) {
    let frame_ns = frame_duration.as_nanos().max(1);
    let target_time = *frame_count as u128 * frame_ns;
    let current_time = start.elapsed().as_nanos();
    if target_time > current_time {
        std::thread::sleep(Duration::from_nanos((target_time - current_time) as u64));
    } else {
        let behind_ns = current_time - target_time;
        if behind_ns > MAX_CATCHUP_FRAMES as u128 * frame_ns {
            *frame_count += (behind_ns / frame_ns) as u64;
        }
    }
}

/// Transform per-move : convertit une position locale (sortie de la
/// `position_fn`, centrée ~0) en position monde pour ce move.
///
/// La chaîne se fait en ESPACE LOCAL — chaque transform pivote
/// naturellement autour du centre de la trajectoire — puis une seule
/// translation `+ origin + shift` amène la position en world-space :
///   radius_scale → height_offset → fade → scale → rotation → + origin + shift
///
/// NB : ceci corrige une fuite d'origin de l'ancienne chaîne legacy
/// (`O + (pos-O)*k` suivi d'un `+O` final = ancre dérivée à `(2-k)·O` ;
/// un fade à 0 collapsait vers `2·origin` au lieu de l'ancre du move).
/// Le depth/track_depths n'est PAS appliqué ici — il relève du post-process
/// global du MergeRuntime.
#[allow(clippy::too_many_arguments)]
fn move_transform(
    raw: nalgebra::Vector3<f64>,
    origin: nalgebra::Vector3<f64>,
    scale: f64,
    shift: nalgebra::Vector3<f64>,
    rot_matrix: Option<&nalgebra::Rotation3<f64>>,
    radius_scale: f64,
    height_offset: f64,
    fade: f64,
) -> nalgebra::Vector3<f64> {
    // radius_scale : scaling radial autour du centre de la trajectoire
    let pos = if (radius_scale - 1.0).abs() > 1e-10 {
        raw * radius_scale
    } else {
        raw
    };
    // height_offset : translation Y post-engine
    let pos = if height_offset.abs() > 1e-10 {
        nalgebra::Vector3::new(pos.x, pos.y + height_offset, pos.z)
    } else {
        pos
    };
    // fade : enveloppe temporelle — collapse vers le centre de la
    // trajectoire (= l'ancre du move après translation)
    let pos = if (fade - 1.0).abs() > 1e-10 {
        pos * fade
    } else {
        pos
    };
    // scale → rotation
    let pos = pos * scale;
    let pos = if let Some(rot) = rot_matrix {
        rot * pos
    } else {
        pos
    };
    // Local → monde : une seule translation vers l'ancre du move
    pos + origin + shift
}
