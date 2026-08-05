use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Oscillation;

impl Engine for Oscillation {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let amplitude = params
            .extra
            .get("amplitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let frequency = params
            .extra
            .get("frequency")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let axis = params
            .extra
            .get("axis")
            .and_then(|v| v.as_str())
            .unwrap_or("x");
        let phase_offset = params
            .extra
            .get("phase_offset")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let phase = if phase_offset {
            2.0 * PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let t_norm = 2.0 * PI * frequency * t / params.duration + phase;
        let value = amplitude * t_norm.sin();

        match axis {
            "x" => Vector3::new(value, 0.0, 0.0),
            "y" => Vector3::new(0.0, value, 0.0),
            "z" => Vector3::new(0.0, 0.0, value),
            _ => Vector3::new(value, 0.0, 0.0),
        }
    }

    fn name(&self) -> &str {
        "oscillation"
    }
}
