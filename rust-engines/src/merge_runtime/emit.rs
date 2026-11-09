//! Section 5 — émission OSC par frame : sonde circuit-breaker / envoi
//! des positions mergées + canaux effectifs au sink. Extraite de
//! loop_core.rs (Phase 6 sanitation, règle modularisation) — corps
//! verbatim, mêmes locks même ordre.

use super::frame_helpers::OscFlow;
use super::*;

/// Émet la frame vers le renderer : le sink est locké pour la frame
/// entière (les sends par objet sont non-bloquants ~µs, et un set_sink
/// mid-show ne peut pas swaper en plein milieu d'une frame).
/// ECONNREFUSED = ICMP port-unreachable → personne n'écoute : compté
/// dans `refused` (renderer down), pas du packet loss. Erreurs comptées,
/// jamais loguées par paquet (flood de warn! quand le renderer est down).
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_osc_frame(
    object_channels_arc: &Arc<RwLock<HashMap<usize, SpatialChannels>>>,
    osc_armed: &Arc<AtomicBool>,
    sink: &SharedSink,
    flow: &mut OscFlow,
    transformed: &[(usize, nalgebra::Vector3<f64>)],
    osc_ids: &Arc<Vec<u32>>,
    last_out_positions: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    eff_channels_override: &Option<HashMap<usize, SpatialChannels>>,
    modulated_channels: &HashMap<usize, SpatialChannels>,
    zones: &[crate::zones::Zone],
    last_effective_channels: &Arc<RwLock<HashMap<usize, SpatialChannels>>>,
    venue_map: &Arc<RwLock<Option<VenueMap>>>,
    distance_reality: &Arc<RwLock<DistanceReality>>,
    spatial_comp: &Arc<RwLock<f64>>,
    lock_wait_ns: &mut u64,
    lock_sites: &mut HashMap<&'static str, u64>,
    lock_profiling: bool,
) {
    let mut wait_ns = 0u64;
    let object_channels = timed_lock!(
        wait_ns,
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
    if osc_armed.load(Ordering::SeqCst) {
        let mut sink_guard = timed_lock!(
            wait_ns,
            lock_sites,
            lock_profiling,
            "sink.lock",
            sink.lock().unwrap_or_else(|e| e.into_inner())
        );
        if flow.circuit_open {
            // Circuit ouvert : une sonde par seconde — un vrai
            // send_state du premier objet (donnée utile si le
            // renderer est revenu entre-temps).
            if flow.last_probe.elapsed() >= Duration::from_secs(1) {
                flow.last_probe = Instant::now();
                if let Some(&(obj_idx, pos)) =
                    transformed.iter().find(|(i, _)| osc_ids.get(*i).is_some())
                {
                    // En circuit ouvert, seule la sonde part —
                    // last_out ne doit pas prétendre que tout
                    // `transformed` a été tenté (revue F3).
                    last_out_positions
                        .write()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(obj_idx, [pos.x, pos.y, pos.z]);
                    let report = sink_guard.send_state(
                        osc_ids[obj_idx],
                        venue_map
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                            .map(|(s, o, yaw)| {
                                let (c, sn) = (yaw.cos(), yaw.sin());
                                let (x, y) = (pos.x * c - pos.y * sn, pos.x * sn + pos.y * c);
                                [x * s[0] + o[0], y * s[1] + o[1], pos.z * s[2] + o[2]]
                            })
                            .unwrap_or([pos.x, pos.y, pos.z])
                            .into(),
                        None,
                    );
                    if report.sent > 0 && report.refused == 0 && report.errors == 0 {
                        flow.circuit_open = false;
                        flow.bad_windows = 0;
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
                let mut last_out = last_out_positions
                    .write()
                    .unwrap_or_else(|e| e.into_inner());
                for (obj, pos) in transformed {
                    last_out.insert(*obj, [pos.x, pos.y, pos.z]);
                }
            }
            for (obj_idx, pos) in transformed {
                if let Some(&osc_id) = osc_ids.get(*obj_idx) {
                    // Canaux effectifs = statiques + modulés (modulation
                    // prioritaire sur les canaux qu'elle cible) + zones
                    // (blend par influence, prioritaires sur le reste)
                    let effective: Option<SpatialChannels> =
                        if let Some(over) = &eff_channels_override {
                            over.get(obj_idx).copied()
                        } else {
                            let has_zones = crate::zones::any_zone_applies(zones, *obj_idx, pos);
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
                                    crate::zones::apply_zones(zones, *obj_idx, pos, &mut eff);
                                    Some(eff)
                                }
                            }
                        };
                    // Readback opérateur — les canaux FX calculés
                    // (statiques ⊕ modulés ⊕ zones) rendent l'effet
                    // visible sans écouter le rendu.
                    {
                        let mut ec = last_effective_channels
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
                        let reality = *distance_reality.read().unwrap_or_else(|e| e.into_inner());
                        let r = pos.norm();
                        let mut send_pos = venue_map
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                            .map(|(s, o, yaw)| {
                                let (c, sn) = (yaw.cos(), yaw.sin());
                                let (x, y) = (pos.x * c - pos.y * sn, pos.x * sn + pos.y * c);
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
                        let k = *spatial_comp.read().unwrap_or_else(|e| e.into_inner());
                        if (k - 1.0).abs() > 1e-6 {
                            send_pos *= k;
                        }
                        sink_guard.send_state(osc_id, send_pos, eff_out.as_ref())
                    };
                    flow.sent += report.sent as u64;
                    flow.errors += report.errors as u64;
                    flow.refused += report.refused as u64;
                }
            }
        }
    }
    *lock_wait_ns += wait_ns;
}
