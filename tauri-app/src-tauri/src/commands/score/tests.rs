//! Tests unitaires du séquenceur — sampling de courbes, events,
//! eval_curves multi-scopes.
use super::curves::{eval_curves, sample_curve, write_macro_param, AbsCurves, CurveTarget};
use super::scheduler::{build_events, Ev};
use super::types::*;
use crate::commands::merge_commands::move_management::ActivateMoveRequest;
use crate::commands::state::lock_or_recover;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn slot_clip(
    id: &str,
    start_ms: u64,
    duration_ms: Option<u64>,
    repeat_every_ms: Option<u64>,
) -> ScoreClip {
    ScoreClip {
        id: id.to_string(),
        lanes: vec![ScoreLane {
            id: "obj-1".to_string(),
            stacked: false,
        }],
        start_ms,
        duration_ms,
        repeat_every_ms,
        fade_in_ms: None,
        fade_out_ms: None,
        curves: HashMap::new(),
        payload: ScoreClipPayload::Slot {
            request: Box::new(ActivateMoveRequest {
                movement_id: format!("sc-{id}"),
                name: "test".to_string(),
                graph_json: stagespace_engines::GraphJson::default(),
                osc_ids: vec![1],
                track_indices: vec![0],
                is_preview: false,
                origin: None,
                duration: 10.0,
                loop_mode: "loop".to_string(),
                direction: "forward".to_string(),
                animation: None,
                end_mode: stagespace_engines::EndMode::default(),
                anchor_mode: stagespace_engines::AnchorMode::default(),
                anchor_target: None,
                anchor_pose: None,
            }),
            macros: None,
        },
    }
}

fn events_map(evs: &[(u64, Ev)]) -> Vec<(u64, String)> {
    evs.iter()
        .map(|(t, ev)| {
            let desc = match ev {
                Ev::Fire(i, k, off) => format!("fire:{i}:k{k}:+{off}"),
                Ev::EndMove(id, _) => format!("end:{id}"),
            };
            (*t, desc)
        })
        .collect()
}

#[test]
fn repeat_expands_into_bounded_copies() {
    // Fenêtre 10s, période 2s → 5 copies à 0,2,4,6,8 — chacune
    // vit une période (EndMove au prochain pas / fin de fenêtre).
    let clips = vec![slot_clip("c1", 0, Some(10_000), Some(2_000))];
    let evs = events_map(&build_events(&clips, 0));
    assert_eq!(
        evs,
        vec![
            (0, "fire:0:k0:+0".to_string()),
            (2000, "end:sc-c1-0".to_string()),
            (2000, "fire:0:k1:+0".to_string()),
            (4000, "end:sc-c1-1".to_string()),
            (4000, "fire:0:k2:+0".to_string()),
            (6000, "end:sc-c1-2".to_string()),
            (6000, "fire:0:k3:+0".to_string()),
            (8000, "end:sc-c1-3".to_string()),
            (8000, "fire:0:k4:+0".to_string()),
            (10000, "end:sc-c1-4".to_string()),
        ]
    );
}

#[test]
fn repeat_seek_spans_iteration_with_offset() {
    // Seek à 5s : l'itération k2 (4→6s) est à cheval → fire offset
    // 1s à l'instant du seek ; les copies < seek sont mortes.
    let clips = vec![slot_clip("c1", 0, Some(10_000), Some(2_000))];
    let evs = events_map(&build_events(&clips, 5_000));
    assert_eq!(
        evs,
        vec![
            (5000, "fire:0:k2:+1000".to_string()),
            (6000, "end:sc-c1-2".to_string()),
            (6000, "fire:0:k3:+0".to_string()),
            (8000, "end:sc-c1-3".to_string()),
            (8000, "fire:0:k4:+0".to_string()),
            (10000, "end:sc-c1-4".to_string()),
        ]
    );
}

#[test]
fn repeat_without_window_fires_once() {
    // repeat_every sans duration_ms → pas de fenêtre borne → une
    // seule fois (jamais de génération non bornée).
    let clips = vec![slot_clip("c1", 0, None, Some(2_000))];
    let evs = events_map(&build_events(&clips, 0));
    assert_eq!(evs, vec![(0, "fire:0:k0:+0".to_string())]);
}

#[test]
fn non_repeat_clip_unchanged() {
    // Régression : un clip simple garde Fire + EndMove sur l'id de base.
    let clips = vec![slot_clip("c1", 1_000, Some(3_000), None)];
    let evs = events_map(&build_events(&clips, 0));
    assert_eq!(
        evs,
        vec![
            (1000, "fire:0:k0:+0".to_string()),
            (4000, "end:sc-c1".to_string()),
        ]
    );
}

#[test]
fn clip_fade_out_overrides_animation_fade() {
    // fade_out_ms du clip prime sur le fade de l'animation du
    // slot : l'EndMove emporte l'override (utilisé au cut).
    let mut clips = vec![slot_clip("c1", 0, Some(2_000), None)];
    if let ScoreClipPayload::Slot { request, .. } = &mut clips[0].payload {
        request.animation = Some(stagespace_engines::Animation {
            fade_out: 0.5,
            ..Default::default()
        });
    }
    clips[0].fade_out_ms = Some(3_000);
    let evs = build_events(&clips, 0);
    let fade = evs.iter().find_map(|(_, ev)| match ev {
        Ev::EndMove(_, f) => Some(*f),
        _ => None,
    });
    assert_eq!(fade, Some(3.0)); // 3 000 ms → 3 s, pas le 0.5 du slot
}

#[test]
fn clip_fade_inherited_when_unset() {
    // Sans override : l'EndMove retombe sur le fade de l'animation.
    let mut clips = vec![slot_clip("c1", 0, Some(2_000), None)];
    if let ScoreClipPayload::Slot { request, .. } = &mut clips[0].payload {
        request.animation = Some(stagespace_engines::Animation {
            fade_out: 1.25,
            ..Default::default()
        });
    }
    let evs = build_events(&clips, 0);
    let fade = evs.iter().find_map(|(_, ev)| match ev {
        Ev::EndMove(_, f) => Some(*f),
        _ => None,
    });
    assert_eq!(fade, Some(1.25));
}

#[test]
fn new_fields_default_on_old_wire_payloads() {
    // Compat arrière : un ScoreClip sérialisé avant fades/stacked
    // (les trois champs absents) se désérialise avec les défauts.
    let json = r#"{"id":"c1","start_ms":0,
        "payload":{"kind":"StopAll"}}"#;
    let c: ScoreClip = serde_json::from_str(json).unwrap();
    assert_eq!(c.fade_in_ms, None);
    assert_eq!(c.fade_out_ms, None);
    assert!(c.lanes.is_empty());
    assert!(c.curves.is_empty());
}

#[test]
fn curve_samples_linear_between_keyframes() {
    let kfs = vec![
        ScoreKeyframe {
            t: 0,
            v: 1.0,
            interp: ScoreInterp::Linear,
        },
        ScoreKeyframe {
            t: 4_000,
            v: 2.0,
            interp: ScoreInterp::Linear,
        },
        ScoreKeyframe {
            t: 8_000,
            v: 0.0,
            interp: ScoreInterp::Linear,
        },
    ];
    // Bords : clamp avant le premier / après le dernier point.
    assert_eq!(sample_curve(&kfs, 0), Some(1.0));
    assert_eq!(sample_curve(&kfs, 8_000), Some(0.0));
    assert_eq!(sample_curve(&kfs, 20_000), Some(0.0));
    // Milieu de rampe montante puis descendante.
    assert_eq!(sample_curve(&kfs, 2_000), Some(1.5));
    assert_eq!(sample_curve(&kfs, 6_000), Some(1.0));
    // Exactement sur un keyframe.
    assert_eq!(sample_curve(&kfs, 4_000), Some(2.0));
    // Cas limites.
    assert_eq!(sample_curve(&[], 100), None);
    assert_eq!(
        sample_curve(
            &[ScoreKeyframe {
                t: 500,
                v: 3.0,
                interp: ScoreInterp::Linear
            }],
            0
        ),
        Some(3.0)
    );
}

#[test]
fn curve_samples_step_and_smooth_interps() {
    // step : la valeur du keyframe tient jusqu'au suivant (front
    // montant au keyframe lui-même, pas avant).
    let step = vec![
        ScoreKeyframe {
            t: 0,
            v: 1.0,
            interp: ScoreInterp::Step,
        },
        ScoreKeyframe {
            t: 4_000,
            v: 3.0,
            interp: ScoreInterp::Step,
        },
    ];
    assert_eq!(sample_curve(&step, 1_999), Some(1.0));
    assert_eq!(sample_curve(&step, 4_000), Some(3.0));
    // smooth : smoothstep f²(3−2f) — milieu = moyenne, quart =
    // 0.156·Δ (ease in), pas de dépassement.
    let smooth = vec![
        ScoreKeyframe {
            t: 0,
            v: 0.0,
            interp: ScoreInterp::Smooth,
        },
        ScoreKeyframe {
            t: 4_000,
            v: 4.0,
            interp: ScoreInterp::Smooth,
        },
    ];
    assert_eq!(sample_curve(&smooth, 2_000), Some(2.0));
    let q = sample_curve(&smooth, 1_000).unwrap();
    assert!((q - 4.0 * (0.25 * 0.25 * (3.0 - 0.5))).abs() < 1e-9);
    // Linear reste le défaut serde — payload sans `interp` lit linear.
    let legacy: ScoreKeyframe = serde_json::from_str(r#"{"t":100,"v":2.5}"#).unwrap();
    assert_eq!(legacy.interp, ScoreInterp::Linear);
}

#[test]
fn write_macro_param_updates_axes_independently() {
    let m = stagespace_engines::MacroState::new();
    // Aliases offset_* == shift_* (convention overrides/signal).
    write_macro_param(&m, "shift_x", 2.0);
    write_macro_param(&m, "offset_y", -1.0);
    let s = m.get_shift();
    assert_eq!(s.x, 2.0);
    assert_eq!(s.y, -1.0);
    assert_eq!(s.z, 0.0);
    // Rotation : un axe modifié n'écrase pas les deux autres.
    m.set_rotation(10.0, 20.0, 30.0);
    write_macro_param(&m, "pitch", 99.0);
    let (y, p, r) = m.get_rotation();
    assert_eq!((y, p, r), (10.0, 99.0, 30.0));
    // Scalaires.
    write_macro_param(&m, "speed", 2.5);
    write_macro_param(&m, "radius_scale", 1.4);
    write_macro_param(&m, "height_offset", -3.0);
    assert_eq!(m.get_speed(), 2.5);
    assert_eq!(m.get_radius_scale(), 1.4);
    assert_eq!(m.get_height_offset(), -3.0);
    // Param inconnu → no-op (pas de panic).
    write_macro_param(&m, "bogus", 1.0);
}

#[test]
fn eval_curves_writes_per_move_and_global_scopes() {
    // Clip-scoped → le MacroState du move ; master → celui du
    // merge. Les deux scopes restent disjoints (contrat
    // MacroScope : un param piloté par UN scope).
    let move_macros = stagespace_engines::MacroState::new();
    let merge_macros = stagespace_engines::MacroState::new();
    let mut curves = HashMap::new();
    curves.insert(
        "speed".to_string(),
        vec![
            ScoreKeyframe {
                t: 0,
                v: 1.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 2_000,
                v: 3.0,
                interp: ScoreInterp::Linear,
            },
        ],
    );
    // Blend params — côté merge (`merge:` prefix), pas le worker.
    curves.insert(
        "merge:weight".to_string(),
        vec![
            ScoreKeyframe {
                t: 0,
                v: 1.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 2_000,
                v: 1.8,
                interp: ScoreInterp::Linear,
            },
        ],
    );
    curves.insert(
        "merge:priority".to_string(),
        vec![
            ScoreKeyframe {
                t: 0,
                v: 0.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 2_000,
                v: 8.0,
                interp: ScoreInterp::Linear,
            },
        ],
    );
    let mut targets = HashMap::new();
    targets.insert(
        "sc-c1".to_string(),
        CurveTarget {
            macros: Arc::new(move_macros),
            param_deltas: Arc::new(Mutex::new(HashMap::new())),
            param_targets: HashMap::new(),
            t0_ms: 1_000, // clip à 1s → t local = cursor - 1s
            curves,
        },
    );
    let mut master = HashMap::new();
    master.insert(
        "shift_y".to_string(),
        vec![
            ScoreKeyframe {
                t: 0,
                v: 0.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 4_000,
                v: 4.0,
                interp: ScoreInterp::Linear,
            },
        ],
    );
    let mv = targets["sc-c1"].macros.clone();
    let osc_source: stagespace_engines::signal_compiler::SignalOscSource = std::sync::Arc::new(
        std::sync::RwLock::new(std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()))),
    );
    let modulation = HashMap::from([(
        "/score/energy".to_string(),
        vec![
            ScoreKeyframe {
                t: 0,
                v: 0.0,
                interp: ScoreInterp::Linear,
            },
            ScoreKeyframe {
                t: 4_000,
                v: 1.0,
                interp: ScoreInterp::Linear,
            },
        ],
    )]);
    let merge_rt = Arc::new(Mutex::new(
        stagespace_engines::MergeRuntime::new(
            "127.0.0.1".into(),
            8000,
            stagespace_engines::OscSender::default(),
            60.0,
        )
        .expect("merge runtime"),
    ));
    // Le move doit exister dans active_moves pour que les setters
    // merge:weight/priority aient une cible.
    merge_rt
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .register_move(
            "sc-c1".to_string(),
            Arc::new(stagespace_engines::PositionBuffer::new()),
            vec![0],
            vec![0],
            false,
            stagespace_engines::EndMode::default(),
        );
    // Courbes des lanes objet : `depth` → set_track_depth,
    // canal nommé → set_object_channel — vrais params runtime.
    let object_curves = HashMap::from([(
        0usize,
        HashMap::from([
            (
                "depth".to_string(),
                vec![
                    ScoreKeyframe {
                        t: 0,
                        v: 1.0,
                        interp: ScoreInterp::Linear,
                    },
                    ScoreKeyframe {
                        t: 4_000,
                        v: 0.0,
                        interp: ScoreInterp::Linear,
                    },
                ],
            ),
            (
                "spread".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 60.0,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "pos.x".to_string(),
                vec![ScoreKeyframe {
                    t: 0,
                    v: 7.0,
                    interp: ScoreInterp::Step,
                }],
            ),
            (
                "pos.z".to_string(),
                vec![
                    ScoreKeyframe {
                        t: 0,
                        v: 0.0,
                        interp: ScoreInterp::Linear,
                    },
                    ScoreKeyframe {
                        t: 4_000,
                        v: 4.0,
                        interp: ScoreInterp::Linear,
                    },
                ],
            ),
        ]),
    )]);
    // Takeover partiel : `pos.y` sans courbe garde la valeur de la
    // manual_position déjà posée (ici 9.0).
    merge_rt
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set_manual_position(0, [0.0, 9.0, 0.0]);
    // Courbes SPATIALFX : `ksmooth` → lissage cinématique ;
    // `zone:<i>:<field>`/`mod:<key>:<field>` → patch en place des
    // tables manuelles (la courbe réécrit la définition, jamais
    // l'influence évaluée par le merge).
    {
        let rt = merge_rt.lock().unwrap_or_else(|e| e.into_inner());
        rt.add_zone(stagespace_engines::Zone {
            shape: stagespace_engines::ZoneShape::Sphere {
                center: [0.0, 0.0, 0.0],
                radius: 2.0,
            },
            falloff: 1.0,
            channels: stagespace_engines::SpatialChannels::default(),
            objects: None,
            enabled: true,
            effect: Some(stagespace_engines::zones::ZoneEffect::Repel { strength: 1.0 }),
        })
        .expect("zone");
        rt.add_modulation(stagespace_engines::ChannelModulation::new(
            stagespace_engines::KinematicSource::Speed,
            stagespace_engines::osc_sender::SpatialChannel::Spread,
            1.5,
        ))
        .expect("modulation");
    }
    let spatial_fx_curves = HashMap::from([
        (
            "ksmooth".to_string(),
            vec![ScoreKeyframe {
                t: 0,
                v: 0.9,
                interp: ScoreInterp::Step,
            }],
        ),
        (
            "zone:0:falloff".to_string(),
            vec![ScoreKeyframe {
                t: 0,
                v: 3.0,
                interp: ScoreInterp::Step,
            }],
        ),
        (
            "zone:0:enabled".to_string(),
            vec![ScoreKeyframe {
                t: 0,
                v: 0.0,
                interp: ScoreInterp::Step,
            }],
        ),
        (
            "zone:0:strength".to_string(),
            vec![ScoreKeyframe {
                t: 0,
                v: 5.0,
                interp: ScoreInterp::Step,
            }],
        ),
        (
            "mod:speed>spread:scale".to_string(),
            vec![ScoreKeyframe {
                t: 0,
                v: 4.0,
                interp: ScoreInterp::Step,
            }],
        ),
    ]);
    eval_curves(
        2_000,
        &targets,
        &merge_rt,
        &merge_macros,
        &AbsCurves {
            global_fx: &master,
            modulation: &modulation,
            object: &object_curves,
            spatial_fx: &spatial_fx_curves,
        },
        &osc_source,
    );
    // t local = 1s → speed = 1 + (2-1)·(3-1)/2 = 2.
    assert_eq!(mv.get_speed(), 2.0);
    // cursor 2s → shift_y = 2.0 sur le scope global.
    assert_eq!(merge_macros.get_shift().y, 2.0);
    // cursor 2s → modulation "/score/energy" = 0.5 dans la map OSC.
    let map = osc_source.read().unwrap().clone();
    assert_eq!(lock_or_recover(&map)["/score/energy"], vec![0.5]);
    // Le scope master ne touche pas le move, et réciproquement.
    assert_eq!(merge_macros.get_speed(), 1.0);
    assert_eq!(mv.get_shift().y, 0.0);
    // merge:weight → 1.0 + 0.8·(1s/2s) = 1.4 ; merge:priority → 4.
    let rt = merge_rt.lock().unwrap_or_else(|e| e.into_inner());
    assert_eq!(rt.get_move_weight("sc-c1"), Some(1.4));
    assert_eq!(rt.get_move_priority("sc-c1"), Some(4));
    // Lanes objet : depth obj0 → 1 − 1·(2s/4s) = 0.5 ; spread = 60.
    assert_eq!(rt.track_depths()[0], 0.5);
    assert_eq!(
        rt.object_channels()[&0].spread,
        Some(60.0),
        "la courbe channel doit écrire object_channels"
    );
    // Trajectoire : pos.x = 7 (step), pos.z = 0→4 sur 4s → 2.0 à
    // cursor 2s ; pos.y garde la manual_position préexistante (9.0).
    assert_eq!(rt.manual_position(0), Some([7.0, 9.0, 2.0]));
    // Lane SPATIALFX : ksmooth patché ; zone[0] falloff/strength
    // patchés et enabled coupé ; la règle speed>spread scalée ×4.
    assert!((rt.kinematic_smoothing() - 0.9).abs() < 1e-9);
    assert!((rt.zones()[0].falloff - 3.0).abs() < 1e-9);
    assert!(!rt.zones()[0].enabled);
    assert_eq!(
        rt.zones()[0].effect,
        Some(stagespace_engines::zones::ZoneEffect::Repel { strength: 5.0 })
    );
    assert!((rt.modulations()[0].scale - 4.0).abs() < 1e-9);
}
