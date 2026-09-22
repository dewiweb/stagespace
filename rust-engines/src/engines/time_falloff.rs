use crate::engines::{Engine, EngineParams};
use crate::falloffs::{Falloff, FalloffContext, FalloffCurve, TimeFalloff};
use nalgebra::Vector3;

/// Moteur TimeFalloff - applique un falloff temporel sur une trajectoire
pub struct TimeFalloffEngine;

impl Engine for TimeFalloffEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let start_time = params
            .extra
            .get("start_time")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let end_time = params
            .extra
            .get("end_time")
            .and_then(|v| v.as_f64())
            .unwrap_or(params.duration);
        let curve_str = params
            .extra
            .get("curve")
            .and_then(|v| v.as_str())
            .unwrap_or("Linear");
        let base_radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let plane = params
            .extra
            .get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");

        // Le schema UI envoie snake_case ("ease_in_out"), les valeurs
        // legacy étaient capitalisées ("EaseInOut") — on accepte les deux.
        let curve = match curve_str.to_lowercase().replace('_', "").as_str() {
            "easein" => FalloffCurve::EaseIn,
            "easeout" => FalloffCurve::EaseOut,
            "easeinout" => FalloffCurve::EaseInOut,
            _ => FalloffCurve::Linear,
        };

        let falloff = TimeFalloff {
            start_time,
            end_time,
            curve,
        };

        let context = FalloffContext {
            duration: params.duration,
            n_objects: params.n_objects,
        };

        let influence = falloff.influence(t, Vector3::zeros(), &context);

        // Mouvement circulaire modulé par le falloff
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;
        let modulated_radius = base_radius * influence;

        match plane {
            "xy" => Vector3::new(
                modulated_radius * angle.cos(),
                modulated_radius * angle.sin(),
                0.0,
            ),
            "xz" => Vector3::new(
                modulated_radius * angle.cos(),
                0.0,
                modulated_radius * angle.sin(),
            ),
            "yz" => Vector3::new(
                0.0,
                modulated_radius * angle.cos(),
                modulated_radius * angle.sin(),
            ),
            _ => Vector3::new(
                modulated_radius * angle.cos(),
                0.0,
                modulated_radius * angle.sin(),
            ),
        }
    }

    fn name(&self) -> &str {
        "time_falloff"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_time_falloff_position() {
        let engine = TimeFalloffEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra: json!({ "start_time": 1.0, "end_time": 3.0, "radius": 1.0, "plane": "xz" }),
        };

        // Avant le start_time (influence = 0)
        let pos = engine.position(0.5, 0, &params);
        assert_eq!(pos.x, 0.0);

        // Pendant le falloff (influence = 0.5 au milieu)
        let pos = engine.position(2.0, 0, &params);
        assert!((pos.x - (-0.5)).abs() < 0.1); // angle = PI, cos(PI) = -1, influence = 0.5
    }
}
