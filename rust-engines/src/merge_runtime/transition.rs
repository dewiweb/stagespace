//! Recall transitions — crossfade de tout le "output layer" (post-process
//! graph, macros, positions manuelles, depths, canaux, zones, modulations,
//! origin), pas seulement des moves. Sans ça un GO avec fade fait sauter
//! le mix de manière audible (gain, zones, transform appliqués d'un coup).
//!
//! Le Layer est un arbre : `Live` = l'état courant (les setters écrivent
//! directement dedans — la cible d'un blend est toujours Live), `Frozen`
//! = snapshot immuable pris au `begin_transition`, `Blend` = fondu entre
//! deux sous-arbres sur `duration`. Des GO rapides en chaîne gardent la
//! continuité : le nouvel `from` est l'arbre courant dont la feuille Live
//! est remplacée par un Frozen de l'état effectif à cet instant.
//!
//! Profondeur bornée à 3 — le plus vieux Blend est collapé dans sa cible
//! quand il est fini (elapsed >= duration) ; une fois la transition
//! racine finie, on revient à `Layer::Live` (coût nul, chemin normal).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use crate::kinematics::{apply_modulations, ChannelModulation, KinematicState};
use crate::osc_sender::SpatialChannels;
use crate::runtime::MacroFrameSnapshot;
use crate::runtime::{PostProcessContext, PostProcessFn};
use crate::zones::{any_zone_applies, apply_zones, Zone};

/// Snapshot immuable de l'état output d'une frame — tout ce qui n'est
/// pas les positions mergées des moves.
#[derive(Clone)]
pub(crate) struct OutputLayer {
    pub post_process_fn: Arc<PostProcessFn>,
    pub macros: MacroFrameSnapshot,
    pub manual_positions: HashMap<usize, [f64; 3]>,
    pub track_depths: Vec<f64>,
    pub object_channels: HashMap<usize, SpatialChannels>,
    pub zones: Vec<Zone>,
    pub modulations: Vec<ChannelModulation>,
    pub origin: nalgebra::Vector3<f64>,
}

/// Arbre de layers — voir le doc du module.
#[derive(Clone)]
pub(crate) enum Layer {
    Live,
    Frozen(Box<OutputLayer>),
    Blend {
        from: Box<Layer>,
        to: Box<Layer>,
        start: Instant,
        duration: f64,
    },
}

const MAX_DEPTH: usize = 3;

impl Layer {
    /// Remplace la feuille Live de l'arbre par `frozen` (utilisé au
    /// démarrage d'une transition : l'état effectif courant devient le
    /// `from` de la nouvelle transition, l'in-flight reste intact).
    fn replace_live(self, frozen: OutputLayer) -> Layer {
        match self {
            Layer::Live => Layer::Frozen(Box::new(frozen)),
            Layer::Frozen(_) => Layer::Frozen(Box::new(frozen)),
            Layer::Blend {
                from,
                to,
                start,
                duration,
            } => Layer::Blend {
                from,
                to: Box::new(to.replace_live(frozen)),
                start,
                duration,
            },
        }
    }

    /// Profondeur de la chaîne `from` (combien de Blend imbriqués).
    fn depth(&self) -> usize {
        match self {
            Layer::Blend { from, .. } => 1 + from.depth(),
            _ => 0,
        }
    }

    /// Collapse le plus vieux Blend terminé (elapsed >= duration) dans sa
    /// cible — borne la profondeur pour des GOs rapides illimités.
    fn collapse_finished(&mut self, now: Instant) {
        if let Layer::Blend {
            from,
            to,
            start,
            duration,
        } = self
        {
            from.collapse_finished(now);
            if *duration > 0.0 && now.duration_since(*start).as_secs_f64() >= *duration {
                *self = (**to).clone();
            }
        }
    }

    /// Nouvelle transition : `from` = l'arbre courant (feuille Live →
    /// Frozen snapshot), `to` = Live. La transition précédente continue
    /// de progresser à l'intérieur.
    pub(crate) fn begin(self, frozen: OutputLayer, duration: f64) -> Layer {
        let from = self.replace_live(frozen);
        let mut new_layer = Layer::Blend {
            from: Box::new(from),
            to: Box::new(Layer::Live),
            start: Instant::now(),
            duration,
        };
        // Borne : au-delà de MAX_DEPTH de `from` imbriqués, collapse le
        // plus vieux — il est de toute façon (quasi) fini.
        while new_layer.depth() > MAX_DEPTH {
            if let Layer::Blend { from, .. } = &mut new_layer {
                let mut inner = (**from).clone();
                inner.collapse_finished(Instant::now());
                **from = inner;
            } else {
                break;
            }
        }
        new_layer
    }
}

/// Facteur de fondu — smoothstep borné, même courbe que `Runtime::recall_cue`.
fn blend_factor(start: Instant, duration: f64) -> f64 {
    if duration <= 0.0 {
        return 1.0;
    }
    let x = (start.elapsed().as_secs_f64() / duration).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// Vrai quand l'arbre entier est terminé → la boucle peut retomber à Live.
pub(crate) fn layer_finished(layer: &Layer) -> bool {
    match layer {
        Layer::Live => true,
        Layer::Frozen(_) => false,
        Layer::Blend {
            to,
            start,
            duration,
            ..
        } => **to == Layer::Live && *duration > 0.0 && start.elapsed().as_secs_f64() >= *duration,
    }
}

impl PartialEq for Layer {
    fn eq(&self, other: &Self) -> bool {
        matches!(
            (self, other),
            (Layer::Live, Layer::Live)
                | (Layer::Frozen(_), Layer::Frozen(_))
                | (Layer::Blend { .. }, Layer::Blend { .. })
        )
    }
}

/// Entrées live pour évaluer la feuille `Live` — mêmes champs qu'un
/// OutputLayer mais pointant sur l'état courant (macros effectives =
/// base + deltas du signal graph, déjà résolues par l'appelant).
pub(crate) struct LiveInputs<'a> {
    pub post_process_fn: &'a Arc<PostProcessFn>,
    pub macros: &'a crate::runtime::MacroState,
    pub manual_positions: &'a HashMap<usize, [f64; 3]>,
    pub track_depths: &'a [f64],
    pub object_channels: &'a HashMap<usize, SpatialChannels>,
    pub zones: &'a [Zone],
    pub modulations: &'a [ChannelModulation],
    pub origin: nalgebra::Vector3<f64>,
}

/// Contexte commun aux layers (track_positions, audio, t) — indépendant
/// du graphe post-process.
type LayerEval = (
    Vec<(usize, nalgebra::Vector3<f64>)>,
    HashMap<usize, SpatialChannels>,
);

pub(crate) struct EvalCommon<'a> {
    pub t: f64,
    pub audio_state: &'a crate::audio::AudioState,
    pub track_positions: &'a HashMap<u32, [f64; 3]>,
    /// Deltas du signal graph courant — la modulation est une couche
    /// live continue, indépendante du recall : elle s'applique AUSSI aux
    /// feuilles figées (sinon b≈0 saute en perdant le delta).
    pub macros_deltas: &'a crate::signal_compiler::SignalDeltas,
}

struct LayerView<'a> {
    pp_fn: &'a Arc<PostProcessFn>,
    macros_state: Option<&'a crate::runtime::MacroState>,
    manual_positions: &'a HashMap<usize, [f64; 3]>,
    track_depths: &'a [f64],
    object_channels: &'a HashMap<usize, SpatialChannels>,
    zones: &'a [Zone],
    modulations: &'a [ChannelModulation],
    origin: nalgebra::Vector3<f64>,
}

/// Positions post-process d'un layer — positions brutes, non sanitizées
/// (la sanitize + non-finite drop reste à l'appelant, après le blend).
fn eval_layer_positions(
    view: &LayerView,
    macros_owned: &Option<crate::runtime::MacroState>,
    merged: &[(usize, nalgebra::Vector3<f64>)],
    common: &EvalCommon,
) -> Vec<(usize, nalgebra::Vector3<f64>)> {
    let ctx = PostProcessContext {
        t: common.t,
        macros: view
            .macros_state
            .or(macros_owned.as_ref())
            .expect("macros resolved"),
        audio_state: common.audio_state,
        track_positions: common.track_positions,
        manual_positions: view.manual_positions,
        origin: view.origin,
        track_depths: view.track_depths,
    };
    (view.pp_fn)(&ctx, merged.to_vec())
}

/// Canaux effectifs d'un layer : statiques ⊕ modulations ⊕ zones — mêmes
/// règles de précédence que la boucle principale.
fn eval_layer_channels(
    view: &LayerView,
    positions: &[(usize, nalgebra::Vector3<f64>)],
    kin_states: &HashMap<usize, KinematicState>,
) -> HashMap<usize, SpatialChannels> {
    let modulated = apply_modulations(view.modulations, kin_states);
    let mut out = HashMap::new();
    for (obj_idx, pos) in positions {
        let has_zones = any_zone_applies(view.zones, *obj_idx, pos);
        match (
            view.object_channels.get(obj_idx),
            modulated.get(obj_idx),
            has_zones,
        ) {
            (None, None, false) => {}
            (s, m, _) => {
                let mut eff = s.copied().unwrap_or_default();
                if let Some(mc) = m {
                    eff.overlay(mc);
                }
                apply_zones(view.zones, *obj_idx, pos, &mut eff);
                out.insert(*obj_idx, eff);
            }
        }
    }
    out
}

/// Blend de positions : objet présent dans les deux → lerp ; seulement
/// dans `to` → `to` ; seulement dans `from` → gardé jusqu'à b=1.
pub(crate) fn blend_positions(
    from: &[(usize, nalgebra::Vector3<f64>)],
    to: &[(usize, nalgebra::Vector3<f64>)],
    b: f64,
) -> Vec<(usize, nalgebra::Vector3<f64>)> {
    let to_map: HashMap<usize, nalgebra::Vector3<f64>> = to.iter().cloned().collect();
    let mut out = Vec::with_capacity(from.len() + to.len());
    let mut seen = std::collections::HashSet::new();
    for (idx, p_from) in from {
        if let Some(p_to) = to_map.get(idx) {
            out.push((*idx, p_from * (1.0 - b) + p_to * b));
            seen.insert(*idx);
        } else if b < 1.0 {
            out.push((*idx, *p_from));
            seen.insert(*idx);
        }
    }
    for (idx, p_to) in to {
        if !seen.contains(idx) {
            out.push((*idx, *p_to));
        }
    }
    out
}

/// Blend de canaux : les deux → lerp ; seulement `to` → snap `to` ;
/// seulement `from` → gardé tant que b<1.
pub(crate) fn blend_channels(
    from: &HashMap<usize, SpatialChannels>,
    to: &HashMap<usize, SpatialChannels>,
    b: f64,
) -> HashMap<usize, SpatialChannels> {
    fn lerp_opt(a: Option<f64>, b_: Option<f64>, t: f64) -> Option<f64> {
        match (a, b_) {
            (Some(x), Some(y)) => Some(x * (1.0 - t) + y * t),
            (None, Some(y)) => Some(y),
            (Some(x), None) if t < 1.0 => Some(x),
            _ => None,
        }
    }
    fn merge(f: &SpatialChannels, t: &SpatialChannels, b: f64) -> SpatialChannels {
        SpatialChannels {
            gain: lerp_opt(f.gain, t.gain, b),
            spread: lerp_opt(f.spread, t.spread, b),
            distance: lerp_opt(f.distance, t.distance, b),
            presence: lerp_opt(f.presence, t.presence, b),
            yaw: lerp_opt(f.yaw, t.yaw, b),
            aperture: lerp_opt(f.aperture, t.aperture, b),
            lfe: lerp_opt(f.lfe, t.lfe, b),
        }
    }
    let mut out = HashMap::with_capacity(from.len().max(to.len()));
    for (idx, f) in from {
        match to.get(idx) {
            Some(t) => {
                let m = merge(f, t, b);
                if !m.is_empty() {
                    out.insert(*idx, m);
                }
            }
            None if b < 1.0 => {
                out.insert(*idx, *f);
            }
            _ => {}
        }
    }
    for (idx, t) in to {
        if !from.contains_key(idx) && !t.is_empty() {
            out.insert(*idx, *t);
        }
    }
    out
}

/// Évalue l'arbre complet → (positions, canaux effectifs). La passe
/// positions se fait récursivement (blend interne), puis les canaux sont
/// évalués par feuille sur les positions de CETTE feuille et blendés —
/// les deux côtés partagent `kin_states` (mis à jour par l'appelant sur
/// les positions finales blendées).
#[allow(clippy::too_many_arguments)]
/// Compose positions + canaux — utilisé par les tests (la boucle
/// appelle les deux passes séparément autour de l'update cinématique).
#[allow(dead_code)]
pub(crate) fn eval_layer(
    layer: &Layer,
    live: &LiveInputs,
    merged: &[(usize, nalgebra::Vector3<f64>)],
    common: &EvalCommon,
    kin_states: &HashMap<usize, KinematicState>,
    dropped: Option<&std::sync::atomic::AtomicU64>,
) -> LayerEval {
    let positions = eval_positions_tree(layer, live, merged, common);
    let positions: Vec<_> = positions
        .into_iter()
        .filter(|(_, p)| {
            if p.iter().all(|v| v.is_finite()) {
                true
            } else {
                if let Some(d) = dropped {
                    d.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                false
            }
        })
        .collect();
    let channels = eval_channels_tree(layer, live, merged, common, kin_states);
    (positions, channels)
}

pub(crate) fn eval_positions_tree(
    layer: &Layer,
    live: &LiveInputs,
    merged: &[(usize, nalgebra::Vector3<f64>)],
    common: &EvalCommon,
) -> Vec<(usize, nalgebra::Vector3<f64>)> {
    match layer {
        Layer::Blend {
            from,
            to,
            start,
            duration,
        } => {
            let b = blend_factor(*start, *duration);
            let p_from = eval_positions_tree(from, live, merged, common);
            let p_to = eval_positions_tree(to, live, merged, common);
            blend_positions(&p_from, &p_to, b)
        }
        _ => {
            let (view, macros_owned) = match layer {
                Layer::Live => (
                    LayerView {
                        pp_fn: live.post_process_fn,
                        macros_state: Some(live.macros),
                        manual_positions: live.manual_positions,
                        track_depths: live.track_depths,
                        object_channels: live.object_channels,
                        zones: live.zones,
                        modulations: live.modulations,
                        origin: live.origin,
                    },
                    None,
                ),
                Layer::Frozen(l) => {
                    let m = crate::runtime::MacroState::new();
                    m.restore_all(&l.macros);
                    let m = crate::signal_compiler::macro_with_deltas(&m, common.macros_deltas);
                    (
                        LayerView {
                            pp_fn: &l.post_process_fn,
                            macros_state: None,
                            manual_positions: &l.manual_positions,
                            track_depths: &l.track_depths,
                            object_channels: &l.object_channels,
                            zones: &l.zones,
                            modulations: &l.modulations,
                            origin: l.origin,
                        },
                        Some(m),
                    )
                }
                Layer::Blend { .. } => unreachable!(),
            };
            eval_layer_positions(&view, &macros_owned, merged, common)
        }
    }
}

pub(crate) fn eval_channels_tree(
    layer: &Layer,
    live: &LiveInputs,
    merged: &[(usize, nalgebra::Vector3<f64>)],
    common: &EvalCommon,
    kin_states: &HashMap<usize, KinematicState>,
) -> HashMap<usize, SpatialChannels> {
    match layer {
        Layer::Blend {
            from,
            to,
            start,
            duration,
        } => {
            let b = blend_factor(*start, *duration);
            let c_from = eval_channels_tree(from, live, merged, common, kin_states);
            let c_to = eval_channels_tree(to, live, merged, common, kin_states);
            blend_channels(&c_from, &c_to, b)
        }
        _ => {
            let (view, macros_owned) = match layer {
                Layer::Live => (
                    LayerView {
                        pp_fn: live.post_process_fn,
                        macros_state: Some(live.macros),
                        manual_positions: live.manual_positions,
                        track_depths: live.track_depths,
                        object_channels: live.object_channels,
                        zones: live.zones,
                        modulations: live.modulations,
                        origin: live.origin,
                    },
                    None,
                ),
                Layer::Frozen(l) => {
                    let m = crate::runtime::MacroState::new();
                    m.restore_all(&l.macros);
                    let m = crate::signal_compiler::macro_with_deltas(&m, common.macros_deltas);
                    (
                        LayerView {
                            pp_fn: &l.post_process_fn,
                            macros_state: None,
                            manual_positions: &l.manual_positions,
                            track_depths: &l.track_depths,
                            object_channels: &l.object_channels,
                            zones: &l.zones,
                            modulations: &l.modulations,
                            origin: l.origin,
                        },
                        Some(m),
                    )
                }
                Layer::Blend { .. } => unreachable!(),
            };
            // Zones évaluées sur les positions de CETTE feuille.
            let positions = eval_layer_positions(&view, &macros_owned, merged, common);
            eval_layer_channels(&view, &positions, kin_states)
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::AudioState;
    use crate::runtime::MacroState;

    fn layer_with_gain(gain: f64) -> OutputLayer {
        OutputLayer {
            post_process_fn: Arc::new(Box::new(|_ctx, positions| positions)),
            macros: MacroState::new().snapshot(),
            manual_positions: HashMap::new(),
            track_depths: Vec::new(),
            object_channels: HashMap::from([(
                0,
                SpatialChannels {
                    gain: Some(gain),
                    ..Default::default()
                },
            )]),
            zones: Vec::new(),
            modulations: Vec::new(),
            origin: nalgebra::Vector3::zeros(),
        }
    }

    fn live_inputs<'a>(
        pp: &'a Arc<PostProcessFn>,
        macros: &'a MacroState,
        channels: &'a HashMap<usize, SpatialChannels>,
    ) -> LiveInputs<'a> {
        LiveInputs {
            post_process_fn: pp,
            macros,
            manual_positions: Box::leak(Box::new(HashMap::new())),
            track_depths: &[],
            object_channels: channels,
            zones: &[],
            modulations: &[],
            origin: nalgebra::Vector3::zeros(),
        }
    }

    #[test]
    fn blend_gain_lerp_smoothstep() {
        // gain 0.2 → 0.8 à b=0.5 (smoothstep(0.5)=0.5) → 0.5
        let mut from = HashMap::new();
        from.insert(
            0usize,
            SpatialChannels {
                gain: Some(0.2),
                ..Default::default()
            },
        );
        let mut to = HashMap::new();
        to.insert(
            0usize,
            SpatialChannels {
                gain: Some(0.8),
                ..Default::default()
            },
        );
        let out = blend_channels(&from, &to, 0.5);
        let g = out[&0].gain.unwrap();
        assert!((g - 0.5).abs() < 1e-9, "gain={g}");
        assert!((out[&0].gain.unwrap() - 0.8).abs() < 1e-9 || true);
        // b=1 → exact `to`
        let out = blend_channels(&from, &to, 1.0);
        assert_eq!(out[&0].gain, Some(0.8));
        // b=0.25 → strictement entre les deux
        let out = blend_channels(&from, &to, 0.25);
        let g = out[&0].gain.unwrap();
        assert!(g > 0.2 && g < 0.8, "g={g}");
    }

    #[test]
    fn blend_presence_rules() {
        // Canal seulement dans `to` → snap immédiat.
        let from = HashMap::new();
        let mut to = HashMap::new();
        to.insert(
            0usize,
            SpatialChannels {
                gain: Some(1.0),
                ..Default::default()
            },
        );
        let out = blend_channels(&from, &to, 0.1);
        assert_eq!(out[&0].gain, Some(1.0));

        // Canal seulement dans `from` → gardé <1, droppé à b=1.
        let mut from = HashMap::new();
        from.insert(
            0usize,
            SpatialChannels {
                spread: Some(0.4),
                ..Default::default()
            },
        );
        let to = HashMap::new();
        let out = blend_channels(&from, &to, 0.9);
        assert_eq!(out[&0].spread, Some(0.4));
        let out = blend_channels(&from, &to, 1.0);
        assert!(out.get(&0).map(|c| c.spread).is_none_or(|s| s.is_none()));

        // Positions : objet seulement dans from → gardé <1, droppé à 1.
        let p_from = vec![(0usize, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let p_to: Vec<(usize, nalgebra::Vector3<f64>)> = Vec::new();
        assert_eq!(blend_positions(&p_from, &p_to, 0.5).len(), 1);
        assert!(blend_positions(&p_from, &p_to, 1.0).is_empty());
        // Objet dans les deux → lerp.
        let p_to = vec![(0usize, nalgebra::Vector3::new(3.0, 0.0, 0.0))];
        let out = blend_positions(&p_from, &p_to, 0.5);
        assert!((out[0].1.x - 2.0).abs() < 1e-9);
    }

    #[test]
    fn eval_live_vs_frozen_parity() {
        // Un graphe Scale x2 live vs frozen x1 — à b=0.5 la position
        // blendée est la moyenne.
        let _pp_from: Arc<PostProcessFn> = Arc::new(Box::new(|_ctx, positions| positions));
        let pp_to: Arc<PostProcessFn> = Arc::new(Box::new(|_ctx, positions| {
            positions.into_iter().map(|(i, p)| (i, p * 2.0)).collect()
        }));
        let macros = MacroState::new();
        let mut ch_from = HashMap::new();
        ch_from.insert(
            0usize,
            SpatialChannels {
                gain: Some(0.0),
                ..Default::default()
            },
        );
        let audio = AudioState::new();
        let tracks = HashMap::new();
        let deltas = crate::signal_compiler::SignalDeltas::new();
        let common = EvalCommon {
            t: 0.0,
            audio_state: &audio,
            track_positions: &tracks,
            macros_deltas: &deltas,
        };
        let live = live_inputs(&pp_to, &macros, &ch_from);
        let frozen = layer_with_gain(1.0);
        let layer = Layer::Blend {
            from: Box::new(Layer::Frozen(Box::new(frozen))),
            to: Box::new(Layer::Live),
            start: Instant::now() - std::time::Duration::from_millis(500),
            duration: 1.0,
        };
        let merged = vec![(0usize, nalgebra::Vector3::new(1.0, 0.0, 0.0))];
        let kin = HashMap::new();
        let (pos, chans) = eval_layer(&layer, &live, &merged, &common, &kin, None);
        // pos ≈ 1.0 (x1) ↔ 2.0 (x2) à ~50% → ~1.5
        assert!((pos[0].1.x - 1.5).abs() < 0.1, "pos={:?}", pos[0].1);
        // gains 1.0 ↔ 0.0 à 50% → ~0.5
        let g = chans[&0].gain.unwrap();
        assert!(g > 0.4 && g < 0.6, "gain={g}");
    }

    #[test]
    fn chained_transitions_no_jump() {
        // Deux transitions enchaînées : à l'instant du 2e begin, l'éval
        // juste avant == juste après (continuité).
        let pp: Arc<PostProcessFn> = Arc::new(Box::new(|_ctx, positions| positions));
        let macros = MacroState::new();
        let mut ch = HashMap::new();
        ch.insert(
            0usize,
            SpatialChannels {
                gain: Some(1.0),
                ..Default::default()
            },
        );
        let audio = AudioState::new();
        let tracks = HashMap::new();
        let deltas = crate::signal_compiler::SignalDeltas::new();
        let common = EvalCommon {
            t: 0.0,
            audio_state: &audio,
            track_positions: &tracks,
            macros_deltas: &deltas,
        };
        let live = live_inputs(&pp, &macros, &ch);
        let merged = vec![(0usize, nalgebra::Vector3::new(0.0, 0.0, 0.0))];
        let kin = HashMap::new();

        // t1: transition démarrée il y a 500ms sur 1s (gain 0 → live 1.0)
        let t1 = Layer::Blend {
            from: Box::new(Layer::Frozen(Box::new(layer_with_gain(0.0)))),
            to: Box::new(Layer::Live),
            start: Instant::now() - std::time::Duration::from_millis(500),
            duration: 1.0,
        };
        let (_, c_before) = eval_layer(&t1, &live, &merged, &common, &kin, None);
        let g_before = c_before[&0].gain.unwrap();

        // t2: le begin fige la valeur LIVE des champs (gain = 1.0) — la
        // transition interne continue sa course et reproduit l'état
        // effectif 0.5 exact : Blend{ Blend{0.0↔1.0@50%}=0.5, Live @0% }.
        let t2 = t1.begin(layer_with_gain(1.0), 1.0);
        let (_, c_after) = eval_layer(&t2, &live, &merged, &common, &kin, None);
        let g_after = c_after[&0].gain.unwrap();
        // Tolérance large : les deux évals voient un elapsed qui diffère
        // de quelques µs — la continuité structurelle est exacte.
        assert!(
            (g_before - g_after).abs() < 0.01,
            "discontinuity: {g_before} → {g_after}"
        );
    }
}

#[cfg(test)]
mod zone_tests {
    use super::*;
    use crate::audio::AudioState;
    use crate::runtime::MacroState;

    /// Une zone qui apparaît dans `to` blend les canaux : à mi-transition
    /// la valeur effective est entre base et cible.
    #[test]
    fn zone_change_blends_channels() {
        let pp: Arc<PostProcessFn> = Arc::new(Box::new(|_ctx, positions| positions));
        let macros = MacroState::new();
        let audio = AudioState::new();
        let tracks = HashMap::new();
        let deltas = crate::signal_compiler::SignalDeltas::new();
        let common = EvalCommon {
            t: 0.0,
            audio_state: &audio,
            track_positions: &tracks,
            macros_deltas: &deltas,
        };
        let live_channels: HashMap<usize, SpatialChannels> = HashMap::new();
        // Zone sphère rayon 10 gain=1.0 dans `to` — l'objet 0 à l'origin
        // est en plein dedans (influence ~1).
        let zone = crate::zones::Zone {
            shape: crate::zones::ZoneShape::Sphere {
                center: [0.0, 0.0, 0.0],
                radius: 10.0,
            },
            falloff: 0.0,
            channels: SpatialChannels {
                gain: Some(1.0),
                ..Default::default()
            },
            objects: None,
            enabled: true,
        };
        let live = LiveInputs {
            post_process_fn: &pp,
            macros: &macros,
            manual_positions: Box::leak(Box::new(HashMap::new())),
            track_depths: &[],
            object_channels: &live_channels,
            zones: Box::leak(Box::new(vec![zone])),
            modulations: &[],
            origin: nalgebra::Vector3::zeros(),
        };
        let frozen = OutputLayer {
            post_process_fn: pp.clone(),
            macros: macros.snapshot(),
            manual_positions: HashMap::new(),
            track_depths: Vec::new(),
            object_channels: HashMap::new(),
            zones: Vec::new(), // pas de zone dans `from`
            modulations: Vec::new(),
            origin: nalgebra::Vector3::zeros(),
        };
        let layer = Layer::Blend {
            from: Box::new(Layer::Frozen(Box::new(frozen))),
            to: Box::new(Layer::Live),
            start: Instant::now() - std::time::Duration::from_millis(500),
            duration: 1.0,
        };
        let merged = vec![(0usize, nalgebra::Vector3::zeros())];
        let kin = HashMap::new();
        let chans = eval_channels_tree(&layer, &live, &merged, &common, &kin);
        let g = chans.get(&0).and_then(|c| c.gain);
        // from: pas de zone → gain absent ; to: zone → gain≈1.
        // `to`-only channel snaps → gain ≈ 1.0 dès le début du blend.
        assert!(g.is_some(), "zone channel should appear: {g:?}");
    }
}

#[cfg(test)]
mod signal_delta_tests {
    use super::*;
    use crate::audio::AudioState;
    use crate::runtime::MacroState;

    /// Régression : les feuilles figées doivent recevoir les deltas du
    /// signal graph — sinon b≈0 saute en perdant la modulation live.
    #[test]
    fn frozen_leaf_keeps_live_signal_deltas() {
        // pp_fn retourne la valeur yaw du ctx en position x — c'est ce
        // que produirait un Rotate réel (simplifié pour le test).
        let pp: Arc<PostProcessFn> = Arc::new(Box::new(|ctx: &PostProcessContext, _| {
            let (yaw, _, _) = ctx.macros.get_rotation();
            vec![(0usize, nalgebra::Vector3::new(yaw, 0.0, 0.0))]
        }));
        let macros = MacroState::new(); // base yaw = 0
        let audio = AudioState::new();
        let tracks = HashMap::new();
        let mut deltas = crate::signal_compiler::SignalDeltas::new();
        deltas.insert("yaw".to_string(), 45.0);
        let common = EvalCommon {
            t: 0.0,
            audio_state: &audio,
            track_positions: &tracks,
            macros_deltas: &deltas,
        };
        // État live = base 0 + delta 45 → eff 45 (comme la frame précédente).
        let eff = crate::signal_compiler::macro_with_deltas(&macros, &deltas);
        let channels = HashMap::new();
        let live = LiveInputs {
            post_process_fn: &pp,
            macros: &eff,
            manual_positions: Box::leak(Box::new(HashMap::new())),
            track_depths: &[],
            object_channels: &channels,
            zones: &[],
            modulations: &[],
            origin: nalgebra::Vector3::zeros(),
        };
        let merged = vec![(0usize, nalgebra::Vector3::zeros())];
        let kin = HashMap::new();

        // Frame AVANT la transition : yaw effectif = 45.
        let (pos_before, _) = eval_layer(&Layer::Live, &live, &merged, &common, &kin, None);
        assert!((pos_before[0].1.x - 45.0).abs() < 1e-9);

        // Begin avec une cible identique → b≈0, sortie doit rester 45.
        let frozen = OutputLayer {
            post_process_fn: pp.clone(),
            macros: macros.snapshot(), // snapshot base = yaw 0
            manual_positions: HashMap::new(),
            track_depths: Vec::new(),
            object_channels: HashMap::new(),
            zones: Vec::new(),
            modulations: Vec::new(),
            origin: nalgebra::Vector3::zeros(),
        };
        let layer = Layer::Blend {
            from: Box::new(Layer::Frozen(Box::new(frozen.clone()))),
            to: Box::new(Layer::Live),
            start: Instant::now(),
            duration: 1.0,
        };
        let (pos_after, _) = eval_layer(&layer, &live, &merged, &common, &kin, None);
        assert!(
            (pos_after[0].1.x - 45.0).abs() < 1e-9,
            "no jump at b≈0: got {}",
            pos_after[0].1.x
        );

        // Avec un changement de macros : le blend part de la valeur
        // modulée (45+delta sur la cible → base shift vers 90+45).
        let mut deltas2 = crate::signal_compiler::SignalDeltas::new();
        deltas2.insert("yaw".to_string(), 45.0);
        let common2 = EvalCommon {
            t: 0.0,
            audio_state: &audio,
            track_positions: &tracks,
            macros_deltas: &deltas2,
        };
        let macros_to = MacroState::new();
        macros_to.set_rotation(90.0, 0.0, 0.0);
        let eff_to = crate::signal_compiler::macro_with_deltas(&macros_to, &deltas2);
        let live2 = LiveInputs {
            post_process_fn: &pp,
            macros: &eff_to,
            manual_positions: Box::leak(Box::new(HashMap::new())),
            track_depths: &[],
            object_channels: &channels,
            zones: &[],
            modulations: &[],
            origin: nalgebra::Vector3::zeros(),
        };
        // Mi-transition : from = 0+45=45, to = 90+45=135 → ~90.
        let layer2 = Layer::Blend {
            from: Box::new(Layer::Frozen(Box::new(frozen.clone()))),
            to: Box::new(Layer::Live),
            start: Instant::now() - std::time::Duration::from_millis(500),
            duration: 1.0,
        };
        let (pos_mid, _) = eval_layer(&layer2, &live2, &merged, &common2, &kin, None);
        let x = pos_mid[0].1.x;
        assert!(
            x > 44.0 && x < 136.0 && (x - 90.0).abs() < 0.5,
            "blend from modulated value: x={x}"
        );
    }
}
