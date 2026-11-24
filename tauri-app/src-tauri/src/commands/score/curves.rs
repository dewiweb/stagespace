//! Moteur de courbes du séquenceur — échantillonnage (`sample_curve`),
//! cibles clip-scoped (`CurveTarget` : macros per-move, deltas `param:`,
//! blend `merge:`) et les couches temps-absolu (`AbsCurves` : GLOBALFX,
//! MODULATION, lanes objet, SPATIALFX). Évalué à chaque réveil de
//! l'horloge (≤50 ms) par le scheduler.
use super::types::{ScoreInterp, ScoreKeyframe};
use crate::commands::state::lock_or_recover;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

/// Échantillonne une courbe (keyframes triés par t) — interpolation
/// linéaire, clamp aux bornes avant/après. `None` = courbe vide.
pub(crate) fn sample_curve(kfs: &[ScoreKeyframe], t_ms: u64) -> Option<f64> {
    match kfs.len() {
        0 => None,
        1 => Some(kfs[0].v),
        _ => {
            if t_ms <= kfs[0].t {
                return Some(kfs[0].v);
            }
            let last = &kfs[kfs.len() - 1];
            if t_ms >= last.t {
                return Some(last.v);
            }
            let i = kfs.partition_point(|k| k.t <= t_ms);
            let (a, b) = (&kfs[i - 1], &kfs[i]);
            let f = (t_ms - a.t) as f64 / (b.t - a.t) as f64;
            let v = match a.interp {
                // step : la valeur du keyframe tient jusqu'au suivant.
                ScoreInterp::Step => a.v,
                // smooth : smoothstep — ease in/out sans overshoot.
                ScoreInterp::Smooth => {
                    let s = f * f * (3.0 - 2.0 * f);
                    a.v + (b.v - a.v) * s
                }
                ScoreInterp::Linear => a.v + (b.v - a.v) * f,
            };
            Some(v)
        }
    }
}

/// Écrit une valeur de courbe sur un MacroState — même convention de
/// noms que `audio_param_overrides` (`offset_*` et `shift_*` acceptés
/// pour les axes, comme la traduction du signal graph). Valable pour
/// les deux scopes : `Runtime::macros()` (per-move) et
/// `MergeRuntime::macros()` (global).
pub(crate) fn write_macro_param(m: &stagespace_engines::MacroState, param: &str, v: f64) {
    match param {
        "speed" => m.set_speed(v),
        "scale" => m.set_scale(v),
        "radius_scale" => m.set_radius_scale(v),
        "height_offset" => m.set_height_offset(v),
        "shift_x" | "offset_x" => {
            let s = m.get_shift();
            m.set_shift(v, s.y, s.z);
        }
        "shift_y" | "offset_y" => {
            let s = m.get_shift();
            m.set_shift(s.x, v, s.z);
        }
        "shift_z" | "offset_z" => {
            let s = m.get_shift();
            m.set_shift(s.x, s.y, v);
        }
        "yaw" => {
            let (_, p, r) = m.get_rotation();
            m.set_rotation(v, p, r);
        }
        "pitch" => {
            let (y, _, r) = m.get_rotation();
            m.set_rotation(y, v, r);
        }
        "roll" => {
            let (y, p, _) = m.get_rotation();
            m.set_rotation(y, p, v);
        }
        _ => {}
    }
}

/// Une cible de courbes clip-scoped : le MacroState du move spawné,
/// le canal de deltas `param:` de son runtime, les cibles résolues au
/// fire, le t0 ABSOLU de cette itération (start + k·repeat — le temps
/// local de la courbe = cursor − t0) et la table de keyframes.
/// Cible `param:` résolue — ((node_key, param_key), base du node).
pub(crate) type ResolvedParamTarget = ((String, String), f64);

#[derive(Clone)]
pub struct CurveTarget {
    pub(crate) macros: Arc<stagespace_engines::MacroState>,
    /// `Runtime::param_deltas` — même canal que les contributions du
    /// signal graph (somme dans `ParamSlots::apply_frame`).
    pub(crate) param_deltas: Arc<Mutex<HashMap<(String, String), f64>>>,
    /// Cibles `param:` résolues au fire — clé de courbe →
    /// ((node_key, param_key), base). La base sert à convertir la
    /// valeur absolue de la courbe en delta (`slots = base + Δ`).
    pub(crate) param_targets: HashMap<String, Vec<ResolvedParamTarget>>,
    pub(crate) t0_ms: u64,
    pub(crate) curves: HashMap<String, Vec<ScoreKeyframe>>,
}

/// Résolution d'une cible de courbe `param:<node_id|NodeType>:<key>` —
/// mêmes règles que le signal compiler (id d'abord, type-wide ensuite),
/// appliquées au `graph_json` de la request du clip. Retourne les
/// ((node_key, param_key), base) — node_key = l'id React Flow du node
/// (= `__fe_id` injecté par le parser, clé stable des ParamSlots).
pub(crate) fn resolve_param_targets(
    gj: &stagespace_engines::GraphJson,
    param_id: &str,
) -> Vec<ResolvedParamTarget> {
    let Some(rest) = param_id.strip_prefix("param:") else {
        return Vec::new();
    };
    let Some((seg, key)) = rest.split_once(':') else {
        return Vec::new();
    };
    let by_id: Vec<&stagespace_engines::GraphNodeJson> =
        gj.nodes.iter().filter(|n| n.id == seg).collect();
    let targets: Vec<&stagespace_engines::GraphNodeJson> = if !by_id.is_empty() {
        by_id
    } else {
        gj.nodes
            .iter()
            .filter(|n| n.data.node_type.as_deref() == Some(seg))
            .collect()
    };
    targets
        .iter()
        .filter_map(|n| {
            let base = n.data.params.get(key)?.as_f64()?;
            Some(((n.id.clone(), key.to_string()), base))
        })
        .collect()
}

/// Évalue toutes les courbes au curseur courant — appelé à chaque
/// réveil de l'horloge (le sleep est borné à 50 ms). Clip-scoped →
/// macros per-move + deltas `param:` + blend `merge:` (weight /
/// priority — `set_move_*`, côté merge pas worker) du move ;
/// GLOBALFX → macros globales du merge ; MODULATION → valeurs
/// nommées dans la map OSC (source `SignalOsc` des graphs de
/// modulation — le score agit comme un contrôleur OSC de plus).
/// Les trois couches de courbes temps-absolu du score — regroupées
/// pour `eval_curves` (clippy::too_many_arguments).
pub(crate) struct AbsCurves<'a> {
    pub(crate) global_fx: &'a HashMap<String, Vec<ScoreKeyframe>>,
    pub(crate) modulation: &'a HashMap<String, Vec<ScoreKeyframe>>,
    /// `obj_index → param → keyframes` (lanes objet `obj-<trackId>`).
    pub(crate) object: &'a HashMap<usize, HashMap<String, Vec<ScoreKeyframe>>>,
    /// Lane SPATIALFX — `ksmooth`, `zone:<i>:<field>`, `mod:<key>:<field>`.
    pub(crate) spatial_fx: &'a HashMap<String, Vec<ScoreKeyframe>>,
}

/// Écrit une valeur de courbe SPATIALFX — patch en place des tables
/// manuelles du merge (jamais l'influence, toujours la définition) :
/// - `ksmooth` → `set_kinematic_smoothing` (lissage cinématique global)
/// - `zone:<i>:<field>` → `falloff` / `strength` (des effets Repel/
///   Attract/Dampen/Vortex) / `enabled` (v ≥ 0.5) — `update_zone(i, z)`.
///   `i` est POSITIONNEL : index dans la table courante — le dernier
///   clip `zones` tiré (ou l'état opérateur) fixe l'ordre.
/// - `mod:<src>><ch>[@<obj>][#<n>]:<field>` → `scale`/`offset`/`min`/`max`
///   de la n-ième règle matchant `(source, channel, object)` —
///   `update_modulation(i, r)`. La clé est stable entre les
///   réinstallations de table (contrairement à l'index) ; `#n`
///   départage les règles qui partagent le même triplet.
///
/// Clé/champ/index inconnu → skip silencieux (la courbe s'applique à
/// la table COURANTE : une règle absente n'a rien à moduler).
fn eval_spatial_fx_param(rt: &stagespace_engines::MergeRuntime, param: &str, v: f64) {
    if param == "ksmooth" {
        rt.set_kinematic_smoothing(v);
        return;
    }
    if param == "spatial" {
        // Compresseur spatial global — même chemin que `/stagespace/spatial`.
        rt.set_spatial_compression(v);
        return;
    }
    if let Some(rest) = param.strip_prefix("zone:") {
        let Some((idx, field)) = rest.split_once(':') else {
            return;
        };
        let Ok(i) = idx.parse::<usize>() else {
            return;
        };
        let mut zones = rt.zones();
        let Some(z) = zones.get_mut(i) else {
            return;
        };
        match field {
            "falloff" => z.falloff = v.max(0.0),
            "enabled" => z.enabled = v >= 0.5,
            "strength" => {
                if let Some(
                    stagespace_engines::zones::ZoneEffect::Repel { strength }
                    | stagespace_engines::zones::ZoneEffect::Attract { strength }
                    | stagespace_engines::zones::ZoneEffect::Dampen { strength }
                    | stagespace_engines::zones::ZoneEffect::Vortex { strength },
                ) = z.effect.as_mut()
                {
                    *strength = v;
                }
            }
            _ => return,
        }
        let z = z.clone();
        rt.update_zone(i, z);
        return;
    }
    if let Some(rest) = param.strip_prefix("mod:") {
        let Some((key, field)) = rest.split_once(':') else {
            return;
        };
        // `src>ch[@obj][#n]` — #n = occurrence (défaut 0).
        let (key, occ) = match key.split_once('#') {
            Some((k, n)) => (k, n.parse::<usize>().unwrap_or(0)),
            None => (key, 0),
        };
        let (src_ch, obj) = match key.split_once('@') {
            Some((a, b)) => (a, b.parse::<usize>().ok()),
            None => (key, None),
        };
        let obj = match (key.contains('@'), obj) {
            // `@` présent mais non numérique → clé invalide.
            (true, None) => return,
            _ => obj,
        };
        let Some((src, ch)) = src_ch.split_once('>') else {
            return;
        };
        let (Ok(src), Ok(ch)) = (
            stagespace_engines::KinematicSource::from_str(src),
            stagespace_engines::osc_sender::SpatialChannel::from_str(ch),
        ) else {
            return;
        };
        let rules = rt.modulations();
        let mut seen = 0usize;
        for (i, r) in rules.iter().enumerate() {
            if r.source == src && r.channel == ch && r.object == obj {
                if seen == occ {
                    let mut patched = r.clone();
                    match field {
                        "scale" => patched.scale = v,
                        "offset" => patched.offset = v,
                        "min" => patched.min = v,
                        "max" => patched.max = v,
                        _ => return,
                    }
                    rt.update_modulation(i, patched);
                    return;
                }
                seen += 1;
            }
        }
    }
}

pub(crate) fn eval_curves(
    cursor_ms: u64,
    targets: &HashMap<String, CurveTarget>,
    merge: &Arc<Mutex<stagespace_engines::MergeRuntime>>,
    master: &stagespace_engines::MacroState,
    abs: &AbsCurves<'_>,
    osc_source: &stagespace_engines::signal_compiler::SignalOscSource,
) {
    for (move_id, target) in targets {
        let lt = cursor_ms.saturating_sub(target.t0_ms);
        for (param, kfs) in &target.curves {
            if let Some(v) = sample_curve(kfs, lt) {
                if param.starts_with("param:") {
                    // Courbe absolue → delta `v − base` sur les slots du
                    // move (param modulable du graphe — même canal que
                    // le signal graph, relu à la frame suivante).
                    if let Some(tgts) = target.param_targets.get(param) {
                        if !tgts.is_empty() {
                            let mut ext = lock_or_recover(&target.param_deltas);
                            for ((nk, pk), base) in tgts {
                                ext.insert((nk.clone(), pk.clone()), v - base);
                            }
                        }
                    }
                } else if let Some(mk) = param.strip_prefix("merge:") {
                    // Blend params — côté MERGE, pas le worker :
                    // `fade × weight` est le poids effectif dans
                    // Override/Crossfade/Blend ; priority départage la
                    // stratégie Priority. Même canal que les IPC
                    // set_move_weight/set_move_priority.
                    let rt = lock_or_recover(merge);
                    match mk {
                        "weight" => rt.set_move_weight(move_id, v),
                        "priority" => rt.set_move_priority(move_id, v.max(0.0).round() as u32),
                        _ => {}
                    }
                } else {
                    write_macro_param(&target.macros, param, v);
                }
            }
        }
    }
    for (param, kfs) in abs.global_fx {
        if let Some(v) = sample_curve(kfs, cursor_ms) {
            write_macro_param(master, param, v);
        }
    }
    if !abs.spatial_fx.is_empty() {
        let rt = lock_or_recover(merge);
        for (param, kfs) in abs.spatial_fx {
            if let Some(v) = sample_curve(kfs, cursor_ms) {
                eval_spatial_fx_param(&rt, param, v);
            }
        }
    }
    if !abs.object.is_empty() {
        let rt = lock_or_recover(merge);
        // Trajectoires keyframées — les courbes `pos.<axis>` écrivent
        // une manual_position au tick (takeover authored). Les axes
        // sans courbe gardent la valeur courante (manual_position si
        // posée, sinon dernière position émise) : takeover partiel
        // sans saut. Fin de courbe = hold — la dernière valeur écrite
        // persiste, comme une position manuelle posée à la main.
        let mut pos_writes: HashMap<usize, [Option<f64>; 3]> = HashMap::new();
        for (obj, params) in abs.object {
            for (param, kfs) in params {
                if let Some(v) = sample_curve(kfs, cursor_ms) {
                    if param == "depth" {
                        rt.set_track_depth(*obj, v);
                    } else if let Some(axis) = param.strip_prefix("pos.") {
                        let i = match axis {
                            "x" => 0,
                            "y" => 1,
                            "z" => 2,
                            _ => continue,
                        };
                        pos_writes.entry(*obj).or_insert([None; 3])[i] = Some(v);
                    } else if let Ok(ch) =
                        stagespace_engines::osc_sender::SpatialChannel::from_str(param)
                    {
                        rt.set_object_channel(*obj, ch, v);
                    }
                }
            }
        }
        for (obj, axes) in pos_writes {
            let mut p = rt
                .manual_position(obj)
                .or_else(|| rt.last_position(obj))
                .unwrap_or([0.0; 3]);
            for (i, a) in axes.iter().enumerate() {
                if let Some(v) = a {
                    p[i] = *v;
                }
            }
            rt.set_manual_position(obj, p);
        }
    }
    if !abs.modulation.is_empty() {
        // Read-lock → map COURANTE (suit les rebinds du receiver),
        // puis une écriture par nom — `SignalOsc.name` les relit à la
        // frame suivante, comme une adresse OSC reçue.
        let map = osc_source.read().unwrap_or_else(|e| e.into_inner()).clone();
        let mut vals = lock_or_recover(&map);
        for (name, kfs) in abs.modulation {
            if let Some(v) = sample_curve(kfs, cursor_ms) {
                vals.insert(name.clone(), vec![v]);
            }
        }
    }
}
