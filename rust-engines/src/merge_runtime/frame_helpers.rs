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
        let mut manual = manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner());
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
        let mut manual = manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner());
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
        let ids = osc_ids
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
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
