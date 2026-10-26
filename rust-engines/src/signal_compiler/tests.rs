//! Tests du compiler signal — domaine scalaire → deltas de macros.

use super::*;
use crate::audio::{AmplitudeData, BPMData, SpectrumData};
use crate::graph::{Edge, Node};

fn audio_with(rms: f64, bass: f64) -> AudioState {
    AudioState {
        bpm: Some(BPMData {
            bpm: 120.0,
            confidence: 0.9,
            last_beat_time: 0.0,
        }),
        amplitude: Some(AmplitudeData {
            rms,
            bass,
            mid: rms * 0.5,
            high: rms * 0.25,
        }),
        spectrum: Some(SpectrumData {
            spectrum: vec![0.1, 0.2, 0.3, 0.4],
            fft_size: 4,
        }),
    }
}

fn ctx<'a>(t: f64, audio: &'a AudioState) -> SignalCtx<'a> {
    static EMPTY: std::sync::LazyLock<HashMap<String, Vec<f64>>> =
        std::sync::LazyLock::new(HashMap::new);
    SignalCtx {
        t,
        dt: 1.0 / 60.0,
        audio_state: audio,
        osc_values: &EMPTY,
    }
}

fn node(t: NodeType, params: serde_json::Value) -> Node {
    Node::with_params(t, params)
}

fn edge(from: &Node, to: &Node, to_port: &str) -> Edge {
    Edge {
        from: from.id,
        to: to.id,
        from_port: "out".to_string(),
        to_port: to_port.to_string(),
    }
}

// ── Validation ──

#[test]
fn rejects_non_signal_nodes() {
    // Un node trajectoire dans un graph signal → ContextIncompatible.
    let mut g = Graph::new();
    g.add_node(node(
        NodeType::Circular,
        serde_json::json!({"n_objects": 4}),
    ));
    g.add_node(node(
        NodeType::SignalOut,
        serde_json::json!({"target": "yaw"}),
    ));
    assert!(compile_signal_graph(&g).is_err());
}

#[test]
fn requires_signal_out() {
    let mut g = Graph::new();
    g.add_node(node(NodeType::SignalLfo, serde_json::json!({})));
    assert!(compile_signal_graph(&g).is_err());
}

#[test]
fn lfo_to_out_produces_oscillating_delta() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let lfo = node(
        NodeType::SignalLfo,
        serde_json::json!({"waveform": "sine", "frequency": 1.0, "amplitude": 45.0}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "yaw"}));
    g.add_node(lfo.clone());
    g.add_node(out.clone());
    g.add_edge(edge(&lfo, &out, "signal"));

    let mut f = compile_signal_graph(&g).expect("compiles");
    let mut seen_pos = false;
    let mut seen_neg = false;
    // 1 Hz → échantillonner un quart de période à la fois
    for i in 0..16 {
        let c = ctx(i as f64 / 16.0, &audio);
        let d = f(&c);
        let v = d.get("yaw").copied().unwrap_or(0.0);
        if v > 10.0 {
            seen_pos = true;
        }
        if v < -10.0 {
            seen_neg = true;
        }
    }
    assert!(seen_pos && seen_neg, "LFO doit osciller ±45°");
}

#[test]
fn const_source_and_amount() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let c = node(NodeType::SignalConst, serde_json::json!({"value": 2.0}));
    let out = node(
        NodeType::SignalOut,
        serde_json::json!({"target": "scale", "amount": 0.25}),
    );
    g.add_node(c.clone());
    g.add_node(out.clone());
    g.add_edge(edge(&c, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c0 = ctx(0.0, &audio);
    let d = f(&c0);
    assert!((d["scale"] - 0.5).abs() < 1e-9, "2.0 * 0.25 = 0.5");
}

#[test]
fn math_chain_composition() {
    // LFO(±1) * 0.5 + audio_rms(0.8) → yaw
    let audio = audio_with(0.8, 0.0);
    let mut g = Graph::new();
    let lfo = node(
        NodeType::SignalLfo,
        serde_json::json!({"frequency": 1.0, "amplitude": 1.0}),
    );
    let half = node(
        NodeType::SignalMath,
        serde_json::json!({"op": "mul", "b": 0.5}),
    );
    let a_src = node(NodeType::SignalAudio, serde_json::json!({"band": "rms"}));
    let sum = node(NodeType::SignalMath, serde_json::json!({"op": "add"}));
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "yaw"}));
    for n in [&lfo, &half, &a_src, &sum, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&lfo, &half, "a"));
    g.add_edge(edge(&half, &sum, "a"));
    g.add_edge(edge(&a_src, &sum, "b"));
    g.add_edge(edge(&sum, &out, "signal"));

    let mut f = compile_signal_graph(&g).expect("compiles");
    let c = ctx(0.25, &audio); // sin(π/2) = 1 → 0.5 + 0.8 = 1.3
    let d = f(&c);
    assert!((d["yaw"] - 1.3).abs() < 1e-9, "got {}", d["yaw"]);
}

#[test]
fn map_and_clamp() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let c = node(NodeType::SignalConst, serde_json::json!({"value": 0.5}));
    let map = node(
        NodeType::SignalMap,
        serde_json::json!({"in_min": 0.0, "in_max": 1.0, "out_min": -90.0, "out_max": 90.0}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "pitch"}));
    for n in [&c, &map, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&c, &map, "signal"));
    g.add_edge(edge(&map, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c0 = ctx(0.0, &audio);
    assert!((f(&c0)["pitch"]).abs() < 1e-9, "0.5 → 0 en [-90,90]");
}

#[test]
fn envelope_follower_asymmetric() {
    // Source : const 0 → passe à 1 à t>0 — l'attack rapproche vite, la
    // release redescend lentement.
    let mut g = Graph::new();
    let src = node(NodeType::SignalAudio, serde_json::json!({"band": "rms"}));
    let env = node(
        NodeType::SignalEnvelope,
        // attack/release = facteurs de rétention par frame (convention
        // audio mods) : petit = réaction rapide, grand = lent.
        serde_json::json!({"attack": 0.1, "release": 0.95}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    for n in [&src, &env, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&src, &env, "signal"));
    g.add_edge(edge(&env, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");

    // rms = 1.0 → converge vite vers 1
    let loud = audio_with(1.0, 0.0);
    let mut last = 0.0;
    for _ in 0..10 {
        let c = ctx(0.0, &loud);
        last = f(&c)["scale"];
    }
    assert!(last > 0.9, "attack doit approcher 1, got {last}");

    // rms = 0 → release lente : après quelques frames, encore > 0.5
    let quiet = audio_with(0.0, 0.0);
    let c = ctx(0.0, &quiet);
    let v = f(&c)["scale"];
    assert!(v > 0.5, "release lente, got {v}");
}

#[test]
fn slew_limits_step() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    // SignalTime → rampe t*rate ; slew 10 u/s → step max = 10*dt
    let t_src = node(NodeType::SignalTime, serde_json::json!({"rate": 100.0}));
    let slew = node(
        NodeType::SignalSlew,
        serde_json::json!({"rise_rate": 10.0, "fall_rate": 10.0}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    for n in [&t_src, &slew, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&t_src, &slew, "signal"));
    g.add_edge(edge(&slew, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");

    let c = ctx(1.0, &audio); // input = 100, dt = 1/60 → step = 10/60
    let v = f(&c)["scale"];
    assert!(
        (v - 10.0 / 60.0).abs() < 1e-9,
        "step limité à rate*dt, got {v}"
    );
}

#[test]
fn threshold_hysteresis() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let c = node(NodeType::SignalConst, serde_json::json!({"value": 0.52}));
    let th = node(
        NodeType::SignalThreshold,
        serde_json::json!({"threshold": 0.5, "hysteresis": 0.1}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    for n in [&c, &th, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&c, &th, "signal"));
    g.add_edge(edge(&th, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c0 = ctx(0.0, &audio);
    assert_eq!(f(&c0)["scale"], 1.0, "0.52 > 0.5 → 1");
    // l'état persiste tant que > 0.4 — signal identique → toujours 1
    let c1 = ctx(0.016, &audio);
    assert_eq!(f(&c1)["scale"], 1.0);
}

#[test]
fn osc_source_reads_values() {
    let audio = AudioState::default();
    let mut osc = HashMap::new();
    osc.insert("fader1".to_string(), vec![0.75, 0.25]);

    let mut g = Graph::new();
    let src = node(
        NodeType::SignalOsc,
        serde_json::json!({"name": "fader1", "index": 0}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "yaw"}));
    g.add_node(src.clone());
    g.add_node(out.clone());
    g.add_edge(edge(&src, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");

    let c = SignalCtx {
        t: 0.0,
        dt: 1.0 / 60.0,
        audio_state: &audio,
        osc_values: &osc,
    };
    assert!((f(&c)["yaw"] - 0.75).abs() < 1e-9);
}

#[test]
fn random_deterministic() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let r = node(
        NodeType::SignalRandom,
        serde_json::json!({"rate": 0.5, "amplitude": 1.0, "seed": 7.0}),
    );
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    g.add_node(r.clone());
    g.add_node(out.clone());
    g.add_edge(edge(&r, &out, "signal"));

    let mut fa = compile_signal_graph(&g).expect("a");
    let mut fb = compile_signal_graph(&g).expect("b");
    let c = ctx(3.7, &audio);
    assert_eq!(fa(&c)["scale"], fb(&c)["scale"], "même seed → même valeur");
    let c2 = ctx(3.8, &audio);
    assert_ne!(fa(&c)["scale"], fb(&c2)["scale"], "le bruit varie avec t");
}

#[test]
fn multiple_sinks_sum_to_same_target() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    let c1 = node(NodeType::SignalConst, serde_json::json!({"value": 10.0}));
    let c2 = node(NodeType::SignalConst, serde_json::json!({"value": 5.0}));
    let o1 = node(NodeType::SignalOut, serde_json::json!({"target": "yaw"}));
    let o2 = node(NodeType::SignalOut, serde_json::json!({"target": "yaw"}));
    for n in [&c1, &c2, &o1, &o2] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&c1, &o1, "signal"));
    g.add_edge(edge(&c2, &o2, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c = ctx(0.0, &audio);
    assert!((f(&c)["yaw"] - 15.0).abs() < 1e-9, "10 + 5 = 15");
}

#[test]
fn non_finite_signal_dropped() {
    let audio = AudioState::default();
    let mut g = Graph::new();
    // div 1/0 → le node retourne 0 (guard), testons plutôt un pow négatif
    // non-finite n'est pas produit — le guard est dans les ops. Testons
    // directement que le sink ne propage pas un NaN structurel.
    let a = node(NodeType::SignalConst, serde_json::json!({"value": 1.0}));
    let b = node(NodeType::SignalConst, serde_json::json!({"value": 0.0}));
    let d = node(NodeType::SignalMath, serde_json::json!({"op": "div"}));
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    for n in [&a, &b, &d, &out] {
        g.add_node(n.clone());
    }
    g.add_edge(edge(&a, &d, "a"));
    g.add_edge(edge(&b, &d, "b"));
    g.add_edge(edge(&d, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c = ctx(0.0, &audio);
    let deltas = f(&c);
    // div by zero → 0.0 (guard), pas de NaN
    let v = deltas.get("scale").copied().unwrap_or(0.0);
    assert!(v.is_finite());
}

#[test]
fn audio_band_sources() {
    let audio = audio_with(0.6, 0.9);
    let mut g = Graph::new();
    let bass = node(NodeType::SignalAudio, serde_json::json!({"band": "bass"}));
    let out = node(NodeType::SignalOut, serde_json::json!({"target": "scale"}));
    g.add_node(bass.clone());
    g.add_node(out.clone());
    g.add_edge(edge(&bass, &out, "signal"));
    let mut f = compile_signal_graph(&g).expect("compiles");
    let c = ctx(0.0, &audio);
    assert!((f(&c)["scale"] - 0.9).abs() < 1e-9);
}
