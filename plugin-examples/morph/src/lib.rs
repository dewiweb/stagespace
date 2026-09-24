//! Plugin exemple ABI v2 (kind "composite") : morph — interpolation
//! linéaire entre deux trajectoires upstream, `result = a·(1−w) + b·w`.
//!
//! Params (déclarés dans manifest.json) :
//! - `w` : poids de l'entrée B (0 = A pur, 1 = B pur), défaut 0.5
//!
//! `a`/`b` = positions upstream des ports `input_a`/`input_b`, écrites par
//! l'host dans le buffer `plugin_inputs_ptr` avant chaque appel.

use stagespace_plugin_sdk::{get_f64, stagespace_plugin_composite};

fn position(
    _t: f64,
    _i: usize,
    _n: usize,
    _d: f64,
    params: &serde_json::Value,
    a: (f64, f64, f64),
    b: (f64, f64, f64),
) -> (f64, f64, f64) {
    let w = get_f64(params, "w", 0.5).clamp(0.0, 1.0);
    let inv = 1.0 - w;
    (
        a.0 * inv + b.0 * w,
        a.1 * inv + b.1 * w,
        a.2 * inv + b.2 * w,
    )
}

stagespace_plugin_composite!(position);
