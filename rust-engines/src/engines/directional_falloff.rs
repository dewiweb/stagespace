use crate::engines::{Engine, EngineParams};
use crate::falloffs::{DirectionalFalloff, Falloff, FalloffContext, FalloffCurve};
use nalgebra::Vector3;

/// Moteur DirectionalFalloff — applique un falloff directionnel sur une trajectoire
/// Les objets du côté positif de la direction sont animés, ceux du côté négatif sont immobiles
pub struct DirectionalFalloffEngine;

impl Engine for DirectionalFalloffEngine {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let direction = params
            .extra
            .get("direction")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                if arr.len() >= 3 {
                    Some([
                        arr[0].as_f64().unwrap_or(0.0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(1.0),
                    ])
                } else {
                    None
                }
            })
            .unwrap_or([0.0, 1.0, 0.0]);
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

        let curve = match curve_str {
            "EaseIn" => FalloffCurve::EaseIn,
            "EaseOut" => FalloffCurve::EaseOut,
            "EaseInOut" => FalloffCurve::EaseInOut,
            _ => FalloffCurve::Linear,
        };

        let falloff = DirectionalFalloff {
            direction,
            max_distance,
            curve,
        };

        let context = FalloffContext {
            duration: params.duration,
            n_objects: params.n_objects,
        };

        // Position de base : mouvement circulaire
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;
        let base_pos = match plane {
            "xy" => Vector3::new(base_radius * angle.cos(), base_radius * angle.sin(), 0.0),
            "xz" => Vector3::new(base_radius * angle.cos(), 0.0, base_radius * angle.sin()),
            "yz" => Vector3::new(0.0, base_radius * angle.cos(), base_radius * angle.sin()),
            _ => Vector3::new(base_radius * angle.cos(), 0.0, base_radius * angle.sin()),
        };

        // L'influence dépend de la position de l'objet dans la scène
        // Utiliser l'index d'objet pour décaler la position de base
        let obj_offset = Vector3::new((object_index as f64) * 0.3, 0.0, 0.0);
        let influence = falloff.influence(t, base_pos + obj_offset, &context);

        // Moduler le rayon par l'influence
        base_pos * influence
    }

    fn name(&self) -> &str {
        "directional_falloff"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_directional_falloff_default_params() {
        let engine = DirectionalFalloffEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({}),
        };
        let pos = engine.position(1.0, 0, &params);
        assert!(pos.x.is_finite());
        assert!(pos.y.is_finite());
        assert!(pos.z.is_finite());
    }

    #[test]
    fn test_directional_falloff_position() {
        let engine = DirectionalFalloffEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({
                "direction": [0.0, 1.0, 0.0],
                "max_distance": 2.0,
                "radius": 1.5,
            }),
        };
        let pos = engine.position(2.0, 0, &params);
        assert!(pos.x.is_finite());
        assert!(pos.y.is_finite());
        assert!(pos.z.is_finite());
    }
}
