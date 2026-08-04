use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Figure8;

impl Engine for Figure8 {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let scale = params.extra.get("scale")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        let speed = params.extra.get("speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let plane = params.extra.get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");
        let phase_offset = params.extra.get("phase_offset")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let phase = if phase_offset {
            2.0 * PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let t_norm = 2.0 * PI * speed * t / params.duration + phase;
        let x = scale * t_norm.sin();
        let y = scale * (2.0 * t_norm).sin() / 2.0;

        match plane {
            "xy" => Vector3::new(x, y, 0.0),
            "xz" => Vector3::new(x, 0.0, y),
            "yz" => Vector3::new(0.0, x, y),
            _ => Vector3::new(x, 0.0, y),
        }
    }

    fn name(&self) -> &str {
        "figure8"
    }
}
