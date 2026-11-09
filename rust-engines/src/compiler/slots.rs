/// Modulation de params par slots (domaine signal `param:`) — extraite de
/// mod.rs (règle modularisation). Helpers appelés par compile_engine /
/// compile_modifier : binding compile-time des slots de params modulables.
use crate::audio::AudioState;
use crate::engines::EngineParams;
use crate::graph::Node;
use crate::param_slots::ParamSlots;
use std::sync::{Arc, Mutex};
use super::LiveInputs;

// ── Modulation de params par slots (domaine signal `param:`) ──


/// Binding compile-time d'un param modulable : index du slot + bornes du
/// spec. Capturé par la closure — l'eval reste lock/alloc-free.
#[derive(Clone, Copy, Default)]
pub(crate) struct SlotBind {
    idx: Option<usize>,
    min: Option<f64>,
    max: Option<f64>,
}

/// Résout le binding d'un param — index de slot + `min`/`max` déclarés
/// dans le NodeSpec (mêmes bornes que le param statique).
pub(crate) fn sidx(slots: &Option<Arc<ParamSlots>>, node: &Node, key: &str) -> SlotBind {
    let Some(s) = slots.as_ref() else {
        return SlotBind::default();
    };
    let spec = crate::node_spec::node_spec(&node.node_type);
    let p = spec.params.iter().find(|p| p.key == key);
    SlotBind {
        idx: s.slot_of(&crate::param_slots::node_key(node), key),
        min: p.and_then(|p| p.min),
        max: p.and_then(|p| p.max),
    }
}

/// Valeur effective d'un param modulable : `clamp(base + delta)` aux
/// bornes du spec (un delta hostile ne peut pas sortir le param de sa
/// plage déclarée — mêmes limites que le réglage manuel). Additif : un
/// SignalOut à 0 laisse la valeur de base.
/// Cap absolu sur les params sans borne déclarée : au-delà, les produits
/// en aval (`speed * t`, `t * factor`…) débordent en inf → NaN. 1e12 est
/// sans objet métier mais garantit des entrées finies aux engines.
const PARAM_ABS_CAP: f64 = 1e12;

#[inline]
fn clamp_param(v: f64, min: Option<f64>, max: Option<f64>) -> f64 {
    let v = v.clamp(-PARAM_ABS_CAP, PARAM_ABS_CAP);
    match (min, max) {
        (Some(lo), Some(hi)) => v.clamp(lo, hi),
        (Some(lo), None) => v.max(lo),
        (None, Some(hi)) => v.min(hi),
        (None, None) => v,
    }
}

#[inline]
pub(crate) fn sval(slots: &Option<Arc<ParamSlots>>, bind: SlotBind, base: f64) -> f64 {
    let Some(s) = slots else {
        return base;
    };
    let Some(i) = bind.idx else {
        return base;
    };
    clamp_param(base + s.delta(i), bind.min, bind.max)
}

/// Patch par-frame de `params.extra` pour les engines (qui lisent leurs
/// params via la map JSON plutôt que des arguments scalaires). Rebuild au
/// plus une fois par frame par node : si tous les deltas du node sont 0
/// → params bakés empruntés (aucun clone) ; sinon le clone patché est
/// caché par `generation` et réutilisé pour tous les objets de la frame.
/// (param_key, slot_index, base de fallback JSON si absente d'extra,
/// min/max du spec — bornes appliquées au delta comme `sval`)
type EngineSlotKey = (String, usize, serde_json::Value, Option<f64>, Option<f64>);

pub struct EngineSlotPatch {
    slots: Arc<ParamSlots>,
    keys: Vec<EngineSlotKey>,
    cache: Mutex<(u64, Option<EngineParams>)>,
}

pub(crate) fn build_slot_patch(
    params: &EngineParams,
    live: &LiveInputs,
    node: &Node,
) -> Option<Arc<EngineSlotPatch>> {
    let slots = live.param_slots.clone()?;
    let nk = crate::param_slots::node_key(node);
    let spec = crate::node_spec::node_spec(&node.node_type);
    let mut keys = Vec::new();
    for p in &spec.params {
        if !p.modulable {
            continue;
        }
        let Some(idx) = slots.slot_of(&nk, &p.key) else {
            continue;
        };
        let base = params
            .extra
            .get(&p.key)
            .cloned()
            .or_else(|| {
                p.default_json
                    .as_deref()
                    .and_then(|d| serde_json::from_str(d).ok())
            })
            .unwrap_or(match p.kind {
                // Booléen sans défaut déclaré → base false (sémantique
                // `(base + delta) >= 0.5`) ; un f64 brut serait ignoré
                // par `as_bool` et le param resterait au défaut engine.
                crate::node_spec::ParamKind::Boolean => serde_json::Value::Bool(false),
                _ => serde_json::Value::Null,
            });
        keys.push((p.key.clone(), idx, base, p.min, p.max));
    }
    if keys.is_empty() {
        None
    } else {
        Some(Arc::new(EngineSlotPatch {
            slots,
            keys,
            cache: Mutex::new((0, None)),
        }))
    }
}

/// `base + delta` clampé aux bornes du spec, en préservant le type JSON :
/// bool → seuil 0.5 (sémantique `(base as f64 + delta) >= 0.5`),
/// number → somme clampée, Null → delta seul clampé, autres types →
/// inchangé (non modulable de fait).
fn add_delta_json(
    base: &serde_json::Value,
    delta: f64,
    min: Option<f64>,
    max: Option<f64>,
) -> serde_json::Value {
    let clamped = |v: f64| clamp_param(v, min, max);
    match base {
        serde_json::Value::Bool(b) => serde_json::json!(f64::from(*b) + delta >= 0.5),
        serde_json::Value::Number(n) => {
            let v = clamped(n.as_f64().unwrap_or(0.0) + delta);
            // Les params entiers (n_bands…) sont lus via `as_u64`/`as_i64`
            // qui REJETTENT les floats — préserver l'intégralité.
            if n.is_u64() || n.is_i64() {
                serde_json::json!(v.round() as i64)
            } else {
                serde_json::json!(v)
            }
        }
        serde_json::Value::Null => serde_json::json!(clamped(delta)),
        _ => base.clone(),
    }
}

/// Appelle `f` avec les params effectifs du node : bakés si aucun delta
/// actif, sinon clone patché caché par generation (rebuild ≤ 1×/frame).
pub(crate) fn with_patched_params<R>(
    params: &EngineParams,
    patch: &Option<Arc<EngineSlotPatch>>,
    f: impl FnOnce(&EngineParams) -> R,
) -> R {
    let Some(p) = patch else {
        return f(params);
    };
    if p.keys
        .iter()
        .all(|(_, i, _, _, _)| p.slots.delta(*i) == 0.0)
    {
        return f(params);
    }
    let gen = p.slots.generation();
    let mut c = p.cache.lock().unwrap_or_else(|e| e.into_inner());
    if c.0 != gen || c.1.is_none() {
        let mut patched = params.clone();
        if let Some(extra) = patched.extra.as_object_mut() {
            for (key, i, base, min, max) in &p.keys {
                let d = p.slots.delta(*i);
                if d == 0.0 {
                    continue;
                }
                let cur = extra.get(key).cloned().unwrap_or_else(|| base.clone());
                extra.insert(key.clone(), add_delta_json(&cur, d, *min, *max));
            }
        }
        *c = (gen, Some(patched));
    }
    match c.1.as_ref() {
        Some(effective) => f(effective),
        None => f(params),
    }
}

/// Injecte les valeurs audio temps réel dans les params extra d'un engine
pub(crate) fn inject_audio_values(
    map: &mut serde_json::Map<String, serde_json::Value>,
    audio_arc: &Arc<Mutex<AudioState>>,
) {
    let audio = audio_arc.lock().unwrap_or_else(|e| e.into_inner());
    // BPM
    if let Some(bpm_data) = &audio.bpm {
        map.insert("bpm".to_string(), serde_json::json!(bpm_data.bpm));
        map.insert(
            "bpm_confidence".to_string(),
            serde_json::json!(bpm_data.confidence),
        );
        map.insert(
            "last_beat_time".to_string(),
            serde_json::json!(bpm_data.last_beat_time),
        );
    }
    // Amplitude par bande
    if let Some(amp) = &audio.amplitude {
        map.insert("amplitude".to_string(), serde_json::json!(amp.rms));
        map.insert("amplitude_rms".to_string(), serde_json::json!(amp.rms));
        map.insert("amplitude_bass".to_string(), serde_json::json!(amp.bass));
        map.insert("amplitude_mid".to_string(), serde_json::json!(amp.mid));
        map.insert("amplitude_high".to_string(), serde_json::json!(amp.high));
    }
    // Spectre — array + bandes individuelles
    if let Some(spec) = &audio.spectrum {
        let n_bands = 8;
        let bins_per_band = (spec.spectrum.len() / n_bands).max(1);
        let bands: Vec<f64> = (0..n_bands)
            .map(|i| {
                let start = i * bins_per_band;
                let end = ((i + 1) * bins_per_band).min(spec.spectrum.len());
                if start >= end {
                    return 0.0;
                }
                let sum: f64 = spec.spectrum[start..end].iter().sum();
                sum / (end - start) as f64
            })
            .collect();
        map.insert("spectrum".to_string(), serde_json::json!(bands));
        for (i, val) in bands.iter().enumerate() {
            map.insert(format!("spectrum_band_{i}"), serde_json::json!(val));
        }
    }
}

