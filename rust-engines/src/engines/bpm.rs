use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

/// Moteur BPM - génère des positions synchronisées sur le BPM
pub struct BpmEngine;

impl Engine for BpmEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let bpm = params
            .extra
            .get("bpm")
            .and_then(|v| v.as_f64())
            .unwrap_or(120.0);
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let plane = params
            .extra
            .get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");

        // Calculer la phase basée sur le BPM
        let beats_per_second = bpm / 60.0;
        let phase = (t * beats_per_second * 2.0 * std::f64::consts::PI).fract();

        // Position sur un cercle synchronisé au BPM
        let angle = phase * 2.0 * std::f64::consts::PI;

        match plane {
            "xy" => Vector3::new(radius * angle.cos(), radius * angle.sin(), 0.0),
            "xz" => Vector3::new(radius * angle.cos(), 0.0, radius * angle.sin()),
            "yz" => Vector3::new(0.0, radius * angle.cos(), radius * angle.sin()),
            _ => Vector3::new(radius * angle.cos(), 0.0, radius * angle.sin()),
        }
    }

    fn name(&self) -> &str {
        "bpm"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bpm_position() {
        let engine = BpmEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 1.0,
            fps: 60.0,
            extra: serde_json::json!({ "bpm": 120.0, "radius": 1.0, "plane": "xz" }),
        };

        let pos = engine.position(0.0, 0, &params);
        assert_eq!(pos.x, 1.0);
        assert_eq!(pos.y, 0.0);
        assert_eq!(pos.z, 0.0);
    }

    #[test]
    fn test_bpm_default_params() {
        let engine = BpmEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 1.0,
            fps: 60.0,
            extra: serde_json::json!({}),
        };

        let pos = engine.position(0.0, 0, &params);
        // BPM par défaut 120, radius par défaut 1.0
        assert_eq!(pos.x, 1.0);
    }
}
