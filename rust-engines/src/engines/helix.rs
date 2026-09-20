//! Helix — spire dans le plan xy, montée sur z. La progression est clampée à
//! [0,1] : au-delà de `duration` l'objet tient le sommet de la spire (sans le
//! clamp, z continuerait de croître linéairement).

use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Helix;

impl Engine for Helix {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        let height = params
            .extra
            .get("height")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.6);
        let turns = params
            .extra
            .get("turns")
            .and_then(|v| v.as_f64())
            .unwrap_or(3.0);
        let speed = params
            .extra
            .get("speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let phase_offset = params
            .extra
            .get("phase_offset")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let phase = if phase_offset {
            2.0 * PI * object_index as f64 / params.n_objects.max(1) as f64
        } else {
            0.0
        };

        // Clamp : t > duration est atteignable (phase offsets, PingPong) et
        // l'extrapolation de z n'a pas de sens pour une spire bornée.
        let tn = (t / params.duration.max(1e-9)).clamp(0.0, 1.0);
        let angle = 2.0 * PI * turns * speed * tn + phase;
        let z = height * (tn - 0.5);

        Vector3::new(radius * angle.cos(), radius * angle.sin(), z)
    }

    fn name(&self) -> &str {
        "helix"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn helix_beyond_duration_holds_top() {
        // Régression : tn non clampé → z dépassait height/2 sans borne.
        let e = Helix;
        let p = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({"height": 1.6, "turns": 3.0}),
        };
        let at_end = e.position(4.0, 0, &p);
        let beyond = e.position(10.0, 0, &p);
        assert_eq!(at_end, beyond, "t > duration doit tenir le sommet");
        assert!(beyond.z <= 1.6 / 2.0 + 1e-9, "z={}", beyond.z);
    }
}
