use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Helix;

impl Engine for Helix {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let radius = params.extra.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.7);
        let height = params.extra.get("height").and_then(|v| v.as_f64()).unwrap_or(1.6);
        let turns = params.extra.get("turns").and_then(|v| v.as_f64()).unwrap_or(3.0);
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);

        let phase = if phase_offset {
            2.0 * PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let tn = t / params.duration;
        let angle = 2.0 * PI * turns * speed * tn + phase;
        let z = height * (tn - 0.5);

        Vector3::new(radius * angle.cos(), radius * angle.sin(), z)
    }

    fn name(&self) -> &str {
        "helix"
    }
}
