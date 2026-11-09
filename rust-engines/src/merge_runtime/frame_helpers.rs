//! Blocs autonomes de la frame merge — extraits de loop_core.rs (Phase 6
//! sanitation, règle modularisation). Chaque fonction ne touche que les
//! Arcs passés en paramètre : aucune capture du contexte de la boucle.

use super::*;

/// Position tape replay — avance le curseur et injecte
/// les entrées échues en positions manuelles (rythme
/// réel, timing backend).
pub(super) fn advance_tape_replay(
    tape_play: &Arc<RwLock<Option<TapePlayState>>>,
    manual_positions: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
) {
    let mut play = tape_play.write().unwrap_or_else(|e| e.into_inner());
    if let Some((start, entries, cursor)) = play.as_mut() {
        let elapsed = start.elapsed().as_secs_f64();
        let mut manual = manual_positions.write().unwrap_or_else(|e| e.into_inner());
        while *cursor < entries.len() && entries[*cursor].0 <= elapsed {
            for (obj, pos) in &entries[*cursor].1 {
                manual.insert(*obj, *pos);
            }
            *cursor += 1;
        }
        if *cursor >= entries.len() {
            *play = None; // bande finie
        }
    }
}

/// Grab & throw : intègre les lancés — pos += v·dt avec
/// amortissement ; |v| < eps → position manuelle au repos.
pub(super) fn integrate_thrown(
    thrown: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    manual_positions: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    dt: f64,
) {
    let mut thrown = thrown.write().unwrap_or_else(|e| e.into_inner());
    if !thrown.is_empty() {
        let damp = (-2.0 * dt).exp(); // ~amortissement 2/s
        let mut manual = manual_positions.write().unwrap_or_else(|e| e.into_inner());
        thrown.retain(|obj, vel| {
            if let Some(p) = manual.get_mut(obj) {
                p[0] += vel[0] * dt;
                p[1] += vel[1] * dt;
                p[2] += vel[2] * dt;
            }
            vel[0] *= damp;
            vel[1] *= damp;
            vel[2] *= damp;
            let speed2 = vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2];
            speed2 > 1e-4 // retiré quand quasi-arrêté
        });
    }
}

/// Vu-mètre perceptuel — vitesses par frame sur `transformed`
/// (espace canonique — ce que l'opérateur perçoit, pas le
/// payload venue-mappé).
pub(super) fn update_perceptual(
    transformed: &[(usize, nalgebra::Vector3<f64>)],
    prev_transformed: &mut HashMap<usize, nalgebra::Vector3<f64>>,
    prev_perceptual_instant: &mut Option<Instant>,
    perceptual: &Arc<RwLock<PerceptualMetrics>>,
) {
    let now = Instant::now();
    let dt = prev_perceptual_instant
        .map(|p: Instant| (now - p).as_secs_f64())
        .unwrap_or(0.0);
    if dt > 1e-3 {
        let mut metrics = PerceptualMetrics::default();
        let mut pos_count = 0usize;
        let mut same_sign = 0usize;
        let mut dominant = 0i32;
        for (obj_idx, pos) in transformed {
            let Some(prev) = prev_transformed.get(obj_idx) else {
                continue;
            };
            let v = (pos - prev) / dt;
            let r = pos.norm();
            if r < 0.01 {
                continue;
            }
            let radial = v.dot(pos) / r;
            let tangential = (v - pos * (radial / r)).norm();
            metrics
                .legibility_deg_s
                .insert(*obj_idx, (tangential / r).to_degrees());
            if -radial > metrics.looming_ms {
                metrics.looming_ms = -radial;
            }
            let az = pos.x * v.y - pos.y * v.x; // composante azimutale
            if az.abs() > 1e-4 {
                pos_count += 1;
                let s = if az > 0.0 { 1 } else { -1 };
                if dominant == 0 {
                    dominant = s;
                }
                if s == dominant {
                    same_sign += 1;
                }
            }
        }
        metrics.vection = if pos_count > 0 {
            same_sign as f64 / pos_count as f64
        } else {
            0.0
        };
        *perceptual.write().unwrap_or_else(|e| e.into_inner()) = metrics;
    }
    *prev_transformed = transformed.iter().map(|(i, p)| (*i, *p)).collect();
    *prev_perceptual_instant = Some(now);
}

/// Position tape record — snapshot décimé (~30Hz) des
/// positions émises (t depuis le début de la bande).
pub(super) fn maybe_record_tape(
    tape_recording: &Arc<std::sync::atomic::AtomicBool>,
    tape_frame_ctr: &mut u64,
    tape_t0: &mut Option<Instant>,
    last_canonical: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    pos_tape: &Arc<RwLock<Vec<TapeFrame>>>,
) {
    if tape_recording.load(std::sync::atomic::Ordering::Relaxed) {
        *tape_frame_ctr = tape_frame_ctr.wrapping_add(1);
        if tape_frame_ctr.is_multiple_of(2) {
            let t = tape_t0
                .map(|t0| t0.elapsed().as_secs_f64())
                .unwrap_or_else(|| {
                    *tape_t0 = Some(Instant::now());
                    0.0
                });
            // On enregistre le canonique pré-pp — sinon le
            // replay en manual_positions subirait les macros
            // une seconde fois (double-transform).
            let snap: HashMap<usize, [f64; 3]> = last_canonical
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            pos_tape
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .push((t, snap));
        }
    }
}

/// Dump du profiling par site (STAGESPACE_LOCK_PROF=1) : toutes
/// les 5 s, top des sites par attente cumulée ramenée à la
/// frame — attribution fine de la contention sans coût quand
/// le flag est absent (lock_sites reste vide).
pub(super) fn maybe_dump_lock_prof(
    lock_profiling: bool,
    lock_profile_frames: &mut u64,
    lock_profile_total_ns: &mut u64,
    last_lock_dump: &mut Instant,
    lock_sites: &mut HashMap<&'static str, u64>,
    lock_wait_ns: u64,
) {
    if lock_profiling {
        *lock_profile_frames += 1;
        *lock_profile_total_ns += lock_wait_ns;
        if last_lock_dump.elapsed() >= Duration::from_secs(5) {
            let frames = (*lock_profile_frames).max(1) as f64;
            let mut ranked: Vec<(&'static str, u64)> = lock_sites.drain().collect();
            ranked.sort_by_key(|entry| std::cmp::Reverse(entry.1));
            let top = ranked
                .iter()
                .take(10)
                .map(|(name, ns)| format!("{name}={:.0}", *ns as f64 / frames))
                .collect::<Vec<_>>()
                .join(" ");
            eprintln!(
                "[lock-prof] {} frames, wait_total={:.0} ns/frame :: {}",
                *lock_profile_frames,
                *lock_profile_total_ns as f64 / frames,
                top
            );
            *lock_profile_frames = 0;
            *lock_profile_total_ns = 0;
            *last_lock_dump = Instant::now();
        }
    }
}

/// Timing précis + re-ancrage : après un stall (pause debug,
/// emit bloquant, préemption), on ne burst pas des centaines de
/// frames obsolètes — on ré-ancre frame_count sur le temps réel.
pub(super) fn pace_frame(start: &mut Instant, frame_count: &mut u64, frame_duration: Duration) {
    let target_time = *frame_count as u128 * frame_duration.as_nanos();
    let current_time = start.elapsed().as_nanos();
    if target_time > current_time {
        let sleep_ns = (target_time - current_time) as u64;
        // std::thread::sleep au lieu de spin_sleep — rend la main à
        // l'OS. Précision ~1-2ms suffisante pour 60 FPS.
        std::thread::sleep(Duration::from_nanos(sleep_ns));
    } else if current_time - target_time > CATCHUP_FRAME_LIMIT * frame_duration.as_nanos() {
        *start = Instant::now();
        *frame_count = 0;
    }
}

/// Parking post-panic : envoyer l'origin à toutes les tracks (même
/// comportement que le panic côté app) avant de mourir.
/// Mêmes contrats que la boucle d'envoi : dry-run = rien
/// ne part, et venue_map s'applique (salle adaptée).
pub(super) fn park_all_objects(
    osc_armed: &Arc<AtomicBool>,
    sink: &SharedSink,
    osc_ids: &Arc<RwLock<Arc<Vec<u32>>>>,
    origin: &Arc<Mutex<nalgebra::Vector3<f64>>>,
    venue_map: &Arc<RwLock<Option<VenueMap>>>,
    position_callback: &Arc<Mutex<Option<PreviewSender>>>,
) {
    if osc_armed.load(Ordering::SeqCst) {
        let origin = *origin.lock().unwrap_or_else(|e| e.into_inner());
        let send_origin = venue_map
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .map(|(s, o, yaw)| {
                let (c, sn) = (yaw.cos(), yaw.sin());
                let (x, y) = (origin.x * c - origin.y * sn, origin.x * sn + origin.y * c);
                nalgebra::Vector3::new(x * s[0] + o[0], y * s[1] + o[1], origin.z * s[2] + o[2])
            })
            .unwrap_or(origin);
        let ids = osc_ids.read().unwrap_or_else(|e| e.into_inner()).clone();
        let mut sink_guard = sink.lock().unwrap_or_else(|e| e.into_inner());
        for osc_id in ids.iter() {
            let _ = sink_guard.send_state(*osc_id, send_origin, None);
        }
    }
    let cb = position_callback
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if let Some(tx) = cb {
        // send (bloquant borné) plutôt que try_send : la frame
        // de parking DOIT passer — le pump est en général vide.
        let _ = tx.send((0.0, Vec::new()));
    }
}

/// État du flux OSC sur la fenêtre de perf courante — compteurs de
/// sends + état du circuit-breaker. Muté par la boucle d'envoi
/// (compteurs par paquet) et update_perf_window (trip du circuit).
/// Regroupé : les deux sites partagent le même état, un tuple de 6
/// &mut en signature serait illisible pour le même effet.
pub(super) struct OscFlow {
    pub sent: u64,
    pub errors: u64,
    pub refused: u64,
    pub bad_windows: u32,
    pub circuit_open: bool,
    pub last_probe: Instant,
}

impl OscFlow {
    pub fn new() -> Self {
        Self {
            sent: 0,
            errors: 0,
            refused: 0,
            bad_windows: 0,
            circuit_open: false,
            last_probe: Instant::now() - Duration::from_secs(1),
        }
    }
}

/// Perf monitor — agrégation des erreurs OSC (1 log max par
/// fenêtre de 500 ms au lieu d'un warn! par paquet échoué) +
/// circuit-breaker : 2 fenêtres de 500 ms à >50 % refused
/// = renderer mort → suspendre les sends (sonde à 1 Hz).
pub(super) fn update_perf_window(
    flow: &mut OscFlow,
    frames_since_perf: &mut u64,
    last_perf_update: &mut Instant,
    perf: &PerfMonitor,
    fps: f64,
    frame_start: Instant,
) {
    *frames_since_perf += 1;
    let perf_elapsed = last_perf_update.elapsed();
    if perf_elapsed.as_millis() >= 500 {
        let secs = perf_elapsed.as_secs_f64();
        let fps_actual = *frames_since_perf as f64 / secs;
        let osc_rate = flow.sent as f64 / secs;
        let frame_time_us = frame_start.elapsed().as_micros() as f64;
        let latency_ms = frame_time_us / 1000.0;
        let cpu_pct = (latency_ms / (1000.0 / fps)) * 100.0;
        let total_osc = flow.sent + flow.errors;
        let (error_rate, refused_rate) = if total_osc > 0 {
            (
                flow.errors as f64 / total_osc as f64,
                flow.refused as f64 / total_osc as f64,
            )
        } else {
            (0.0, 0.0)
        };
        if flow.errors > 0 {
            crate::logging::log_osc_error(&format!(
                "MergeRuntime OSC: {} erreurs / {} paquets sur {:.0} ms ({} refused)",
                flow.errors,
                total_osc,
                perf_elapsed.as_millis(),
                flow.refused
            ));
        }
        if !flow.circuit_open {
            if total_osc > 0 && refused_rate > 0.5 {
                flow.bad_windows += 1;
                if flow.bad_windows >= 2 {
                    flow.circuit_open = true;
                    // Sonde quasi-immédiate à la prochaine frame.
                    flow.last_probe = Instant::now() - Duration::from_secs(1);
                    crate::logging::log_osc_error(
                        "OSC circuit OPEN — target unreachable, suspending sends (probe @1Hz)",
                    );
                }
            } else {
                flow.bad_windows = 0;
            }
        }
        perf.set_osc_suspended(flow.circuit_open);
        perf.update_with_error_rate(
            fps_actual,
            osc_rate,
            latency_ms,
            cpu_pct,
            error_rate,
            refused_rate,
        );
        *frames_since_perf = 0;
        flow.sent = 0;
        flow.errors = 0;
        flow.refused = 0;
        *last_perf_update = Instant::now();
    }
}

/// Cinématique : vitesse/accélération/jerk sur les positions
/// finales (celles réellement envoyées au renderer), dt réel
/// entre frames pour une mesure correcte même en cas de jitter.
/// Court-circuit : aucune modulation déclarée → états vidés,
/// coût nul (les KinematicState ne servent qu'aux modulations).
#[allow(clippy::too_many_arguments)]
pub(super) fn update_kinematics(
    kinematic_states: &mut HashMap<usize, KinematicState>,
    transformed: &[(usize, nalgebra::Vector3<f64>)],
    prev_t: &mut Option<f64>,
    t_real: f64,
    dt: f64,
    kinematic_smoothing: &Arc<RwLock<f64>>,
    channel_modulations: &Arc<RwLock<Arc<Vec<ChannelModulation>>>>,
    graph_modulations: &Arc<RwLock<Arc<Vec<ChannelModulation>>>>,
    lock_wait_ns: &mut u64,
    lock_sites: &mut HashMap<&'static str, u64>,
    lock_profiling: bool,
) {
    let mut wait_ns = 0u64;
    let kin_dt = prev_t.map(|p| (t_real - p).max(1e-6)).unwrap_or(dt);
    *prev_t = Some(t_real);
    let kin_smoothing = *timed_lock!(
        wait_ns,
        lock_sites,
        lock_profiling,
        "kin_smoothing.read",
        kinematic_smoothing
            .read()
            .unwrap_or_else(|e| e.into_inner())
    );
    let has_modulations = !timed_lock!(
        wait_ns,
        lock_sites,
        lock_profiling,
        "channel_modulations.read",
        channel_modulations
            .read()
            .unwrap_or_else(|e| e.into_inner())
    )
    .is_empty()
        || !timed_lock!(
            wait_ns,
            lock_sites,
            lock_profiling,
            "graph_modulations.read",
            graph_modulations.read().unwrap_or_else(|e| e.into_inner())
        )
        .is_empty();
    *lock_wait_ns += wait_ns;
    if has_modulations {
        let present: std::collections::HashSet<usize> =
            transformed.iter().map(|(i, _)| *i).collect();
        for (obj_idx, pos) in transformed {
            kinematic_states
                .entry(*obj_idx)
                .or_default()
                .update(*pos, kin_dt, kin_smoothing);
        }
        kinematic_states.retain(|idx, _| present.contains(idx));
    } else if !kinematic_states.is_empty() {
        kinematic_states.clear();
    }
}
