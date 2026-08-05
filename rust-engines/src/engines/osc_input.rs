use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

/// Moteur OSCInput — utilise une valeur OSC reçue en temps réel pour générer une position
/// La valeur OSC est injectée via extra["osc_value"] (un nombre ou un array de 3 nombres)
/// Si la valeur est un scalaire, elle est utilisée comme angle sur un cercle
/// Si c'est un array de 3, c'est utilisé directement comme position XYZ
pub struct OscInputEngine;

impl Engine for OscInputEngine {
    fn position(&self, _t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let base_radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let scale = params
            .extra
            .get("scale")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let offset_x = params
            .extra
            .get("offset_x")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let offset_y = params
            .extra
            .get("offset_y")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let offset_z = params
            .extra
            .get("offset_z")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // Récupérer la valeur OSC injectée
        if let Some(val) = params.extra.get("osc_value") {
            // Cas 1: array de 3 nombres → position XYZ directe
            if let Some(arr) = val.as_array() {
                if arr.len() >= 3 {
                    let x = arr[0].as_f64().unwrap_or(0.0) * scale + offset_x;
                    let y = arr[1].as_f64().unwrap_or(0.0) * scale + offset_y;
                    let z = arr[2].as_f64().unwrap_or(0.0) * scale + offset_z;
                    return Vector3::new(x, y, z);
                }
            }
            // Cas 2: scalaire → angle sur un cercle
            if let Some(scalar) = val.as_f64() {
                let angle = scalar * std::f64::consts::PI; // normaliser vers radians
                let obj_offset = (object_index as f64)
                    * (2.0 * std::f64::consts::PI / params.n_objects.max(1) as f64);
                let final_angle = angle + obj_offset;
                return Vector3::new(
                    base_radius * final_angle.cos() + offset_x,
                    offset_y,
                    base_radius * final_angle.sin() + offset_z,
                );
            }
        }

        // En l'absence de valeur OSC, position par défaut (cercle statique)
        let angle =
            (object_index as f64) * (2.0 * std::f64::consts::PI / params.n_objects.max(1) as f64);
        Vector3::new(
            base_radius * angle.cos() + offset_x,
            offset_y,
            base_radius * angle.sin() + offset_z,
        )
    }

    fn name(&self) -> &str {
        "osc_input"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_osc_input_default_params() {
        let engine = OscInputEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({}),
        };
        let pos = engine.position(1.0, 0, &params);
        assert!(pos.x.is_finite());
        assert!(pos.z.is_finite());
    }

    #[test]
    fn test_osc_input_scalar_value() {
        let engine = OscInputEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({
                "osc_value": 0.5,
                "radius": 2.0,
            }),
        };
        let pos = engine.position(0.0, 0, &params);
        // angle = 0.5 * PI, x = 2.0 * cos(0.5*PI) ≈ 0, z = 2.0 * sin(0.5*PI) = 2.0
        assert!((pos.x).abs() < 0.01, "x should be ~0, got {}", pos.x);
        assert!(
            (pos.z - 2.0).abs() < 0.01,
            "z should be ~2.0, got {}",
            pos.z
        );
    }

    #[test]
    fn test_osc_input_array_value() {
        let engine = OscInputEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({
                "osc_value": [1.0, 2.0, 3.0],
                "scale": 2.0,
            }),
        };
        let pos = engine.position(0.0, 0, &params);
        assert_eq!(pos.x, 2.0); // 1.0 * 2.0
        assert_eq!(pos.y, 4.0); // 2.0 * 2.0
        assert_eq!(pos.z, 6.0); // 3.0 * 2.0
    }
}
