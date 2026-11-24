//! Thread horloge du séquenceur — `spawn_score_thread` orchestre la
//! lecture : file d'événements (`build_events`), tir des clips
//! (`fire_clip`) via les mêmes primitives que les modes opérateur,
//! évaluation des courbes au tick, miroir `tl.active` publié pour le
//! hot-swap et les kills (`kill_score_moves`), hard-wrap du loop.
use super::curves::{eval_curves, resolve_param_targets, AbsCurves, CurveTarget};
use super::types::{
    timeline_has_content, timeline_state, ActiveMove, ScoreClip, ScoreClipPayload, ScoreKeyframe,
    ScoreTimeline, SCORE_MOVE_PREFIX,
};
use crate::commands::cue_commands::recall_cue_inner;
use crate::commands::error::IpcError;
use crate::commands::merge_commands::macros::apply_set_macro_request;
use crate::commands::merge_commands::move_management::{
    deactivate_all_arc, deactivate_move_arc, spawn_move, spec_from_request,
};
use crate::commands::state::{emit_ui, lock_or_recover, Shared};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Publie le miroir `tl.active` depuis l'état local du scheduler —
/// gardé par génération : un thread mourant ne pollue pas le suivant.
/// Le miroir sert au hot-swap (survie des clips inchangés) et aux
/// kills ciblés (`stop`/`seek`).
pub(crate) fn publish_active(
    tl_arc: &Arc<Mutex<ScoreTimeline>>,
    gen: u64,
    lane_active: &HashMap<String, Vec<(String, f64, String)>>,
    curve_targets: &HashMap<String, CurveTarget>,
) {
    let mut tl = lock_or_recover(tl_arc);
    if tl.generation != gen {
        return;
    }
    let mut active: HashMap<String, ActiveMove> = HashMap::new();
    for (lane, moves) in lane_active {
        for (id, fade, clip_id) in moves {
            let e = active.entry(id.clone()).or_insert_with(|| ActiveMove {
                clip_id: clip_id.clone(),
                lanes: Vec::new(),
                fade: *fade,
                curve: curve_targets.get(id).cloned(),
            });
            e.lanes.push(lane.clone());
        }
    }
    tl.active = active;
}

/// Move id attendu pour l'itération `k` d'un clip Slot — miroir de la
/// construction dans `fire_clip` (`sc-<clip>` posé à la résolution,
/// suffixe `-k` en repeat). Sert au skip des moves hérités (hot-swap).
pub(crate) fn expected_move_id(clip: &ScoreClip, k: u64) -> Option<String> {
    match &clip.payload {
        ScoreClipPayload::Slot { request, .. } => Some(if clip.repeat_every_ms.is_some() {
            format!("{}-{k}", request.movement_id)
        } else {
            request.movement_id.clone()
        }),
        _ => None,
    }
}

/// Tue tous les moves score — `tl.active` + balayage des `sc-*` non
/// trackés (résidus, moves spawnés par cue etc.). `immediate` = fade 0
/// (seek/hot-swap : cut déterministe, l'id est libre pour le respawn
/// immédiat) ; sinon les fades déclarées jouent (stop = "appliquer la
/// fin déclarée" — même sémantique que le stop des autres modes).
/// `honor_end_mode` reste toujours honoré : un move `hold` écrit sa
/// position tenue même sur un cut.
pub(crate) fn kill_score_moves(sh: &Shared, tl: &mut ScoreTimeline, immediate: bool) {
    let mut kills: Vec<(String, f64)> = tl
        .active
        .iter()
        .map(|(id, am)| (id.clone(), if immediate { 0.0 } else { am.fade }))
        .collect();
    for id in lock_or_recover(&sh.movements)
        .keys()
        .filter(|id| id.starts_with(SCORE_MOVE_PREFIX))
        .cloned()
        .collect::<Vec<_>>()
    {
        if !tl.active.contains_key(&id) {
            kills.push((id, 0.0));
        }
    }
    for (id, fade) in kills {
        let _ = deactivate_move_arc(&id, fade, true, sh);
    }
    tl.active.clear();
    emit_ui(&sh.event_sink, "active-moves-update", ());
}

/// (Re)spawn du thread scheduler — partagé par play/update/seek :
/// bump la génération (tue l'ancien thread ≤50 ms), pose `started_at`,
/// seed l'état actif hérité (`tl.active` ∩ `movements` — les moves des
/// clips inchangés survivent au hot-swap) et lance l'horloge à
/// `seek_ms`. `loop_region` est relu en continu dans le thread → les
/// changements de boucle s'appliquent sans respawn.
pub(crate) fn spawn_score_thread(
    sh: &Shared,
    tl_arc: &Arc<Mutex<ScoreTimeline>>,
) -> Result<(), IpcError> {
    let (
        gen,
        seek,
        clips,
        global_fx_curves,
        modulation_curves,
        object_curves,
        spatial_fx_curves,
        lane_active,
        curve_targets,
    ) = {
        let mut tl = lock_or_recover(tl_arc);
        if !timeline_has_content(&tl) {
            tl.started_at = None;
            return Err(IpcError::validation("score timeline empty"));
        }
        tl.generation += 1;
        tl.started_at = Some(Instant::now());
        // Seeding hot-swap : un move hérité ne repart que s'il est
        // encore enregistré dans `movements` (mort entre-temps → skip).
        let movements = lock_or_recover(&sh.movements);
        let mut lane_active: HashMap<String, Vec<(String, f64, String)>> = HashMap::new();
        let mut curve_targets: HashMap<String, CurveTarget> = HashMap::new();
        for (id, am) in &tl.active {
            if !movements.contains_key(id) {
                continue;
            }
            for lane in &am.lanes {
                lane_active.entry(lane.clone()).or_default().push((
                    id.clone(),
                    am.fade,
                    am.clip_id.clone(),
                ));
            }
            if let Some(c) = &am.curve {
                curve_targets.insert(id.clone(), c.clone());
            }
        }
        (
            tl.generation,
            tl.seek_ms,
            tl.clips.clone(),
            tl.global_fx_curves.clone(),
            tl.modulation_curves.clone(),
            tl.object_curves.clone(),
            tl.spatial_fx_curves.clone(),
            lane_active,
            curve_targets,
        )
    };

    let sink = sh.event_sink.clone();
    let sh = sh.clone();
    let tl_arc = tl_arc.clone();
    std::thread::spawn(move || {
        // Filet de sécurité : un panic dans le scheduler laisserait
        // `started_at` posé (transport zombie) et des moves score
        // orphelins. `catch_unwind` ferme l'état et remonte un nack.
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Lane → moves score actifs [(move_id, fade, clip_id)].
            // En mode `exclusive` la liste reste ≤1 (un nouveau clip
            // coupe le précédent — console) ; en `stacked` les moves se
            // composent dans le merge.
            let mut lane_active = lane_active;
            // Cibles de courbes : move score → (macros per-move du worker,
            // t0 absolu, table). Rempli au fire (clips Slot avec curves),
            // vidé au EndMove/cut/hard-wrap.
            let mut curve_targets = curve_targets;
            let master_macros = lock_or_recover(&sh.merge_runtime).macros();
            // Source `SignalOsc` — handle EXTERNE (RwLock) : les écritures
            // modulation suivent les rebinds du receiver OSC.
            let osc_source = lock_or_recover(&sh.merge_runtime).osc_values_source();
            // Cycles de lecture : sans loop un seul passage ; avec loop, le
            // transport reboucle à `loop_start` (hard-wrap — les moves
            // score du cycle sont coupés avant de repartir, sémantique
            // "redémarrer la phrase" déterministe). La région est relue
            // par événement → `score_timeline_set_loop` s'applique live.
            let mut cycle_start = seek;
            // Fin de contenu des courbes temps-absolu : dernier
            // keyframe, toutes lanes confondues. Après le dernier
            // événement le scheduler attend ce point en continuant
            // d'évaluer — une queue de courbe au-delà du dernier clip
            // reste vivante, et une partition courbes-seules joue.
            let kf_end = |m: &HashMap<String, Vec<ScoreKeyframe>>| {
                m.values()
                    .flat_map(|kfs| kfs.iter().map(|k| k.t))
                    .max()
                    .unwrap_or(0)
            };
            let curves_end = [
                kf_end(&global_fx_curves),
                kf_end(&modulation_curves),
                kf_end(&spatial_fx_curves),
                object_curves
                    .values()
                    .flat_map(|m| m.values())
                    .flat_map(|kfs| kfs.iter().map(|k| k.t))
                    .max()
                    .unwrap_or(0),
            ]
            .into_iter()
            .max()
            .unwrap_or(0);
            'outer: loop {
                let t0 = Instant::now();
                let cursor = |elapsed: Duration| cycle_start + elapsed.as_millis() as u64;
                for (t, ev) in build_events(&clips, cycle_start) {
                    // Borne de boucle relue : un set_loop pendant la
                    // lecture s'applique dès le prochain événement.
                    let lp = {
                        let tl = lock_or_recover(&tl_arc);
                        if tl.generation != gen {
                            return;
                        }
                        tl.loop_region
                    };
                    if lp.map(|(_, e)| t >= e).unwrap_or(false) {
                        break;
                    }
                    loop {
                        let elapsed = t0.elapsed();
                        if cursor(elapsed) >= t {
                            break;
                        }
                        if lock_or_recover(&tl_arc).generation != gen {
                            return;
                        }
                        std::thread::sleep(
                            Duration::from_millis(t - cursor(elapsed))
                                .min(Duration::from_millis(50)),
                        );
                        // Tick courbes — chaque réveil ≤50 ms écrit les
                        // valeurs échantillonnées au curseur courant.
                        eval_curves(
                            cursor(t0.elapsed()),
                            &curve_targets,
                            &sh.merge_runtime,
                            &master_macros,
                            &AbsCurves {
                                global_fx: &global_fx_curves,
                                modulation: &modulation_curves,
                                object: &object_curves,
                                spatial_fx: &spatial_fx_curves,
                            },
                            &osc_source,
                        );
                    }
                    if lock_or_recover(&tl_arc).generation != gen {
                        return;
                    }
                    match ev {
                        Ev::Fire(i, k, offset) => {
                            // Hot-swap : un move hérité (clip inchangé)
                            // n'est pas re-spawné — il continue sa vie.
                            let inherited = expected_move_id(&clips[i], k).is_some_and(|id| {
                                lane_active.values().flatten().any(|(x, _, _)| *x == id)
                            });
                            if !inherited {
                                fire_clip(
                                    &clips[i],
                                    k,
                                    offset,
                                    &sh,
                                    &mut lane_active,
                                    &mut curve_targets,
                                    &sink,
                                );
                            }
                        }
                        Ev::EndMove(id, fade) => {
                            for v in lane_active.values_mut() {
                                v.retain(|x| x.0 != id);
                            }
                            curve_targets.remove(&id);
                            if let Err(e) = deactivate_move_arc(&id, fade, true, &sh) {
                                emit_ui(
                                    &sink,
                                    "score-nack",
                                    serde_json::json!({ "clip_id": id, "reason": format!("fin de clip: {e}") }),
                                );
                            }
                        }
                    }
                    // Le miroir tl.active suit chaque mutation — c'est
                    // lui que le hot-swap et les kills consultent.
                    publish_active(&tl_arc, gen, &lane_active, &curve_targets);
                    // Les courbes du clip qui vient de tirer écrivent leurs
                    // valeurs de t0 immédiatement (sinon ≤50 ms de retard).
                    eval_curves(
                        cursor(t0.elapsed()),
                        &curve_targets,
                        &sh.merge_runtime,
                        &master_macros,
                        &AbsCurves {
                            global_fx: &global_fx_curves,
                            modulation: &modulation_curves,
                            object: &object_curves,
                            spatial_fx: &spatial_fx_curves,
                        },
                        &osc_source,
                    );
                }
                let lp = lock_or_recover(&tl_arc).loop_region;
                match lp {
                    Some((lstart, lend)) if lend > lstart => {
                        // Attendre la borne de boucle (les événements peuvent
                        // finir avant lend — trou de queue).
                        loop {
                            let elapsed = t0.elapsed();
                            if cursor(elapsed) >= lend {
                                break;
                            }
                            if lock_or_recover(&tl_arc).generation != gen {
                                return;
                            }
                            std::thread::sleep(
                                Duration::from_millis(lend - cursor(elapsed))
                                    .min(Duration::from_millis(50)),
                            );
                            eval_curves(
                                cursor(t0.elapsed()),
                                &curve_targets,
                                &sh.merge_runtime,
                                &master_macros,
                                &AbsCurves {
                                    global_fx: &global_fx_curves,
                                    modulation: &modulation_curves,
                                    object: &object_curves,
                                    spatial_fx: &spatial_fx_curves,
                                },
                                &osc_source,
                            );
                        }
                        if lock_or_recover(&tl_arc).generation != gen {
                            return;
                        }
                        // Hard-cut : couper tous les moves score du cycle
                        // avant le rebouclage — chaque cycle repart propre.
                        // Un move multi-lanes apparaît dans la liste de
                        // chaque lane couverte → dédup avant le cut.
                        let drained: Vec<(String, f64)> = {
                            let mut seen = HashSet::new();
                            lane_active
                                .drain()
                                .flat_map(|(_, v)| v)
                                .filter(|(id, _, _)| seen.insert(id.clone()))
                                .map(|(id, fade, _)| (id, fade))
                                .collect()
                        };
                        for (id, fade) in drained {
                            curve_targets.remove(&id);
                            let _ = deactivate_move_arc(&id, fade, true, &sh);
                        }
                        publish_active(&tl_arc, gen, &lane_active, &curve_targets);
                        emit_ui(&sink, "active-moves-update", ());
                        // Rebase du curseur partagé — l'état rapporté reflète
                        // le retour visuel à loop_start.
                        {
                            let mut tl = lock_or_recover(&tl_arc);
                            if tl.generation != gen {
                                return;
                            }
                            tl.seek_ms = lstart;
                            tl.started_at = Some(Instant::now());
                        }
                        let st = timeline_state(&lock_or_recover(&tl_arc));
                        emit_ui(&sink, "score-timeline", st);
                        cycle_start = lstart;
                    }
                    _ => {
                        // Queue de partition : les courbes écrivent
                        // jusqu'à leur dernier keyframe.
                        while cursor(t0.elapsed()) < curves_end {
                            if lock_or_recover(&tl_arc).generation != gen {
                                return;
                            }
                            std::thread::sleep(
                                Duration::from_millis(curves_end - cursor(t0.elapsed()))
                                    .min(Duration::from_millis(50)),
                            );
                            eval_curves(
                                cursor(t0.elapsed()),
                                &curve_targets,
                                &sh.merge_runtime,
                                &master_macros,
                                &AbsCurves {
                                    global_fx: &global_fx_curves,
                                    modulation: &modulation_curves,
                                    object: &object_curves,
                                    spatial_fx: &spatial_fx_curves,
                                },
                                &osc_source,
                            );
                        }
                        break 'outer;
                    }
                }
            }
            let mut tl = lock_or_recover(&tl_arc);
            if tl.generation == gen {
                tl.started_at = None;
            }
            let st = timeline_state(&tl);
            drop(tl);
            emit_ui(&sink, "score-timeline", st);
        }));
        if let Err(payload) = r {
            eprintln!("score scheduler panic: {payload:?}");
            let mut tl = lock_or_recover(&tl_arc);
            if tl.generation == gen {
                tl.started_at = None;
            }
            let st = timeline_state(&tl);
            drop(tl);
            emit_ui(&sink, "score-timeline", st);
            emit_ui(
                &sink,
                "score-nack",
                serde_json::json!({ "clip_id": "", "reason": "scheduler panic — lecture arrêtée" }),
            );
        }
    });
    Ok(())
}

pub(crate) enum Ev {
    /// clip index, itération (repeat), offset_ms (seek à cheval)
    Fire(usize, u64, u64),
    /// movement_id, fade_out
    EndMove(String, f64),
}

/// Compile les clips résolus en liste d'événements ordonnée à partir
/// de `seek`. Un clip `repeat_every_ms` s'expande en copies à
/// `start + k·every` bornées par sa fenêtre `duration_ms` — les
/// répétitions sont matérialisées au play (pas de scheduler
/// infini) : déterministe, borné (4096 itérations max), seek sûr.
pub(crate) fn build_events(clips: &[ScoreClip], seek: u64) -> Vec<(u64, Ev)> {
    let mut events: Vec<(u64, Ev)> = Vec::new();
    for (i, c) in clips.iter().enumerate() {
        // Expansion des répétitions — (fire_at, itération, fin du move
        // score pour cette itération). repeat_every requiert duration_ms
        // (la fenêtre borne les copies) — sans fenêtre, une seule fois
        // + avertissement (jamais de génération non bornée).
        let iterations: Vec<(u64, u64, Option<u64>)> = match (c.repeat_every_ms, c.duration_ms) {
            (Some(every), Some(window)) if every > 0 => {
                let mut v = Vec::new();
                for k in 0u64..4096 {
                    let fk = c.start_ms + k * every;
                    if fk >= c.start_ms + window {
                        break;
                    }
                    v.push((fk, k, Some((fk + every).min(c.start_ms + window))));
                }
                v
            }
            (Some(_), _) => {
                eprintln!(
                    "[score] clip '{}': repeat_every ignoré — duration_ms requis",
                    c.id
                );
                vec![(c.start_ms, 0, None)]
            }
            _ => vec![(c.start_ms, 0, c.duration_ms.map(|d| c.start_ms + d))],
        };
        for (fire_at, k, iter_end) in iterations {
            if fire_at >= seek {
                events.push((fire_at, Ev::Fire(i, k, 0)));
            } else if matches!(c.payload, ScoreClipPayload::Slot { .. })
                && iter_end.map(|e| e > seek).unwrap_or(true)
            {
                // Itération de slot à cheval sur le curseur → offset.
                events.push((seek, Ev::Fire(i, k, seek - fire_at)));
            }
            // Cue markers déjà passés : skippés (documenté — pas de catch-up).
            if let (Some(e), ScoreClipPayload::Slot { request, .. }) = (iter_end, &c.payload) {
                if e > seek {
                    // fade_out effectif : l'override clip-local prime
                    // sur le fade de l'animation du slot.
                    let fade = c
                        .fade_out_ms
                        .map(|m| m as f64 / 1000.0)
                        .or_else(|| request.animation.as_ref().map(|a| a.fade_out))
                        .unwrap_or(0.5);
                    let mv_id = if c.repeat_every_ms.is_some() {
                        format!("{}-{k}", request.movement_id)
                    } else {
                        request.movement_id.clone()
                    };
                    events.push((e, Ev::EndMove(mv_id, fade)));
                }
            }
        }
    }
    events.sort_by_key(|(t, _)| *t);
    events
}

/// Exécute un clip — mêmes chemins que les actions opérateur/OSC.
/// Lane réservée — les moves respawnés par les recalls de cue s'y
/// enregistrent pour le cleanup wrap/stop (barrière d'état, design
/// §Cues on the timeline). Même id côté frontend (`CONDUCTOR_LANE`).
pub(crate) const CONDUCTOR_LANE: &str = "conductor";

pub(crate) fn fire_clip(
    clip: &ScoreClip,
    iteration: u64,
    offset_ms: u64,
    sh: &Shared,
    lane_active: &mut HashMap<String, Vec<(String, f64, String)>>,
    curve_targets: &mut HashMap<String, CurveTarget>,
    sink: &Arc<Mutex<Option<crate::commands::state::EventSink>>>,
) {
    match &clip.payload {
        ScoreClipPayload::Slot { request, macros } => {
            // Mode exclusive PAR LANE : les moves score actifs sur
            // chaque lane exclusive occupée sont coupés d'abord —
            // dernier clip gagne (console). Sur les lanes stacked ils
            // continuent : leurs sorties se composent dans le merge.
            for lane in clip.lanes.iter().filter(|l| !l.stacked) {
                if let Some(prev) = lane_active.remove(&lane.id) {
                    for (prev_id, prev_fade, _) in prev {
                        curve_targets.remove(&prev_id);
                        let _ = deactivate_move_arc(&prev_id, prev_fade, true, sh);
                        // Un move multi-lanes coupé ici resterait
                        // enregistré actif sur ses autres lanes (état
                        // stale + futur deactivate en trop) — purge.
                        for v in lane_active.values_mut() {
                            v.retain(|x| x.0 != prev_id);
                        }
                    }
                }
            }
            let mut req = request.as_ref().clone();
            // Itérations d'un clip répété : id suffixé par itération —
            // chaque copie est un move distinct (les EndMove ciblent par id).
            if clip.repeat_every_ms.is_some() {
                req.movement_id = format!("{}-{iteration}", req.movement_id);
            }
            // Fades clip-local : override de l'animation du slot quand
            // présents (None = héritage). L'override du fade_out est
            // aussi celui stocké pour les cuts/EndMove ultérieurs.
            if let Some(a) = req.animation.as_mut() {
                if let Some(ms) = clip.fade_in_ms {
                    a.fade_in = ms as f64 / 1000.0;
                }
                if let Some(ms) = clip.fade_out_ms {
                    a.fade_out = ms as f64 / 1000.0;
                }
            }
            match spawn_move(spec_from_request(req.clone()), sh) {
                Ok(_) => {
                    if let Some(m) = macros {
                        apply_set_macro_request(m, &lock_or_recover(&sh.merge_runtime));
                    }
                    if offset_ms > 0 || !clip.curves.is_empty() {
                        if let Some(mv) = lock_or_recover(&sh.movements).get(&req.movement_id) {
                            if offset_ms > 0 {
                                mv.runtime.set_time_offset(offset_ms as f64 / 1000.0);
                            }
                            // Courbes clip-scoped → macros per-move du
                            // worker (scope PerMove). t0 = début ABSOLU
                            // de cette itération (start + k·repeat) —
                            // le spanning (offset>0) n'affecte que la
                            // phase interne du move, pas le temps de
                            // courbe qui suit le curseur timeline.
                            if !clip.curves.is_empty() {
                                // Cibles `param:` résolues sur le
                                // graph_json de la request (id node ou
                                // type-wide — mêmes règles que le
                                // signal compiler), base lue dans les
                                // params du node.
                                let param_targets = clip
                                    .curves
                                    .keys()
                                    .filter(|k| k.starts_with("param:"))
                                    .map(|k| (k.clone(), resolve_param_targets(&req.graph_json, k)))
                                    .collect();
                                curve_targets.insert(
                                    req.movement_id.clone(),
                                    CurveTarget {
                                        macros: mv.runtime.macros(),
                                        param_deltas: mv.runtime.param_deltas(),
                                        param_targets,
                                        t0_ms: clip.start_ms
                                            + iteration * clip.repeat_every_ms.unwrap_or(0),
                                        curves: clip.curves.clone(),
                                    },
                                );
                            }
                        }
                    }
                    let fade_out = req.animation.as_ref().map(|a| a.fade_out).unwrap_or(0.5);
                    // Le move s'enregistre dans TOUTES ses lanes : il
                    // est coupé si l'une d'elles (exclusive) reçoit un
                    // nouveau clip, et drainé au hard-wrap partout.
                    for lane in &clip.lanes {
                        lane_active.entry(lane.id.clone()).or_default().push((
                            req.movement_id.clone(),
                            fade_out,
                            clip.id.clone(),
                        ));
                    }
                    emit_ui(sink, "active-moves-update", ());
                }
                // Spawn impossible = événement visible en show —
                // nack opérateur comme le busy-skip des cues.
                Err(e) => emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": e.to_string() }),
                ),
            }
        }
        ScoreClipPayload::Cue(cue) => {
            // recall_cue_inner gère le flag concurrent (CAS + RAII) —
            // un recall opérateur en cours → Err(busy), le clip est skippé.
            match recall_cue_inner((**cue).clone(), sh.clone()) {
                Ok(()) => {
                    // Barrière d'état (design §Cues on the timeline) :
                    // un recall Full a tué les moves non listés — les
                    // moves score trackés sont morts, le score perd
                    // l'autorité jusqu'au prochain clip. Purge sinon les
                    // entrées stales pollueraient cuts/wraps futurs.
                    if cue.mode == stagespace_engines::CueMode::Full {
                        lane_active.clear();
                        curve_targets.clear();
                    }
                    // Les moves respawnés par le snapshot (ids statiques,
                    // connus dans cue.moves) s'enregistrent sur la lane
                    // conductor pour le cleanup wrap/stop — sans ça ils
                    // fuiraient entre les cycles de loop.
                    let respawned: Vec<(String, f64, String)> = cue
                        .moves
                        .iter()
                        .map(|m| (m.id.clone(), 0.0, clip.id.clone()))
                        .collect();
                    if !respawned.is_empty() {
                        lane_active
                            .entry(CONDUCTOR_LANE.to_string())
                            .or_default()
                            .extend(respawned);
                    }
                    emit_ui(sink, "active-moves-update", ());
                }
                // Busy-skip remonté à l'opérateur — une cue manquée dans
                // un show est un événement visible, pas un log backend.
                Err(e) => emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": e.to_string() }),
                ),
            }
        }
        ScoreClipPayload::StopAll => {
            let _ = deactivate_all_arc(0.0, true, sh);
            // Barrière aussi : tout ce que le score avait spawné est mort.
            lane_active.clear();
            curve_targets.clear();
        }
        ScoreClipPayload::Panic => {
            let _ = deactivate_all_arc(0.0, false, sh);
            lane_active.clear();
            curve_targets.clear();
        }
        ScoreClipPayload::Positions { positions } => {
            // Même chemin que /stagespace/position — takeover manuel
            // des objets listés (persiste jusqu'à override/clear).
            let rt = lock_or_recover(&sh.merge_runtime);
            for (obj, pos) in positions {
                rt.set_manual_position(*obj, *pos);
            }
        }
        ScoreClipPayload::SignalGraph { graph } => {
            // update_signal_graph scope global — graph vide = reset.
            let signal_fn = if graph.nodes.is_empty() {
                Some(stagespace_engines::signal_compiler::empty_signal_fn())
            } else {
                let audio_state = lock_or_recover(&sh.audio_state);
                crate::graph::parser::build_graph_from_json(graph, &audio_state)
                    .map_err(|e| format!("parse: {e}"))
                    .and_then(|g| {
                        stagespace_engines::compile_signal_graph(&g)
                            .map_err(|e| format!("compile: {e:?}"))
                    })
                    .map_err(|e| {
                        emit_ui(
                            sink,
                            "score-nack",
                            serde_json::json!({ "clip_id": clip.id, "reason": format!("signal graph: {e}") }),
                        );
                        e
                    })
                    .ok()
            };
            if let Some(f) = signal_fn {
                lock_or_recover(&sh.merge_runtime).swap_signal_fn(f);
            }
        }
        ScoreClipPayload::PostGraph { graph } => {
            // recall_cue étape 1 : parse → effets → compile → swap. Un
            // graphe invalide logue sans crasher (ni la lecture ni le
            // post-process courant ne sont interrompus).
            let rt = lock_or_recover(&sh.merge_runtime);
            let audio_state = lock_or_recover(&sh.audio_state);
            let compiled = crate::graph::parser::build_graph_from_json(graph, &audio_state)
                .map_err(|e| format!("parse: {e}"))
                .and_then(|g| {
                    let effects = stagespace_engines::extract_graph_effects(&g)
                        .map_err(|e| format!("effects: {e:?}"))?;
                    let f = stagespace_engines::compile_post_process(
                        stagespace_engines::PostProcessCompileParams {
                            graph: g,
                            macros: rt.macros(),
                        },
                    )
                    .map_err(|e| format!("compile: {e:?}"))?;
                    Ok((f, effects))
                });
            match compiled {
                Ok((f, effects)) => {
                    rt.swap_post_process_fn(f);
                    rt.set_graph_effects(effects.zones, effects.modulations, effects.move_ref);
                    if let Some(strategy) = effects.strategy {
                        rt.set_merge_strategy(strategy);
                    }
                }
                Err(e) => emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": format!("global graph: {e}") }),
                ),
            }
        }
        ScoreClipPayload::ChanMods { modulations } => {
            // recall_cue : clear + install de la table MANUELLE —
            // les règles Velocity du graphe (graph_modulations) ne
            // sont pas touchées (disjoint).
            let rt = lock_or_recover(&sh.merge_runtime);
            rt.clear_modulations();
            let mut rejected = 0usize;
            for r in modulations {
                if rt.add_modulation(r.clone()).is_err() {
                    rejected += 1;
                }
            }
            if rejected > 0 {
                emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": format!("{rejected} modulation(s) rejetée(s)") }),
                );
            }
        }
        ScoreClipPayload::Zones { zones } => {
            // recall_cue : clear + install des zones MANUELLES — les
            // zones du graphe (graph_zones) ne sont pas touchées.
            let rt = lock_or_recover(&sh.merge_runtime);
            rt.clear_zones();
            let mut rejected = 0usize;
            for z in zones {
                if rt.add_zone(z.clone()).is_err() {
                    rejected += 1;
                }
            }
            if rejected > 0 {
                emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": format!("{rejected} zone(s) rejetée(s)") }),
                );
            }
        }
        ScoreClipPayload::Gesture { name, strength } => {
            // /stagespace/gesture — impulsion sur les objets émis.
            lock_or_recover(&sh.merge_runtime).gesture(name, *strength);
        }
        ScoreClipPayload::Park { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                emit_ui(
                    sink,
                    "score-nack",
                    serde_json::json!({ "clip_id": clip.id, "reason": "park sans cible" }),
                );
            }
            for &o in objects {
                rt.park_object(o);
            }
        }
        ScoreClipPayload::Unpark { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                rt.clear_parked();
            } else {
                for &o in objects {
                    rt.unpark_object(o);
                }
            }
        }
        ScoreClipPayload::Throw { objects, vel } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            for &o in objects {
                rt.throw_object(o, *vel);
            }
        }
        ScoreClipPayload::ManualClear { objects } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            if objects.is_empty() {
                rt.clear_all_manual_positions();
            } else {
                for &o in objects {
                    rt.clear_manual_position(o);
                }
            }
        }
        ScoreClipPayload::Attention { obj } => {
            let rt = lock_or_recover(&sh.merge_runtime);
            match obj {
                Some(o) => rt.attention_focus(*o),
                None => rt.attention_release(),
            }
        }
        ScoreClipPayload::OscOut { target, addr, args } => {
            fire_osc_out(sh, target, addr, args);
        }
    }
}

/// Émet le message OSC d'un clip `OscOut` — fire-and-forget comme le
/// reste du scheduler. `target` explicite = "host:port" ; sinon la
/// cible OSC out du show (le renderer). Garde `osc_armed` (dry-run =
/// rien ne part) et refuse le loopback `/stagespace/*` vers notre
/// propre port d'entrée (un clip qui re-déclencherait le show-control
/// bouclerait — footgun, pas feature).
fn fire_osc_out(sh: &Shared, target: &Option<String>, addr: &str, args: &[super::types::OscArg]) {
    {
        let rt = lock_or_recover(&sh.merge_runtime);
        if !rt.osc_armed() {
            return;
        }
    }
    let dest = match target.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(t) => t.to_string(),
        None => {
            let (h, p) = lock_or_recover(&sh.osc_out_target).clone();
            format!("{h}:{p}")
        }
    };
    // Garde loopback : /stagespace/* vers notre propre port d'entrée.
    if addr.starts_with("/stagespace/") {
        let in_port = lock_or_recover(&sh.osc_receiver).port;
        let port_str = in_port.to_string();
        let local = matches!(
            dest.split(':').next(),
            Some("127.0.0.1") | Some("localhost") | Some("0.0.0.0") | Some("::1")
        ) && dest.rsplit(':').next() == Some(port_str.as_str());
        if local {
            eprintln!("[SCORE] OscOut {addr} → {dest} ignoré (loopback show-control)");
            return;
        }
    }
    let msg = rosc::OscMessage {
        addr: addr.to_string(),
        args: args
            .iter()
            .map(|a| match a {
                super::types::OscArg::Int(v) => rosc::OscType::Long(*v),
                super::types::OscArg::Float(v) => rosc::OscType::Double(*v),
                super::types::OscArg::Str(v) => rosc::OscType::String(v.clone()),
                super::types::OscArg::Bool(v) => rosc::OscType::Bool(*v),
            })
            .collect(),
    };
    match rosc::encoder::encode(&rosc::OscPacket::Message(msg)) {
        Ok(bytes) => match std::net::UdpSocket::bind("0.0.0.0:0") {
            Ok(sock) => {
                if let Err(e) = sock.send_to(&bytes, &dest) {
                    eprintln!("[SCORE] OscOut {addr} → {dest}: {e}");
                }
            }
            Err(e) => eprintln!("[SCORE] OscOut {addr} → {dest}: socket {e}"),
        },
        Err(e) => eprintln!("[SCORE] OscOut {addr}: encode {e:?}"),
    }
}
