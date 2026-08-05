use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

/// Wave — onde voyageante across les objets (stadium wave)
/// Chaque objet oscille avec un délai proportionnel à son index
pub struct Wave;

impl Engine for Wave {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let amplitude = params
            .extra
            .get("amplitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let frequency = params
            .extra
            .get("frequency")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let speed = params
            .extra
            .get("speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let axis = params
            .extra
            .get("axis")
            .and_then(|v| v.as_str())
            .unwrap_or("y");
        let phase_offset = params
            .extra
            .get("phase_offset")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        // Phase par objet — délai proportionnel à l'index
        let obj_phase = if phase_offset {
            object_index as f64 / params.n_objects.max(1) as f64
        } else {
            0.0
        };

        // Position de base répartie sur l'axe X
        let spread = params
            .extra
            .get("spread")
            .and_then(|v| v.as_f64())
            .unwrap_or(4.0);
        let base_x = if params.n_objects > 1 {
            -spread / 2.0 + spread * object_index as f64 / (params.n_objects - 1) as f64
        } else {
            0.0
        };

        // Onde voyageante
        let wave = amplitude * (2.0 * PI * frequency * (t * speed - obj_phase)).sin();

        match axis {
            "x" => Vector3::new(base_x + wave, 0.0, 0.0),
            "y" => Vector3::new(base_x, wave, 0.0),
            "z" => Vector3::new(base_x, 0.0, wave),
            _ => Vector3::new(base_x, wave, 0.0),
        }
    }

    fn name(&self) -> &str {
        "wave"
    }
}
