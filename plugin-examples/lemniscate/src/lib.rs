//! Plugin exemple : lemniscate de Bernoulli — figure-∞ horizontale.
//!
//! Params (déclarés dans manifest.json) :
//! - `scale` : taille de la figure (demi-largeur), défaut 1.0
//! - `aspect` : étirement z (classique √2), défaut 1.4142
//! - `speed` : multiplicateur de vitesse angulaire, défaut 1.0
//!
//! Les objets sont déphasés uniformément le long de la courbe (i/n·2π).

use stagespace_plugin_sdk::{get_f64, stagespace_plugin};

fn position(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64) {
    let scale = get_f64(params, "scale", 1.0);
    let aspect = get_f64(params, "aspect", std::f64::consts::SQRT_2);
    let speed = get_f64(params, "speed", 1.0);

    // Phase : temps normalisé sur la durée + déphasage par objet
    let phase = 2.0 * std::f64::consts::PI * (t / d.max(f64::EPSILON) * speed
        + i as f64 / n.max(1) as f64);

    // Lemniscate de Bernoulli : r = a·cos(θ)/(1+sin²θ)
    let (sin, cos) = phase.sin_cos();
    let denom = 1.0 + sin * sin;
    (
        scale * cos / denom,
        0.0,
        scale * aspect * sin * cos / denom,
    )
}

stagespace_plugin!(position);
