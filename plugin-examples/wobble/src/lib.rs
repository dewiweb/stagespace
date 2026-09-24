//! Plugin exemple ABI v2 (kind "modifier") : wobble — ajoute une
//! oscillation circulaire dans le plan xz autour de la position upstream.
//!
//! Params (déclarés dans manifest.json) :
//! - `amp` : rayon de l'oscillation, défaut 0.5
//! - `freq` : fréquence en Hz, défaut 2.0
//!
//! `input` = position upstream de l'objet `i` à l'instant `t`, écrite par
//! l'host dans le buffer `plugin_inputs_ptr` avant chaque appel.

use stagespace_plugin_sdk::{get_f64, stagespace_plugin_modifier};

fn position(
    t: f64,
    i: usize,
    n: usize,
    _d: f64,
    params: &serde_json::Value,
    input: (f64, f64, f64),
) -> (f64, f64, f64) {
    let amp = get_f64(params, "amp", 0.5);
    let freq = get_f64(params, "freq", 2.0);

    // Phase : temps absolu × fréquence + déphasage uniforme par objet
    let phase = 2.0 * std::f64::consts::PI * (t * freq + i as f64 / n.max(1) as f64);
    let (sin, cos) = phase.sin_cos();

    (
        input.0 + amp * cos,
        input.1,
        input.2 + amp * sin,
    )
}

stagespace_plugin_modifier!(position);
