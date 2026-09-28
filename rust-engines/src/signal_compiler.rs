//! Compiler du graph de modulation — domaine SIGNAL (scalaire).
//!
//! À la différence des graphes de trajectoire (`f(t) → Vec<Vector3>`) et du
//! graph global (`positions → positions`), le graph signal évalue chaque
//! frame un DAG de valeurs `f64` et produit des **deltas additifs de macros** :
//!
//! ```text
//! SignalLfo ──┐
//!             ├─ SignalMath(mul) ─ SignalEnvelope ─ SignalOut(yaw)
//! SignalAudio ┘                                     → deltas["yaw"] += v*amount
//! ```
//!
//! La sémantique est strictement ADDITIVE : les deltas se somment à la base
//! (slider, OSC IN, cue) — aucun node n'écrit directement dans MacroState.
//! C'est la même couture que `AnimationState::compute_audio_modulated_params`
//! (`HashMap<String, f64>`) — le signal graph généralise ce mécanisme.
//!
//! Nodes à état (Slew, Envelope, Threshold, smoothing audio) : la `SignalFn`
//! est `FnMut` — l'état vit dans les closures compilées, muté à chaque eval.

use crate::audio::AudioState;
use crate::error::StagespaceError;
use crate::graph::{Graph, Node, NodeId, NodeType};
use crate::validator::{GraphContext, Validator};
use std::collections::HashMap;
use std::f64::consts::PI;

/// Contexte d'évaluation du graph signal — fourni par le runtime à chaque frame.
pub struct SignalCtx<'a> {
    /// Temps réel écoulé (s) — démarrage du worker (per-move) ou du merge (global).
    pub t: f64,
    /// Delta réel entre frames (s) — pour les nodes à état (slew, envelope).
    pub dt: f64,
    /// État audio courant (rms/bass/mid/high/bpm/spectrum).
    pub audio_state: &'a AudioState,
    /// Valeurs OSC reçues (clés de feedback des handlers — `values_handle`).
    pub osc_values: &'a HashMap<String, Vec<f64>>,
}

/// Deltas produits par le graph pour une frame : `macro_name → delta`.
/// Clés = noms de macros (`speed`, `scale`, `shift_x`…`height_offset`) —
/// les mêmes que `MacroTarget`/`audio_param_overrides`.
pub type SignalDeltas = HashMap<String, f64>;

/// Graph signal compilé — `FnMut` : les nodes à mémoire (slew, envelope,
/// smoothing) gardent leur état dans les closures. Évalué une fois par frame.
/// `Send` car évalué sur le thread worker/merge.
pub type SignalFn = Box<dyn FnMut(&SignalCtx) -> SignalDeltas + Send>;

/// Source partagée des valeurs OSC pour `SignalCtx.osc_values` —
/// `Arc<RwLock<OscValueMap>>` : l'Arc interne peut être re-pointé quand le
/// receiver est recréé (rebind port) sans toucher aux consommateurs.
pub type SignalOscSource = std::sync::Arc<std::sync::RwLock<crate::compiler::OscValueMap>>;

/// SignalFn neutre — aucun delta. Valeur par défaut avant le premier
/// `update_signal_graph` (ou après un clear) : le hot-swap remplace la fn,
/// le code d'éval reste inconditionnel.
pub fn empty_signal_fn() -> SignalFn {
    Box::new(|_ctx| HashMap::new())
}

/// Clone un `MacroState` et y applique des deltas additifs — le résultat
/// est le `ctx.macros` effectif lu par le post-process. La base (panel,
/// OSC IN, cue) n'est jamais écrasée : le delta se somme, puis le clone
/// est dropé à la fin de la frame.
///
/// Clés reconnues : `scale`, `shift_x|y|z` (+ alias `offset_x|y|z` de la
/// convention per-move), `yaw`, `pitch`, `roll`, `radius_scale`,
/// `height_offset`. `speed` est ignoré — le merge n'a pas de temps
/// virtuel global (per-move uniquement).
pub fn macro_with_deltas(
    macros: &crate::runtime::MacroState,
    deltas: &SignalDeltas,
) -> crate::runtime::MacroState {
    let eff = macros.clone();
    if deltas.is_empty() {
        return eff;
    }
    let g = |k: &str| {
        deltas
            .get(k)
            .copied()
            .filter(|v| v.is_finite())
            .unwrap_or(0.0)
    };
    eff.set_scale(eff.get_scale() + g("scale"));
    let s = eff.get_shift();
    eff.set_shift(
        s.x + g("shift_x") + g("offset_x"),
        s.y + g("shift_y") + g("offset_y"),
        s.z + g("shift_z") + g("offset_z"),
    );
    let (y, p, r) = eff.get_rotation();
    eff.set_rotation(y + g("yaw"), p + g("pitch"), r + g("roll"));
    eff.set_radius_scale(eff.get_radius_scale() + g("radius_scale"));
    eff.set_height_offset(eff.get_height_offset() + g("height_offset"));
    eff
}

/// Erreur de compilation du graph signal.
#[derive(Debug, Clone)]
pub enum SignalCompileError {
    ValidationFailed(String),
    UnknownNode(String),
}

impl From<SignalCompileError> for StagespaceError {
    fn from(e: SignalCompileError) -> Self {
        match e {
            SignalCompileError::ValidationFailed(m) => StagespaceError::ValidationFailed(m),
            SignalCompileError::UnknownNode(m) => StagespaceError::CompilationFailed(m),
        }
    }
}

/// Un node compilé : ses slots d'entrée (index dans `values`, `None` = port
/// non connecté → fallback param) + la closure d'éval.
type NodeEval = Box<dyn FnMut(&SignalCtx, &[Option<usize>], &[f64]) -> f64 + Send>;

/// Graph compilé — ordre topologique, scratch `values` réutilisé par frame,
/// sinks résolus (index eval du port `signal` du SignalOut).
struct CompiledSignal {
    nodes: Vec<(Vec<Option<usize>>, NodeEval)>,
    values: Vec<f64>,
    /// (index eval de l'upstream du port `signal`, macro target, amount)
    sinks: Vec<(Option<usize>, String, f64)>,
    deltas: SignalDeltas,
}

impl CompiledSignal {
    fn eval(&mut self, ctx: &SignalCtx) -> &SignalDeltas {
        // Évaluation en ordre topologique : tous les inputs d'un node sont
        // déjà écrits dans `values` quand il est évalué (DAG garanti par
        // le validator — pas de cycle).
        for i in 0..self.nodes.len() {
            let (slots, eval) = &mut self.nodes[i];
            self.values[i] = eval(ctx, slots, &self.values);
        }
        self.deltas.clear();
        for (src, target, amount) in &self.sinks {
            // SignalOut : delta = signal * amount — non-finite écarté (un NaN
            // ne doit jamais atteindre une macro → positions figées).
            if let Some(idx) = src {
                let v = self.values[*idx];
                if v.is_finite() {
                    *self.deltas.entry(target.clone()).or_insert(0.0) += v * amount;
                }
            }
        }
        &self.deltas
    }
}

/// Valeur du port `i` : upstream connecté → valeur évaluée, sinon `fallback`.
#[inline]
fn port(slots: &[Option<usize>], values: &[f64], i: usize, fallback: f64) -> f64 {
    slots
        .get(i)
        .copied()
        .flatten()
        .map(|j| values.get(j).copied().unwrap_or(fallback))
        .unwrap_or(fallback)
}

fn get_f64(node: &Node, key: &str, default: f64) -> f64 {
    node.params
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

fn get_str<'a>(node: &'a Node, key: &str, default: &'a str) -> String {
    node.params
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_string()
}

fn get_usize(node: &Node, key: &str, default: usize) -> usize {
    node.params
        .get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(default)
}

/// Compile un graph signal (validation `GraphContext::Signal` incluse).
pub fn compile_signal_graph(graph: &Graph) -> std::result::Result<SignalFn, SignalCompileError> {
    if let Err(errors) = Validator::validate_with_context(graph, GraphContext::Signal) {
        return Err(SignalCompileError::ValidationFailed(
            errors
                .iter()
                .map(|e| format!("{e:?}"))
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }

    // Ordre topologique (Kahn) — le graphe est acyclique (validator).
    let order = topo_order(graph);
    let index_of: HashMap<NodeId, usize> =
        order.iter().enumerate().map(|(i, id)| (*id, i)).collect();

    let mut nodes: Vec<(Vec<Option<usize>>, NodeEval)> = Vec::with_capacity(order.len());
    let mut sinks = Vec::new();

    for &id in &order {
        let node = graph
            .nodes
            .get(&id)
            .ok_or_else(|| SignalCompileError::UnknownNode(format!("{id:?} missing")))?;

        // Slots d'entrée : pour chaque port déclaré du spec, l'edge qui le
        // cible → index eval de l'upstream (None si non connecté).
        let spec_inputs = &crate::node_spec::node_spec(&node.node_type).inputs;
        let slots: Vec<Option<usize>> = spec_inputs
            .iter()
            .map(|port| {
                graph
                    .edges
                    .iter()
                    .find(|e| e.to == id && e.to_port == *port)
                    .and_then(|e| index_of.get(&e.from).copied())
            })
            .collect();

        // Les params fallback sont évalués à la compile — les nodes édités
        // live passent par une recompilation (hot-swap, même modèle que les
        // autres domaines).
        let eval = compile_node(node)?;

        if node.node_type == NodeType::SignalOut {
            let target = get_str(node, "target", "yaw");
            let amount = get_f64(node, "amount", 1.0);
            // `signal` est le seul port → slots[0].
            sinks.push((slots.first().copied().flatten(), target, amount));
        }

        nodes.push((slots, eval));
    }

    let mut compiled = CompiledSignal {
        values: vec![0.0; nodes.len()],
        nodes,
        sinks,
        deltas: HashMap::new(),
    };
    Ok(Box::new(move |ctx: &SignalCtx| compiled.eval(ctx).clone()))
}

/// Ordre topologique par épluchage de Kahn — nœuds dans l'ordre d'évaluation.
/// Sur un cycle résiduel (ne devrait pas arriver post-validation), les nœuds
/// restants sont appendés dans un ordre quelconque : défensif, le DAG reste
/// évaluable sans boucle infinie.
fn topo_order(graph: &Graph) -> Vec<NodeId> {
    let mut indegree: HashMap<NodeId, usize> = HashMap::with_capacity(graph.nodes.len());
    for e in &graph.edges {
        if graph.nodes.contains_key(&e.from) && graph.nodes.contains_key(&e.to) {
            *indegree.entry(e.to).or_insert(0) += 1;
        }
    }
    let mut queue: Vec<NodeId> = graph
        .nodes
        .keys()
        .filter(|id| !indegree.contains_key(id))
        .copied()
        .collect();
    let mut order = Vec::with_capacity(graph.nodes.len());
    while let Some(id) = queue.pop() {
        order.push(id);
        for n in graph.get_outputs(id) {
            if let Some(d) = indegree.get_mut(&n) {
                *d -= 1;
                if *d == 0 {
                    queue.push(n);
                }
            }
        }
    }
    // Nœuds orphelins d'un cycle éventuel — appendif pour ne pas les perdre.
    for id in graph.nodes.keys() {
        if !order.contains(id) {
            order.push(*id);
        }
    }
    order
}

/// Forme d'onde périodique — mêmes formules que `engines::modifiers::lfo`
/// (cohérence du catalogue).
fn waveform_value(waveform: &str, angle: f64) -> f64 {
    match waveform {
        "triangle" => (2.0 / PI) * (angle.sin()).asin(),
        "square" => {
            if angle.sin() >= 0.0 {
                1.0
            } else {
                -1.0
            }
        }
        "sawtooth" => {
            let normalized = (angle / (2.0 * PI)).rem_euclid(1.0);
            2.0 * normalized - 1.0
        }
        "random" => {
            // Variate pseudo-aléatoire périodique déterministe (hachage de la
            // phase) — hold constant par cycle, comme un S&H interne.
            let phase = (angle / (2.0 * PI)).rem_euclid(1.0);
            (((phase * 61.0).sin()) * 43758.5453).fract() * 2.0 - 1.0
        }
        _ => angle.sin(), // "sine" + fallback
    }
}

/// Conversion facteur de lissage [0,1) par-frame → facteur dt-correct.
/// Convention des audio mods : `v = v*s + raw*(1-s)` à 60 FPS (s=0 → brut,
/// s→1 → quasi figé). `k = 1 - s^(dt*60)` reproduit ce taux par frame à
/// n'importe quel dt : s=0 → k=1 (passthrough), s=0.9@60fps → k=0.1.
#[inline]
fn smoothing_k(param: f64, dt: f64) -> f64 {
    let s = param.clamp(0.0, 0.999);
    (1.0 - s.powf(dt * 60.0)).clamp(0.0, 1.0)
}

fn compile_node(node: &Node) -> std::result::Result<NodeEval, SignalCompileError> {
    match &node.node_type {
        NodeType::SignalConst => {
            let value = get_f64(node, "value", 0.0);
            Ok(Box::new(move |_ctx, _slots, _values| value))
        }

        NodeType::SignalTime => {
            let rate = get_f64(node, "rate", 1.0);
            let wrap = get_f64(node, "wrap", 0.0);
            Ok(Box::new(move |ctx, _slots, _values| {
                let t = ctx.t * rate;
                if wrap > 0.0 {
                    t % wrap
                } else {
                    t
                }
            }))
        }

        NodeType::SignalLfo => {
            let waveform = get_str(node, "waveform", "sine");
            let frequency = get_f64(node, "frequency", 0.5);
            let amplitude = get_f64(node, "amplitude", 1.0);
            let center = get_f64(node, "center", 0.0);
            let phase = get_f64(node, "phase", 0.0);
            Ok(Box::new(move |ctx, _slots, _values| {
                let angle = 2.0 * PI * frequency * ctx.t + phase;
                center + amplitude * waveform_value(&waveform, angle)
            }))
        }

        NodeType::SignalAudio => {
            let band = get_str(node, "band", "rms");
            let index = get_usize(node, "index", 0);
            let smoothing = get_f64(node, "smoothing", 0.0);
            // Smoothing interne (stateful) — cohérent avec l'audio mod.
            let mut smoothed = 0.0f64;
            Ok(Box::new(move |ctx, _slots, _values| {
                let raw = match band.as_str() {
                    "bass" => ctx.audio_state.amplitude.as_ref().map(|a| a.bass),
                    "mid" => ctx.audio_state.amplitude.as_ref().map(|a| a.mid),
                    "high" => ctx.audio_state.amplitude.as_ref().map(|a| a.high),
                    "bpm" => ctx.audio_state.bpm.as_ref().map(|b| b.bpm / 120.0),
                    "spectrum" => ctx
                        .audio_state
                        .spectrum
                        .as_ref()
                        .and_then(|s| s.spectrum.get(index).copied()),
                    _ => ctx.audio_state.amplitude.as_ref().map(|a| a.rms),
                }
                .unwrap_or(0.0);
                let k = smoothing_k(smoothing, ctx.dt);
                smoothed = smoothed * (1.0 - k) + raw * k;
                smoothed
            }))
        }

        NodeType::SignalOsc => {
            let name = get_str(node, "name", "");
            let index = get_usize(node, "index", 0);
            Ok(Box::new(move |ctx, _slots, _values| {
                ctx.osc_values
                    .get(&name)
                    .and_then(|v| v.get(index).copied())
                    .unwrap_or(0.0)
            }))
        }

        NodeType::SignalRandom => {
            let rate = get_f64(node, "rate", 0.5);
            let amplitude = get_f64(node, "amplitude", 1.0);
            let seed = get_f64(node, "seed", 1.0);
            // Bruit lisse déterministe — somme de sinusoïdes à rapports
            // irrationnels + phases dérivées du seed (pur f(t), pas d'état).
            let (f1, f2, f3) = (rate, rate * 1.317, rate * 2.731);
            let (p1, p2, p3) = (seed * 12.9898, seed * 78.233, seed * 37.719);
            Ok(Box::new(move |ctx, _slots, _values| {
                let t = ctx.t;
                amplitude
                    * (0.5 * (2.0 * PI * f1 * t + p1).sin()
                        + 0.3 * (2.0 * PI * f2 * t + p2).sin()
                        + 0.2 * (2.0 * PI * f3 * t + p3).sin())
            }))
        }

        NodeType::SignalMath => {
            let op = get_str(node, "op", "add");
            let fa = get_f64(node, "a", 0.0);
            let fb = get_f64(node, "b", 1.0);
            Ok(Box::new(move |_ctx, slots, values| {
                let a = port(slots, values, 0, fa);
                let b = port(slots, values, 1, fb);
                match op.as_str() {
                    "sub" => a - b,
                    "mul" => a * b,
                    "div" => {
                        if b.abs() > 1e-12 {
                            a / b
                        } else {
                            0.0 // div/0 → 0 plutôt qu'inf dans une macro
                        }
                    }
                    "min" => a.min(b),
                    "max" => a.max(b),
                    "pow" => a.powf(b),
                    "abs" => a.abs(),
                    "neg" => -a,
                    "mod" => {
                        if b.abs() > 1e-12 {
                            a.rem_euclid(b.abs())
                        } else {
                            0.0
                        }
                    }
                    _ => a + b, // "add" + fallback
                }
            }))
        }

        NodeType::SignalMap => {
            let in_min = get_f64(node, "in_min", 0.0);
            let in_max = get_f64(node, "in_max", 1.0);
            let out_min = get_f64(node, "out_min", 0.0);
            let out_max = get_f64(node, "out_max", 1.0);
            let clamp = node
                .params
                .get("clamp")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            Ok(Box::new(move |_ctx, slots, values| {
                let v = port(slots, values, 0, 0.0);
                let span = in_max - in_min;
                let out = if span.abs() > 1e-12 {
                    out_min + (v - in_min) * (out_max - out_min) / span
                } else {
                    out_min
                };
                if clamp {
                    out.clamp(out_min.min(out_max), out_min.max(out_max))
                } else {
                    out
                }
            }))
        }

        NodeType::SignalClamp => {
            let lo = get_f64(node, "min", 0.0);
            let hi = get_f64(node, "max", 1.0);
            let (lo, hi) = (lo.min(hi), lo.max(hi)); // bornes inversées tolérées
            Ok(Box::new(move |_ctx, slots, values| {
                port(slots, values, 0, 0.0).clamp(lo, hi)
            }))
        }

        NodeType::SignalMix => {
            let factor_fallback = get_f64(node, "factor", 0.5);
            Ok(Box::new(move |_ctx, slots, values| {
                let a = port(slots, values, 0, 0.0);
                let b = port(slots, values, 1, 0.0);
                let f = port(slots, values, 2, factor_fallback);
                a + (b - a) * f
            }))
        }

        // ── Nodes à état : la closure capture sa mémoire ──
        NodeType::SignalSlew => {
            let rise = get_f64(node, "rise_rate", 0.0);
            let fall = get_f64(node, "fall_rate", 0.0);
            let mut prev = 0.0f64;
            Ok(Box::new(move |ctx, slots, values| {
                let input = port(slots, values, 0, 0.0);
                let delta = input - prev;
                let rate = if delta > 0.0 { rise } else { fall };
                if rate <= 0.0 {
                    prev = input; // illimité → suivi direct
                } else {
                    let max_step = rate * ctx.dt.max(0.0);
                    prev += delta.clamp(-max_step, max_step);
                }
                prev
            }))
        }

        NodeType::SignalEnvelope => {
            let attack = get_f64(node, "attack", 0.6);
            let release = get_f64(node, "release", 0.15);
            let mut state = 0.0f64;
            Ok(Box::new(move |ctx, slots, values| {
                let input = port(slots, values, 0, 0.0);
                // Montée → attack (rapide), descente → release (lent).
                let k = if input > state {
                    smoothing_k(attack, ctx.dt)
                } else {
                    smoothing_k(release, ctx.dt)
                };
                state += (input - state) * k;
                state
            }))
        }

        NodeType::SignalThreshold => {
            let threshold = get_f64(node, "threshold", 0.5);
            let hyst = get_f64(node, "hysteresis", 0.05).abs();
            let mut state = false;
            Ok(Box::new(move |_ctx, slots, values| {
                let v = port(slots, values, 0, 0.0);
                if v > threshold {
                    state = true;
                } else if v < threshold - hyst {
                    state = false;
                }
                if state {
                    1.0
                } else {
                    0.0
                }
            }))
        }

        // Sink — évalué à la fin, sa valeur n'entre pas dans `values` (il n'a
        // pas d'output) ; on retourne quand même le signal traversant.
        NodeType::SignalOut => Ok(Box::new(move |_ctx, slots, values| {
            port(slots, values, 0, 0.0)
        })),

        other => Err(SignalCompileError::UnknownNode(format!(
            "{other:?} is not a signal node"
        ))),
    }
}

#[cfg(test)]
mod tests;
