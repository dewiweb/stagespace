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

        // Calculer la phase basée sur le BPM : une révolution par beat.
        // (rem_euclid plutôt que fract pour rester ≥ 0 même si t < 0)
        let beats_per_second = bpm.max(0.0) / 60.0;
        let phase = (t * beats_per_second).rem_euclid(1.0);

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
    fn test_bpm_period_is_one_beat() {
        // Régression : la phase était calculée en radians (t·bps·2π) avant
        // d'être re-multipliée par 2π → 2π× trop rapide (≈12.6 rev/s à 120 BPM
        // au lieu de 2). À 120 BPM, un beat = 0.5 s → période de 0.5 s.
        let engine = BpmEngine;
        let params = EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra: serde_json::json!({ "bpm": 120.0, "radius": 1.0, "plane": "xz" }),
        };

        let p0 = engine.position(0.0, 0, &params);
        let p_half_period = engine.position(0.25, 0, &params);
        let p_period = engine.position(0.5, 0, &params);

        // Après une demi-période : point opposé du cercle
        assert!(
            (p_half_period.x + p0.x).abs() < 0.05 && (p_half_period.z + p0.z).abs() < 0.05,
            "demi-période devrait donner le point opposé: {p_half_period:?}"
        );
        // Après une période complète : retour au point de départ
        assert!(
            (p_period - p0).norm() < 0.05,
            "période 0.5s à 120 BPM: {p_period:?} vs {p0:?}"
        );
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
