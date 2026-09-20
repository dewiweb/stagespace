//! Converge — les objets se rapprochent du centre (rayon start→end) dans le
//! plan xy, avec easing paramétrable. La progression est clampée à [0,1] :
//! au-delà de `duration` la position finale est tenue.

use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct Converge;

impl Engine for Converge {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let start_radius = params
            .extra
            .get("start_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.9);
        let end_radius = params
            .extra
            .get("end_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let easing = params
            .extra
            .get("easing")
            .and_then(|v| v.as_str())
            .unwrap_or("linear");

        // t peut dépasser duration (offsets de phase, PingPong) — sans clamp,
        // les easings extrapolent et le rayon peut devenir négatif. On tient
        // donc la valeur finale au-delà de duration.
        let tn = (t / params.duration.max(1e-9)).clamp(0.0, 1.0);
        let eased = match easing {
            "ease_in" => tn * tn,
            "ease_out" => 1.0 - (1.0 - tn) * (1.0 - tn),
            "smooth" => 3.0 * tn * tn - 2.0 * tn * tn * tn,
            _ => tn,
        };

        let r = start_radius + (end_radius - start_radius) * eased;
        let base_angle =
            2.0 * std::f64::consts::PI * object_index as f64 / params.n_objects.max(1) as f64;

        Vector3::new(r * base_angle.cos(), r * base_angle.sin(), 0.0)
    }

    fn name(&self) -> &str {
        "converge"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn converge_beyond_duration_holds_end_radius() {
        // Régression : tn non clampé → easing "smooth" extrapolait un rayon
        // négatif pour t > duration.
        let e = Converge;
        let p = params(json!({"start_radius": 0.9, "end_radius": 0.0,
                              "easing": "smooth"}));
        let at_end = e.position(4.0, 0, &p);
        let beyond = e.position(8.0, 0, &p);
        assert_eq!(at_end, beyond, "t > duration doit tenir la fin");
        let r = (beyond.x * beyond.x + beyond.y * beyond.y).sqrt();
        assert!(r.abs() < 1e-9, "r={r} devrait être end_radius=0");
    }

    #[test]
    fn converge_negative_t_holds_start() {
        let e = Converge;
        let p = params(json!({"start_radius": 0.9, "end_radius": 0.0}));
        assert_eq!(e.position(-1.0, 0, &p), e.position(0.0, 0, &p));
    }
}
