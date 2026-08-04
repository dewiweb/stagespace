use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct RoseCurve;

impl Engine for RoseCurve {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let radius = params.extra.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.8);
        let n_petals = params.extra.get("n_petals").and_then(|v| v.as_f64()).unwrap_or(4.0);
        let plane = params.extra.get("plane").and_then(|v| v.as_str()).unwrap_or("xy");
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);

        let phase = if phase_offset {
            2.0 * PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let theta = 2.0 * PI * speed * t / params.duration + phase;
        let r = radius * (n_petals * theta).cos();
        let x = r * theta.cos();
        let y = r * theta.sin();

        match plane {
            "xz" => Vector3::new(x, 0.0, y),
            "yz" => Vector3::new(0.0, x, y),
            _ => Vector3::new(x, y, 0.0),
        }
    }

    fn name(&self) -> &str {
        "rose_curve"
    }
}
