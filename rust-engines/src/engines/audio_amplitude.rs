use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

/// Moteur AudioAmplitude - génère des positions modulées par l'amplitude audio
pub struct AudioAmplitudeEngine;

impl Engine for AudioAmplitudeEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let amplitude = params
            .extra
            .get("amplitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let _band = params
            .extra
            .get("band")
            .and_then(|v| v.as_str())
            .unwrap_or("rms");
        let plane = params
            .extra
            .get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");

        let modulated_radius = radius * amplitude;
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;

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
        "audio_amplitude"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_audio_amplitude_position() {
        let engine = AudioAmplitudeEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 1.0,
            fps: 60.0,
            extra: json!({ "amplitude": 0.5, "radius": 1.0, "plane": "xz" }),
        };

        let pos = engine.position(0.0, 0, &params);
        assert_eq!(pos.x, 0.5);
        assert_eq!(pos.y, 0.0);
        assert_eq!(pos.z, 0.0);
    }

    #[test]
    fn test_audio_amplitude_default_params() {
        let engine = AudioAmplitudeEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 1.0,
            fps: 60.0,
            extra: json!({}),
        };

        let pos = engine.position(0.0, 0, &params);
        assert_eq!(pos.x, 0.5);
    }
}
