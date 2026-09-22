use crate::engines::{Engine, EngineParams};
use crate::falloffs::{AudioAmplitudeFalloff, FalloffCurve};
use nalgebra::Vector3;
use std::borrow::Cow;

/// Moteur AudioAmplitudeFalloff — module une trajectoire par l'amplitude audio temps réel
/// L'amplitude est injectée via les paramètres extra ("amplitude" field)
/// En l'absence de données audio, la trajectoire de base est jouée normalement
pub struct AudioAmplitudeFalloffEngine;

impl Engine for AudioAmplitudeFalloffEngine {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let band = params
            .extra
            .get("band")
            .and_then(|v| v.as_str())
            .unwrap_or("rms");
        let min_val = params
            .extra
            .get("min_val")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let max_val = params
            .extra
            .get("max_val")
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

        // Récupérer l'amplitude depuis les paramètres extra
        // Le runtime injecte l'amplitude via extra["amplitude_<band>"] avec
        // band ∈ rms|bass|mid|high — clés statiques pour éviter un format!
        // par objet×frame ; Cow::Owned seulement pour les bandes custom.
        let amplitude_key: Cow<str> = match band {
            "rms" => "amplitude_rms".into(),
            "bass" => "amplitude_bass".into(),
            "mid" => "amplitude_mid".into(),
            "high" => "amplitude_high".into(),
            other => format!("amplitude_{other}").into(),
        };
        let amplitude = params
            .extra
            .get(amplitude_key.as_ref())
            .and_then(|v| v.as_f64())
            // Pas de donnée audio → influence = 1 → la trajectoire de base est
            // jouée à plein rayon (conforme au doc du module). Avant, le
            // défaut 0.5 réduisait le rayon à 65% sans aucune entrée audio.
            .unwrap_or(max_val);

        // Le schema UI envoie snake_case ("ease_in_out"), les valeurs
        // legacy étaient capitalisées ("EaseInOut") — on accepte les deux.
        let curve = match curve_str.to_lowercase().replace('_', "").as_str() {
            "easein" => FalloffCurve::EaseIn,
            "easeout" => FalloffCurve::EaseOut,
            "easeinout" => FalloffCurve::EaseInOut,
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
        let angle = 2.0 * std::f64::consts::PI * t / params.duration.max(1e-9);
        let modulated_radius = base_radius * (0.3 + 0.7 * influence); // minimum 30% du rayon

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
    fn test_no_audio_preserves_base_radius() {
        // Régression : sans donnée audio le défaut d'amplitude était 0.5 →
        // rayon réduit à 65% de base, en contradiction avec le doc
        // ("trajectoire de base jouée normalement"). L'influence doit être 1.
        let engine = AudioAmplitudeFalloffEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({"radius": 2.0}),
        };
        let pos = engine.position(0.0, 0, &params);
        let radius = (pos.x.powi(2) + pos.z.powi(2)).sqrt();
        assert!(
            (radius - 2.0).abs() < 1e-9,
            "sans audio le rayon doit être le rayon de base, r={radius}"
        );
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
