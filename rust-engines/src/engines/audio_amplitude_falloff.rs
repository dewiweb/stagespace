use crate::engines::{Engine, EngineParams};
use crate::falloffs::{AudioAmplitudeFalloff, FalloffCurve};
use nalgebra::Vector3;

/// Moteur AudioAmplitudeFalloff — module une trajectoire par l'amplitude audio temps réel
/// L'amplitude est injectée via les paramètres extra ("amplitude" field)
/// En l'absence de données audio, la trajectoire de base est jouée normalement
pub struct AudioAmplitudeFalloffEngine;

impl Engine for AudioAmplitudeFalloffEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let band = params.extra.get("band").and_then(|v| v.as_str()).unwrap_or("rms");
        let min_val = params.extra.get("min_val").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let max_val = params.extra.get("max_val").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let curve_str = params.extra.get("curve").and_then(|v| v.as_str()).unwrap_or("Linear");
        let base_radius = params.extra.get("radius").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let plane = params.extra.get("plane").and_then(|v| v.as_str()).unwrap_or("xz");

        // Récupérer l'amplitude depuis les paramètres extra
        // Le runtime injecte l'amplitude via extra["amplitude_<band>"]
        let amplitude_key = format!("amplitude_{}", band);
        let amplitude = params.extra.get(&amplitude_key).and_then(|v| v.as_f64()).unwrap_or(0.5);

        let curve = match curve_str {
            "EaseIn" => FalloffCurve::EaseIn,
            "EaseOut" => FalloffCurve::EaseOut,
            "EaseInOut" => FalloffCurve::EaseInOut,
            _ => FalloffCurve::Linear,
        };

        let falloff = AudioAmplitudeFalloff {
            band: band.to_string(),
            min_val,
            max_val,
            curve,
        };

        let influence = falloff.influence_from_value(amplitude);

        // Mouvement circulaire modulé par l'amplitude
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;
        let modulated_radius = base_radius * (0.3 + 0.7 * influence); // minimum 30% du rayon

        match plane {
            "xy" => Vector3::new(modulated_radius * angle.cos(), modulated_radius * angle.sin(), 0.0),
            "xz" => Vector3::new(modulated_radius * angle.cos(), 0.0, modulated_radius * angle.sin()),
            "yz" => Vector3::new(0.0, modulated_radius * angle.cos(), modulated_radius * angle.sin()),
            _ => Vector3::new(modulated_radius * angle.cos(), 0.0, modulated_radius * angle.sin()),
        }
    }

    fn name(&self) -> &str {
        "audio_amplitude_falloff"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_amplitude_falloff_default_params() {
        let engine = AudioAmplitudeFalloffEngine;
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
    fn test_audio_amplitude_falloff_with_amplitude() {
        let engine = AudioAmplitudeFalloffEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({
                "band": "rms",
                "min_val": 0.0,
                "max_val": 1.0,
                "amplitude_rms": 0.8,
                "radius": 2.0,
            }),
        };
        let pos = engine.position(2.0, 0, &params);
        assert!(pos.x.is_finite());
        // Avec amplitude 0.8, le rayon devrait être > 0
        let radius = (pos.x.powi(2) + pos.z.powi(2)).sqrt();
        assert!(radius > 0.5);
    }
}
