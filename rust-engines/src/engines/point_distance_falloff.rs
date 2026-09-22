use crate::engines::{Engine, EngineParams};
use crate::falloffs::{Falloff, FalloffContext, FalloffCurve, PointDistanceFalloff};
use nalgebra::Vector3;

/// Moteur PointDistanceFalloff - applique un falloff de distance sur une trajectoire
pub struct PointDistanceFalloffEngine;

impl Engine for PointDistanceFalloffEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let center = params
            .extra
            .get("center")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                if arr.len() >= 3 {
                    Some([
                        arr[0].as_f64().unwrap_or(0.0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(0.0),
                    ])
                } else {
                    None
                }
            })
            .unwrap_or([0.0, 0.0, 0.0]);
        let max_distance = params
            .extra
            .get("max_distance")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
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

        let falloff = PointDistanceFalloff {
            center,
            max_distance,
            curve,
        };

        let context = FalloffContext {
            duration: params.duration,
            n_objects: params.n_objects,
        };

        // Calculer la position de base
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;
        let base_pos = match plane {
            "xy" => Vector3::new(base_radius * angle.cos(), base_radius * angle.sin(), 0.0),
            "xz" => Vector3::new(base_radius * angle.cos(), 0.0, base_radius * angle.sin()),
            "yz" => Vector3::new(0.0, base_radius * angle.cos(), base_radius * angle.sin()),
            _ => Vector3::new(base_radius * angle.cos(), 0.0, base_radius * angle.sin()),
        };

        let influence = falloff.influence(t, base_pos, &context);

        // Moduler la position par l'influence
        base_pos * influence
    }

    fn name(&self) -> &str {
        "point_distance_falloff"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_point_distance_falloff_position() {
        let engine = PointDistanceFalloffEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra: json!({ "center": [0.0, 0.0, 0.0], "max_distance": 1.0, "radius": 1.0, "plane": "xz" }),
        };

        // À t=0, position = (1, 0, 0), distance = 1, influence = 0
        let pos = engine.position(0.0, 0, &params);
        assert_eq!(pos.x, 0.0);

        // À t=1, position = (0, 0, 1), distance = 1, influence = 0
        let pos = engine.position(1.0, 0, &params);
        assert_eq!(pos.z, 0.0);
    }
}
