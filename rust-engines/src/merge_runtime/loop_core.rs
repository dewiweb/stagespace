//! Boucle merge + lifecycle du thread — extrait de mod.rs (Phase 4 sanitation).
//! start() : spawn du thread merge 60fps ; stop() ; post-processeurs de samples.

use super::*;

impl MergeRuntime {
    /// Démarre le merge thread
    pub fn start(&mut self) -> crate::error::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(()); // Déjà démarré
        }

        self.running.store(true, Ordering::SeqCst);
        self.thread_died.store(false, Ordering::SeqCst);
        self.merge_frames.store(0, Ordering::SeqCst);
        let running = self.running.clone();
        let osc_armed_arc = self.osc_armed.clone();
        let thread_died = self.thread_died.clone();
        let merge_frames = self.merge_frames.clone();
        let dropped_positions = self.dropped_positions.clone();
        let sink_arc = self.sink.clone();
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
        let fps = self.fps;
        let post_process_fn_arc = self.post_process_fn.clone();
        let track_positions_arc = self.track_positions.clone();
        let manual_positions_arc = self.manual_positions.clone();
        let move_end_modes_arc = self.move_end_modes.clone();
        let last_out_positions_arc = self.last_out_positions.clone();
        let last_effective_channels_arc = self.last_effective_channels.clone();
        let last_canonical_arc = self.last_canonical_positions.clone();
        let held_objects_arc = self.held_objects.clone();
        let venue_map_arc = self.venue_map.clone();
        let perceptual_arc = self.perceptual.clone();
        let distance_reality_arc = self.distance_reality.clone();
        let thrown_arc = self.thrown.clone();
        let spatial_comp_arc = self.spatial_compression.clone();
        let tape_rec_arc = self.tape_recording.clone();
        let pos_tape_arc = self.pos_tape.clone();
        let tape_play_arc = self.tape_play.clone();
        let object_channels_arc = self.object_channels.clone();
        let zones_arc = self.zones.clone();
        let channel_modulations_arc = self.channel_modulations.clone();
        let kinematic_smoothing_arc = self.kinematic_smoothing.clone();
        let graph_zones_arc = self.graph_zones.clone();
        let graph_modulations_arc = self.graph_modulations.clone();
        let move_ref_id_arc = self.move_ref_id.clone();
        let stale_kill_ids = self.stale_kill_ids.clone();
        let signal_fn_arc = self.signal_fn.clone();
        let output_layer_arc = self.output_layer.clone();
        let osc_values_arc = self.osc_values.clone();

        let mut prev_transformed: HashMap<usize, nalgebra::Vector3<f64>> = HashMap::new();
        let mut prev_perceptual_instant: Option<Instant> = None;
        let mut tape_frame_ctr: u64 = 0;
        let mut tape_t0: Option<Instant> = None;
        let handle = std::thread::spawn(move || {
            let mut start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;
            let mut osc_since_perf = 0u64;
            let mut osc_errors_perf = 0u64;
            let mut osc_refused_perf = 0u64;
            // Circuit-breaker OSC (C6) : si >50 % des paquets reviennent en
            // ECONNREFUSED sur 2 fenêtres de perf consécutives (~1 s), la
            // destination est morte — on suspend les sends (le merge et le
            // preview continuent) et on sonde à 1 Hz via l'état réel du
            // premier objet. Une sonde réussie referme le circuit ; si la
            // panne persiste les fenêtres refused re-tripent naturellement.
            // Sans ça : 30 000 encodages/s + sends perdus indéfiniment, et
            // le sweep de PANIC retardé d'autant.
            let mut osc_circuit_open = false;
            let mut osc_bad_windows = 0u32;
            let mut last_probe = Instant::now() - Duration::from_secs(1);
            // États cinématiques par objet — thread-local, aucun lock.
            // Mesurés sur les positions finales (post-merge + post-process).
            let mut kinematic_states: HashMap<usize, KinematicState> = HashMap::new();
            // Moves déjà warnés pour un mismatch track_indices/positions —
            // rate-limit : 1 log par move par épisode (audit I11).
            let mut mismatch_warned: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            let mut prev_frame: Option<Instant> = None;
            let mut prev_t: Option<f64> = None;

            // Instrumentation de la contention des locks : chaque acquisition
            // du hot-path est chronométrée (Instant autour de l'appel) et le
            // total par frame va dans PerfStats.merge_lock_us. Coût : ~2
            // Instant::now() (~50 ns) par site × ~25 sites ≈ 1-2 µs/frame.
            // STAGESPACE_LOCK_PROF=1 active un dump par site toutes les 5 s
            // sur stderr (attribution fine de la contention).
            let lock_profiling = std::env::var_os("STAGESPACE_LOCK_PROF").is_some();
            let mut lock_sites: HashMap<&'static str, u64> = HashMap::new();
            let mut lock_profile_frames = 0u64;
            let mut lock_profile_total_ns = 0u64;
            let mut last_lock_dump = Instant::now();

            // Une frame complète du merge. Séparée en closure pour être
            // enveloppée dans catch_unwind : un panic (post-process, callback,
            // modulations…) ne doit PAS tuer le thread en silence — blackout
            // OSC total avec `running` toujours true. Avec catch_unwind on
            // marque thread_died, on envoie une frame de parking, puis on sort.
            let mut frame = || {
                let frame_start = Instant::now();
                // Attente cumulée des acquisitions de locks de CETTE frame —
                // publiée à la fin dans merge_lock_us (cf. timed_lock!).
                let mut lock_wait_ns = 0u64;
                let t_real = start.elapsed().as_secs_f64();
                // dt réel mesuré (jitter-tolérant) pour les fades
                let dt = prev_frame
                    .map(|p| (frame_start - p).as_secs_f64().max(1e-6))
                    .unwrap_or_else(|| frame_duration.as_secs_f64());
                prev_frame = Some(frame_start);

                // Position tape replay — avance le curseur et injecte
                // les entrées échues en positions manuelles (rythme
                // réel, timing backend).
                frame_helpers::advance_tape_replay(&tape_play_arc, &manual_positions_arc);

                // Grab & throw : intègre les lancés — pos += v·dt avec
                // amortissement ; |v| < eps → position manuelle au repos.
                frame_helpers::integrate_thrown(&thrown_arc, &manual_positions_arc, dt);

                // 1. Lire tous les buffers (read lock très court)
                let buffers = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "move_buffers.read",
                    move_buffers.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();

                // 2. Collecter les positions par move, avec fade et priorité
                // CRITICAL: ne pas tenir le write lock trop longtemps — register_move
                // a besoin d'accéder à active_moves.write() et sinon il est bloqué
                // pendant des secondes (lock starvation par le merge thread à 60 FPS).
                // Solution: clone les états sous un write lock très court, puis
                // traite tout hors lock.
                let mut move_positions: Vec<MoveEntry> = Vec::new();
                let mut preview_positions: Vec<(usize, nalgebra::Vector3<f64>)> = Vec::new();
                let mut moves_to_remove: Vec<String> = Vec::new();

                // --- Section critique courte: update fades + clone data ---
                let move_snapshots: Vec<(String, f64, f64, u32, Vec<usize>, bool)> = {
                    let mut moves_guard = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "active_moves.write",
                        active_moves.write().unwrap_or_else(|e| e.into_inner())
                    );
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
                        // Détection de worker zombie : si le PositionBuffer du
                        // move n'a pas été réécrit depuis STALE_FRAME_LIMIT
                        // frames de merge (~0.5 s à 60 FPS), le worker est mort
                        // ou fini — on retire le move au lieu de merger ses
                        // dernières positions indéfiniment.
                        let stale = buffers
                            .get(move_id)
                            .map(|b| {
                                timed_lock!(
                                    lock_wait_ns,
                                    lock_sites,
                                    lock_profiling,
                                    "posbuf.frame_count",
                                    b.frame_count()
                                ) == state.last_frame_count
                            })
                            .unwrap_or(false);
                        if stale {
                            state.stale_frames += 1;
                        } else {
                            state.stale_frames = 0;
                            state.last_frame_count = buffers
                                .get(move_id)
                                .map(|b| {
                                    timed_lock!(
                                        lock_wait_ns,
                                        lock_sites,
                                        lock_profiling,
                                        "posbuf.frame_count",
                                        b.frame_count()
                                    )
                                })
                                .unwrap_or(0);
                        }
                        // Grace allongée tant que le worker n'a jamais
                        // écrit (last_frame_count == 0 = jamais observé
                        // de write) — sinon un premier frame lent fait
                        // tuer le move avant sa première émission.
                        let stale_limit = if state.last_frame_count == 0 {
                            FRESH_STALE_FRAME_LIMIT
                        } else {
                            STALE_FRAME_LIMIT
                        };
                        if state.stale_frames > stale_limit {
                            crate::logging::log_osc_error(&format!(
                                "MergeRuntime: move {move_id} retiré — worker inactif depuis {} frames",
                                state.stale_frames
                            ));
                            state.is_active = false;
                            moves_to_remove.push(move_id.clone());
                            // EndMode::Hold — figer les dernières positions
                            // du buffer en positions manuelles : l'objet
                            // reste où le move l'a laissé (sémantique
                            // « continue » au lieu du retour à la base).
                            if move_end_modes_arc
                                .read()
                                .unwrap_or_else(|e| e.into_inner())
                                .get(move_id)
                                .is_some_and(|m| *m == crate::EndMode::Hold)
                            {
                                if let Some(buf) = buffers.get(move_id) {
                                    let positions = buf.read();
                                    let mut mp = manual_positions_arc
                                        .write()
                                        .unwrap_or_else(|e| e.into_inner());
                                    for (i, (_, pos)) in positions.iter().enumerate() {
                                        if let Some(&track) = state.track_indices.get(i) {
                                            mp.insert(track, [pos.x, pos.y, pos.z]);
                                            held_objects_arc
                                                .write()
                                                .unwrap_or_else(|e| e.into_inner())
                                                .insert(track);
                                        }
                                    }
                                }
                            }
                            // Audit C5 : publier l'ID + le buffer (test
                            // d'identité côté superviseur) pour arrêter
                            // réellement le thread worker — sinon il
                            // tourne à 100 % CPU après son retrait.
                            if let Some(buf) = buffers.get(move_id) {
                                Self::enqueue_stale_kill_into(
                                    &stale_kill_ids,
                                    move_id.clone(),
                                    buf.clone(),
                                );
                            }
                            continue;
                        }
                        snapshots.push((
                            move_id.clone(),
                            fade,
                            state.weight,
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

                // Lire les buffers et mapper hors lock. Les moves en PREVIEW
                // n'entrent PAS dans le merge : ils pourraient gagner le merge
                // (Override = fade le plus haut) sur une track partagée avec un
                // move live → track live mutée. Leurs positions vont
                // directement au callback display, sans toucher à l'OSC.
                for (move_id, fade, weight, priority, track_indices, is_preview) in &move_snapshots
                {
                    if let Some(buffer) = buffers.get(move_id) {
                        let positions = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "posbuf.read",
                            buffer.read()
                        );
                        if positions.is_empty() {
                            continue;
                        }
                        let global_positions: Vec<(usize, nalgebra::Vector3<f64>)> =
                            if track_indices.is_empty() {
                                mismatch_warned.remove(move_id.as_str());
                                positions.clone()
                            } else {
                                // Fenêtre de mismatch (routing non atomique
                                // pendant hot-swap) : avant, le move entier
                                // était sauté à chaque frame + warn×60/s.
                                // On clip à min(len) — un sous-ensemble qui
                                // bouge vaut mieux qu'un move muet — et on
                                // ne log qu'une fois par épisode.
                                if track_indices.len() != positions.len() {
                                    if mismatch_warned.insert(move_id.clone()) {
                                        crate::logging::log_osc_error(&format!(
                                            "MergeRuntime: move {} partially merged — track_indices.len()={} != positions.len()={} (clipped, further warnings suppressed)",
                                            move_id, track_indices.len(), positions.len()
                                        ));
                                    }
                                } else {
                                    mismatch_warned.remove(move_id.as_str());
                                }
                                let n = track_indices.len().min(positions.len());
                                positions
                                    .iter()
                                    .take(n)
                                    .enumerate()
                                    .map(|(local_idx, (_, pos))| (track_indices[local_idx], *pos))
                                    .collect()
                            };
                        if *is_preview {
                            preview_positions.extend(global_positions);
                        } else {
                            move_positions.push((
                                move_id.clone(),
                                *fade,
                                *weight,
                                *priority,
                                global_positions,
                            ));
                        }
                    }
                }

                // Nettoyer les buffers des moves retirés (write lock court)
                if !moves_to_remove.is_empty() {
                    let mut bufs = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "move_buffers.write",
                        move_buffers.write().unwrap_or_else(|e| e.into_inner())
                    );
                    let mut end_modes = move_end_modes_arc
                        .write()
                        .unwrap_or_else(|e| e.into_inner());
                    for id in &moves_to_remove {
                        // TOCTOU (revue des fixs F2) : le move_id a pu être
                        // réenregistré entre la suppression de active_moves
                        // et ici — ne supprimer buffer/end_mode que si c'est
                        // ENCORE le buffer observé stale, sinon on tue le
                        // nouveau move (buffers.get → None → jamais mergé,
                        // jamais stale-killé = blackout silencieux).
                        let same_buffer = match (bufs.get(id), buffers.get(id)) {
                            (Some(cur), Some(observed)) => Arc::ptr_eq(cur, observed),
                            (None, _) => true, // rien à protéger
                            (Some(_), None) => false,
                        };
                        if same_buffer {
                            bufs.remove(id);
                            // Sans ça un Hold stale survivrait : id réutilisé
                            // en Revert + stale-kill → Hold appliqué à tort.
                            // Couplée à same_buffer : le end_mode d'un move
                            // réenregistré appartient au nouveau, pas au stale.
                            end_modes.remove(id);
                        }
                    }
                }

                // Idle : aucun move live ni preview NI position manuelle →
                // sauter le travail lourd. Des manual_positions seules DOIVENT
                // émettre (reprise opérateur/PSN/tape/throw : l'opérateur peut
                // reprendre un objet sans move). Sans sleep ici la boucle
                // spinne à 100% CPU et martèle les locks.
                let manual_empty = manual_positions_arc
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_empty();
                if move_positions.is_empty() && preview_positions.is_empty() && manual_empty {
                    frame_count += 1;
                    let target_time = frame_count as u128 * frame_duration.as_nanos();
                    let current_time = start.elapsed().as_nanos();
                    if target_time > current_time {
                        std::thread::sleep(Duration::from_nanos(
                            (target_time - current_time) as u64,
                        ));
                    } else if current_time - target_time
                        > CATCHUP_FRAME_LIMIT * frame_duration.as_nanos()
                    {
                        start = Instant::now();
                        frame_count = 0;
                    }
                    return;
                }

                // 3. Merge : résoudre les conflits par track.
                let merge_work_start = Instant::now();
                let osc_ids = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "osc_ids.read",
                    osc_ids_arc.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let strategy = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "merge_strategy.read",
                    merge_strategy_arc.read().unwrap_or_else(|e| e.into_inner())
                );
                // merge_positions trie ses candidats par move_id → déterministe.
                // full_merged = le merge complet, avant MoveRef — last_canonical
                // (anchors/attention/throw/tape) doit couvrir TOUS les objets,
                // pas seulement celui du move référencé.
                let merged = merge_positions(&move_positions, strategy);
                let full_merged = merged.clone();

                // MoveRef (audit T2) : un node MoveRef avec `move_id`
                // déclaré dans le graph global remplace la source — la
                // chaîne post-process ne reçoit que les positions de ce
                // move. Move absent → positions vides (pas de fallback
                // silencieux sur le merge complet : le graphe demande
                // explicitement ce move).
                let mut merged = {
                    let move_ref = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "move_ref_id.read",
                        move_ref_id_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    match move_ref {
                        Some(ref id) => move_positions
                            .iter()
                            .find(|e| &e.0 == id)
                            .map(|e| e.4.clone())
                            .unwrap_or_default(),
                        None => merged,
                    }
                };

                // 4. Post-processing via le graph global compilé (PostProcessFn)
                // Snapshots Arc sous locks courts, puis tout hors lock.
                let origin = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "origin.lock",
                    origin_arc.lock().unwrap_or_else(|e| e.into_inner())
                );
                let track_depths = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "track_depths.read",
                    track_depths_arc.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let track_positions = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "track_positions.read",
                    track_positions_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let manual_positions = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "manual_positions.read",
                    manual_positions_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();

                // Objets en manual_positions hors merge (aucun move ne les
                // couvre) : reprise opérateur / PSN / tape / throw doivent
                // émettre même sans move live. Injecté DANS merged avant le
                // post-process → mêmes macros + sanitize que les objets
                // couverts (injecter en sortie post-sanitize laissait passer
                // du NaN et sautait l'espace macro — revue des fixs F1).
                for (obj_idx, pos) in manual_positions.iter() {
                    if !merged.iter().any(|(i, _)| i == obj_idx) {
                        merged.push((*obj_idx, nalgebra::Vector3::new(pos[0], pos[1], pos[2])));
                    }
                }

                // Positions canoniques pré-post-process — full_merged ∪ manual
                // (manual gagne, comme le pp). Graine des anchors/freeze/
                // throw : seed depuis last_out (post-macro) double-transforme.
                // full_merged (pas merged filtré par MoveRef) — sinon les
                // seeds perdent tous les objets hors move référencé.
                {
                    let mut canonical: HashMap<usize, [f64; 3]> = full_merged
                        .iter()
                        .map(|(i, p)| (*i, [p.x, p.y, p.z]))
                        .collect();
                    canonical.extend(manual_positions.iter().map(|(i, p)| (*i, *p)));
                    *last_canonical_arc
                        .write()
                        .unwrap_or_else(|e| e.into_inner()) = canonical;
                }
                let audio_state = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "audio_state.lock",
                    audio_state_arc.lock().unwrap_or_else(|e| e.into_inner())
                )
                .clone();

                // Signal graph : évalue la `SignalFn` compilée → deltas
                // additifs appliqués sur un clone effectif des macros.
                // La base (panel/OSC/cue) n'est jamais écrasée — couche
                // additive pure, les transforms lisent `ctx.macros` sans
                // changement.
                let signal_deltas = {
                    let mut signal = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "signal_fn.lock",
                        signal_fn_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    let deltas = {
                        let osc_map = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "osc_values.read",
                            osc_values_arc.read().unwrap_or_else(|e| e.into_inner())
                        )
                        .clone();
                        let osc_vals = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "osc_map.lock",
                            osc_map.lock().unwrap_or_else(|e| e.into_inner())
                        );
                        (*signal)(&crate::signal_compiler::SignalCtx {
                            t: t_real,
                            dt,
                            audio_state: &audio_state,
                            osc_values: &osc_vals,
                        })
                    };
                    deltas
                };
                let eff_macros = if signal_deltas.macros.is_empty() {
                    None
                } else {
                    Some(crate::signal_compiler::macro_with_deltas(
                        &macros,
                        &signal_deltas.macros,
                    ))
                };

                let ctx = PostProcessContext {
                    t: t_real,
                    macros: eff_macros.as_ref().unwrap_or_else(|| macros.as_ref()),
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    manual_positions: &manual_positions,
                    origin,
                    track_depths: &track_depths,
                };

                // Transition de recall en cours ? Snapshot de l'arbre —
                // `Live` = chemin classique inchangé ; un Blend terminé
                // retombe à Live (l'arbre n'accumule rien).
                let layer_snap = {
                    let mut g = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "output_layer.lock",
                        output_layer_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    if transition::layer_finished(&g) {
                        *g = transition::Layer::Live;
                    }
                    g.clone()
                };
                let transition_active = !matches!(layer_snap, transition::Layer::Live);
                // Les valeurs propres vivent ici (référencées par LiveInputs).
                let transition_owned = if transition_active {
                    let pp_fn = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "post_process_fn.read",
                        post_process_fn_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let live_channels = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "object_channels.read",
                        object_channels_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let live_zones: Vec<crate::zones::Zone> = {
                        let mut z = (**timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "graph_zones.read",
                            graph_zones_arc.read().unwrap_or_else(|e| e.into_inner())
                        ))
                        .clone();
                        z.extend(
                            timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "zones.read",
                                zones_arc.read().unwrap_or_else(|e| e.into_inner())
                            )
                            .iter()
                            .cloned(),
                        );
                        z
                    };
                    let live_mods: Vec<ChannelModulation> = {
                        let mut m = (**timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "graph_modulations.read",
                            graph_modulations_arc
                                .read()
                                .unwrap_or_else(|e| e.into_inner())
                        ))
                        .clone();
                        m.extend(
                            timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "channel_modulations.read",
                                channel_modulations_arc
                                    .read()
                                    .unwrap_or_else(|e| e.into_inner())
                            )
                            .iter()
                            .cloned(),
                        );
                        m
                    };
                    Some((pp_fn, live_channels, live_zones, live_mods))
                } else {
                    None
                };
                let live_common = transition_owned.as_ref().map(|_| transition::EvalCommon {
                    t: t_real,
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    macros_deltas: &signal_deltas.macros,
                });
                let live_layer =
                    transition_owned
                        .as_ref()
                        .map(|(pp_fn, ch, zo, mo)| transition::LiveInputs {
                            post_process_fn: pp_fn,
                            macros: eff_macros.as_ref().unwrap_or_else(|| macros.as_ref()),
                            manual_positions: &manual_positions,
                            track_depths: &track_depths,
                            object_channels: ch,
                            zones: zo,
                            modulations: mo,
                            origin,
                        });

                let transformed_raw: Vec<(usize, nalgebra::Vector3<f64>)> =
                    match (&live_layer, &live_common) {
                        (Some(live), Some(common)) => {
                            // Transition : positions = blend des feuilles
                            // (chaque feuille = son propre post-process /
                            // macros / manual / depths / origin).
                            transition::eval_positions_tree(&layer_snap, live, &merged, common)
                        }
                        _ => {
                            let pp_fn = timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "post_process_fn.read",
                                post_process_fn_arc
                                    .read()
                                    .unwrap_or_else(|e| e.into_inner())
                            );
                            // `merged` est consommé ici — les bras
                            // transition/preview qui le relisent sont
                            // mutuellement exclusifs avec le bras Live.
                            pp_fn(&ctx, std::mem::take(&mut merged))
                        }
                    };

                // Sanitize : une position NaN/inf ne doit jamais partir en OSC
                // (f64::clamp ne panique pas ici — on droppe l'objet). Le
                // compteur dropped_positions rend la perte observable.
                let mut transformed: Vec<(usize, nalgebra::Vector3<f64>)> = transformed_raw
                    .into_iter()
                    .filter(|(_, pos)| {
                        if pos.iter().all(|v| v.is_finite()) {
                            true
                        } else {
                            dropped_positions.fetch_add(1, Ordering::SeqCst);
                            false
                        }
                    })
                    .collect();

                // (last_out est écrit dans le gate osc_armed — il doit
                // refléter les envois réellement tentés, pas le computed.)

                // 4.5 Cinématique : vitesse/accélération/jerk sur les positions
                // finales (celles réellement envoyées au renderer), dt réel
                // entre frames pour une mesure correcte même en cas de jitter.
                let kin_dt = prev_t.map(|p| (t_real - p).max(1e-6)).unwrap_or(dt);
                prev_t = Some(t_real);
                let kin_smoothing = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "kin_smoothing.read",
                    kinematic_smoothing_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                );
                let has_modulations = !timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "channel_modulations.read",
                    channel_modulations_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .is_empty()
                    || !timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_modulations.read",
                        graph_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
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
                // Vu-mètre perceptuel — vitesses par frame sur `transformed`
                // (espace canonique — ce que l'opérateur perçoit, pas le
                // payload venue-mappé).
                frame_helpers::update_perceptual(
                    &transformed,
                    &mut prev_transformed,
                    &mut prev_perceptual_instant,
                    &perceptual_arc,
                );
                // Position tape record — snapshot décimé (~30Hz) des
                // positions émises (t depuis le début de la bande).
                frame_helpers::maybe_record_tape(
                    &tape_rec_arc,
                    &mut tape_frame_ctr,
                    &mut tape_t0,
                    &last_canonical_arc,
                    &pos_tape_arc,
                );
                // Règles = graph-déclarées puis manuelles — les manuelles
                // écrasent le graph sur les canaux qu'elles ciblent.
                let modulated_channels: HashMap<usize, SpatialChannels> = {
                    let graph_rules = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_modulations.read",
                        graph_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let manual_rules = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "channel_modulations.read",
                        channel_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let mut rules: Vec<ChannelModulation> = (*graph_rules).clone();
                    rules.extend(manual_rules.iter().cloned());
                    apply_modulations(&rules, &kinematic_states)
                };

                // 4.6 Zones : graph-déclarées puis manuelles (dernier mot au
                // manuel). Snapshot Arc sous read lock court.
                let zones: Vec<crate::zones::Zone> = {
                    let graph = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_zones.read",
                        graph_zones_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let manual = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "zones.read",
                        zones_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let mut z = (*graph).clone();
                    z.extend(manual.iter().cloned());
                    z
                };

                // 4.6b Effets positionnels des zones (repel/attract/dampen/
                // vortex) — déplacement blendé par l'influence SDF sur la
                // position mergée. Objets sous override opérateur exclus :
                // positions manuelles + hold gardent priorité — un effet ne
                // doit JAMAIS déplacer ce que l'opérateur tient (même
                // sémantique que le panic, qui épargne les overrides).
                // Court-circuit : aucune zone à effet → coût nul.
                if zones.iter().any(|z| z.effect.is_some()) {
                    let held = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "held_objects.read",
                        held_objects_arc.read().unwrap_or_else(|e| e.into_inner())
                    );
                    let manual = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "manual_positions.read",
                        manual_positions_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    );
                    for (obj_idx, pos) in transformed.iter_mut() {
                        if held.contains(obj_idx) || manual.contains_key(obj_idx) {
                            continue;
                        }
                        let d = crate::zones::zone_displacement(&zones, *obj_idx, pos);
                        if d.norm() > 0.0 {
                            *pos += d;
                            // Post-transform NaN/inf : le clamp MAX_ZONE_
                            // DISPLACEMENT borne la norme mais un strength
                            // infini glissé dans les données casserait —
                            // on garde la position canonique dans ce cas.
                            if !pos.iter().all(|v| v.is_finite()) {
                                *pos -= d;
                            }
                        }
                    }
                }

                // Transition : canaux effectifs = blend des feuilles —
                // chaque feuille évalue statiques ⊕ modulations ⊕ zones sur
                // SES positions ; les deux côtés partagent `kinematic_states`
                // (déjà à jour sur les positions blendées).
                let eff_channels_override: Option<HashMap<usize, SpatialChannels>> =
                    match (&live_layer, &live_common) {
                        (Some(live), Some(common)) => Some(transition::eval_channels_tree(
                            &layer_snap,
                            live,
                            &merged,
                            common,
                            &kinematic_states,
                        )),
                        _ => None,
                    };

                // 5. Output — le sink est locké pour la frame entière : les
                // sends par objet sont non-bloquants (~µs), et un set_sink
                // mid-show ne peut pas swaper en plein milieu d'une frame.
                // ECONNREFUSED = ICMP port-unreachable → personne n'écoute :
                // compté dans `refused` (renderer down), pas du packet loss.
                // Erreurs comptées, jamais loguées par paquet (flood de warn!
                // quand le renderer est down).
                let object_channels = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "object_channels.read",
                    object_channels_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                // Master arm : disarmé = silence total, le merge continue
                // (preview alive) mais aucun paquet ne part — ni les sends
                // normaux ni la sonde du circuit-breaker.
                if osc_armed_arc.load(Ordering::SeqCst) {
                    let mut sink_guard = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "sink.lock",
                        sink_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    if osc_circuit_open {
                        // Circuit ouvert : une sonde par seconde — un vrai
                        // send_state du premier objet (donnée utile si le
                        // renderer est revenu entre-temps).
                        if last_probe.elapsed() >= Duration::from_secs(1) {
                            last_probe = Instant::now();
                            if let Some(&(obj_idx, pos)) =
                                transformed.iter().find(|(i, _)| osc_ids.get(*i).is_some())
                            {
                                // En circuit ouvert, seule la sonde part —
                                // last_out ne doit pas prétendre que tout
                                // `transformed` a été tenté (revue F3).
                                last_out_positions_arc
                                    .write()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .insert(obj_idx, [pos.x, pos.y, pos.z]);
                                let report = sink_guard.send_state(
                                    osc_ids[obj_idx],
                                    venue_map_arc
                                        .read()
                                        .unwrap_or_else(|e| e.into_inner())
                                        .map(|(s, o, yaw)| {
                                            let (c, sn) = (yaw.cos(), yaw.sin());
                                            let (x, y) =
                                                (pos.x * c - pos.y * sn, pos.x * sn + pos.y * c);
                                            [x * s[0] + o[0], y * s[1] + o[1], pos.z * s[2] + o[2]]
                                        })
                                        .unwrap_or([pos.x, pos.y, pos.z])
                                        .into(),
                                    None,
                                );
                                if report.sent > 0 && report.refused == 0 && report.errors == 0 {
                                    osc_circuit_open = false;
                                    osc_bad_windows = 0;
                                    crate::logging::log_osc_error(
                                        "OSC circuit CLOSED — renderer reachable again",
                                    );
                                }
                            }
                        }
                    } else {
                        // Positions réellement tentées — la confidence view
                        // ne montre que ce qui part au renderer (dry-run et
                        // circuit ouvert = rien n'est émis, last_out se fige).
                        {
                            let mut last_out = last_out_positions_arc
                                .write()
                                .unwrap_or_else(|e| e.into_inner());
                            for (obj, pos) in &transformed {
                                last_out.insert(*obj, [pos.x, pos.y, pos.z]);
                            }
                        }
                        for (obj_idx, pos) in &transformed {
                            if let Some(&osc_id) = osc_ids.get(*obj_idx) {
                                // Canaux effectifs = statiques + modulés (modulation
                                // prioritaire sur les canaux qu'elle cible) + zones
                                // (blend par influence, prioritaires sur le reste)
                                let effective: Option<SpatialChannels> =
                                    if let Some(over) = &eff_channels_override {
                                        over.get(obj_idx).copied()
                                    } else {
                                        let has_zones =
                                            crate::zones::any_zone_applies(&zones, *obj_idx, pos);
                                        match (
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
                                                crate::zones::apply_zones(
                                                    &zones, *obj_idx, pos, &mut eff,
                                                );
                                                Some(eff)
                                            }
                                        }
                                    };
                                // Readback opérateur — les canaux FX calculés
                                // (statiques ⊕ modulés ⊕ zones) rendent l'effet
                                // visible sans écouter le rendu.
                                {
                                    let mut ec = last_effective_channels_arc
                                        .write()
                                        .unwrap_or_else(|e| e.into_inner());
                                    match &effective {
                                        Some(e) => {
                                            ec.insert(*obj_idx, *e);
                                        }
                                        None => {
                                            ec.remove(obj_idx);
                                        }
                                    }
                                }
                                let report = {
                                    // Auto-venue + réalité-distance : seul
                                    // le payload OSC est transformé —
                                    // zones/canaux évalués sur `pos`
                                    // canonique (correct).
                                    let reality = *distance_reality_arc
                                        .read()
                                        .unwrap_or_else(|e| e.into_inner());
                                    let r = pos.norm();
                                    let mut send_pos = venue_map_arc
                                        .read()
                                        .unwrap_or_else(|e| e.into_inner())
                                        .map(|(s, o, yaw)| {
                                            let (c, sn) = (yaw.cos(), yaw.sin());
                                            let (x, y) =
                                                (pos.x * c - pos.y * sn, pos.x * sn + pos.y * c);
                                            nalgebra::Vector3::new(
                                                x * s[0] + o[0],
                                                y * s[1] + o[1],
                                                pos.z * s[2] + o[2],
                                            )
                                        })
                                        .unwrap_or(*pos);
                                    let mut eff_out = effective;
                                    if let Some((ex, ga, al)) = reality {
                                        // Exagération géométrique — la
                                        // distance perçue compresse ~×0.7 :
                                        // pousser les objets lointains pour
                                        // retrouver l'échelle perçue.
                                        send_pos *= r.max(1.0).powf(ex);
                                        let eff = eff_out.get_or_insert_with(Default::default);
                                        // distance → DRR renderer (reverb)
                                        eff.distance = Some(r);
                                        // gain 1/(1+a·r) — atténuation
                                        eff.gain = Some(eff.gain.unwrap_or(1.0) / (1.0 + ga * r));
                                        // presence e^(-air·r) — air-EQ
                                        if let Some(p) = eff.presence {
                                            eff.presence = Some(p * (-al * r).exp());
                                        }
                                    }
                                    // Dynamique spatiale — le compresseur
                                    // spatial global (k<1 resserre le champ).
                                    let k =
                                        *spatial_comp_arc.read().unwrap_or_else(|e| e.into_inner());
                                    if (k - 1.0).abs() > 1e-6 {
                                        send_pos *= k;
                                    }
                                    sink_guard.send_state(osc_id, send_pos, eff_out.as_ref())
                                };
                                osc_since_perf += report.sent as u64;
                                osc_errors_perf += report.errors as u64;
                                osc_refused_perf += report.refused as u64;
                            }
                        }
                    }
                }

                // 6. Callback pour le 3D preview : display = positions mergées +
                // positions preview (affichées mais jamais envoyées en OSC).
                // Parité : les positions preview passent par le MÊME post-process
                // que le live — sinon le 3D ment sur ce que l'OSC enverrait si le
                // move passait live (scale/rotate/origin du graph global).
                // Le sender est cloné sous un lock très court — la sériali-
                // sation JSON de l'emit se fait sur le pump thread. Le post-
                // process du preview reste ici (il doit refléter le live).
                let cb = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "position_cb.lock",
                    position_callback.lock().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                if let Some(tx) = cb {
                    let preview_transformed: Vec<(usize, nalgebra::Vector3<f64>)> =
                        if preview_positions.is_empty() {
                            Vec::new()
                        } else {
                            let raw = match (&live_layer, &live_common) {
                                // Parité : le preview suit le même blend
                                // de layers que le live pendant une
                                // transition (sinon le 3D ment).
                                (Some(live), Some(common)) => transition::eval_positions_tree(
                                    &layer_snap,
                                    live,
                                    &preview_positions,
                                    common,
                                ),
                                _ => {
                                    let pp_fn = timed_lock!(
                                        lock_wait_ns,
                                        lock_sites,
                                        lock_profiling,
                                        "post_process_fn.read",
                                        post_process_fn_arc
                                            .read()
                                            .unwrap_or_else(|e| e.into_inner())
                                    );
                                    pp_fn(&ctx, preview_positions.clone())
                                }
                            };
                            raw.into_iter()
                                .filter(|(_, pos)| pos.iter().all(|v| v.is_finite()))
                                .collect()
                        };
                    let mut display = transformed.clone();
                    display.extend(preview_transformed);
                    // try_send borné : si le pump est encore occupé à
                    // sérialiser la frame précédente, on droppe — preview
                    // dégradé (≈20-30 Hz) plutôt que merge retardé.
                    let _ = tx.try_send((t_real, display));
                }

                // 7. Perf monitor — agrégation des erreurs OSC (1 log max par
                // fenêtre de 500 ms au lieu d'un warn! par paquet échoué).
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
                    let (error_rate, refused_rate) = if total_osc > 0 {
                        (
                            osc_errors_perf as f64 / total_osc as f64,
                            osc_refused_perf as f64 / total_osc as f64,
                        )
                    } else {
                        (0.0, 0.0)
                    };
                    if osc_errors_perf > 0 {
                        crate::logging::log_osc_error(&format!(
                            "MergeRuntime OSC: {} erreurs / {} paquets sur {:.0} ms ({} refused)",
                            osc_errors_perf,
                            total_osc,
                            perf_elapsed.as_millis(),
                            osc_refused_perf
                        ));
                    }
                    // Circuit-breaker : 2 fenêtres de 500 ms à >50 % refused
                    // = renderer mort → suspendre les sends (sonde à 1 Hz).
                    if !osc_circuit_open {
                        if total_osc > 0 && refused_rate > 0.5 {
                            osc_bad_windows += 1;
                            if osc_bad_windows >= 2 {
                                osc_circuit_open = true;
                                // Sonde quasi-immédiate à la prochaine frame.
                                last_probe = Instant::now() - Duration::from_secs(1);
                                crate::logging::log_osc_error(
                                    "OSC circuit OPEN — target unreachable, suspending sends (probe @1Hz)",
                                );
                            }
                        } else {
                            osc_bad_windows = 0;
                        }
                    }
                    perf.set_osc_suspended(osc_circuit_open);
                    perf.update_with_error_rate(
                        fps_actual,
                        osc_rate,
                        latency_ms,
                        cpu_pct,
                        error_rate,
                        refused_rate,
                    );
                    frames_since_perf = 0;
                    osc_since_perf = 0;
                    osc_errors_perf = 0;
                    osc_refused_perf = 0;
                    last_perf_update = Instant::now();
                }

                // Durée de travail réel de la frame (merge + sends + perf) —
                // exclut le sleep de pacing : c'est le vrai coût hot-path,
                // exposé dans PerfStats.merge_frame_us.
                perf.set_merge_frame_us(merge_work_start.elapsed().as_secs_f64() * 1e6);
                // Attente totale en acquisition de locks sur la frame entière
                // (les premiers locks — move_buffers/active_moves — précèdent
                // merge_work_start ; le total est donc un tout petit peu plus
                // large que merge_frame_us, c'est voulu : on mesure la
                // contention de TOUTE la frame).
                perf.set_merge_lock_us(lock_wait_ns as f64 / 1000.0);

                // Dump du profiling par site (STAGESPACE_LOCK_PROF=1) : toutes
                // les 5 s, top des sites par attente cumulée ramenée à la
                // frame — attribution fine de la contention sans coût quand
                // le flag est absent (lock_sites reste vide).
                frame_helpers::maybe_dump_lock_prof(
                    lock_profiling,
                    &mut lock_profile_frames,
                    &mut lock_profile_total_ns,
                    &mut last_lock_dump,
                    &mut lock_sites,
                    lock_wait_ns,
                );

                // Timing précis + re-ancrage : après un stall (pause debug,
                // emit bloquant, préemption), on ne burst pas des centaines de
                // frames obsolètes — on ré-ancre frame_count sur le temps réel.
                frame_helpers::pace_frame(&mut start, &mut frame_count, frame_duration);
            };

            while running.load(Ordering::SeqCst) {
                merge_frames.fetch_add(1, Ordering::SeqCst);
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut frame)).is_err() {
                    // Panic contenu : le merge thread va mourir — on le rend
                    // observable (thread_died + running=false + frame_count
                    // figé) et on tente une frame de parking sur les derniers
                    // états connus avant de sortir.
                    thread_died.store(true, Ordering::SeqCst);
                    // Marquer stopped AVANT le parking : si le parking ou le
                    // callback panique à son tour, is_running() ne doit pas
                    // rester true sur un thread mort (spawn_move pourrait
                    // alors ne jamais redémarrer le merge).
                    running.store(false, Ordering::SeqCst);
                    crate::logging::log_osc_error(
                        "MergeRuntime: PANIC in merge thread — arrêt du merge",
                    );
                    // Parking : envoyer l'origin à toutes les tracks (même
                    // comportement que le panic côté app) avant de mourir.
                    // Mêmes contrats que la boucle d'envoi : dry-run = rien
                    // ne part, et venue_map s'applique (salle adaptée).
                    frame_helpers::park_all_objects(
                        &osc_armed_arc,
                        &sink_arc,
                        &osc_ids_arc,
                        &origin_arc,
                        &venue_map_arc,
                        &position_callback,
                    );
                    break;
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
            // join() depuis le thread lui-même paniquerait — garde défensive
            // (un drop depuis le merge thread ne devrait pas arriver, mais un
            // panic dans Drop est non-catchable proprement).
            if handle.thread().id() != std::thread::current().id() {
                let _ = handle.join();
            }
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
        self.sample_post_processor()(samples, object_index)
    }

    pub fn sample_post_processor(
        &self,
    ) -> impl Fn(TrajectorySamples, usize) -> TrajectorySamples + Send + 'static {
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
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        move |samples, object_index| {
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
}
