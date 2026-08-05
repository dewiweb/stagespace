use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Lissajous;

impl Engine for Lissajous {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let a = params
            .extra
            .get("a")
            .and_then(|v| v.as_f64())
            .unwrap_or(3.0);
        let b = params
            .extra
            .get("b")
            .and_then(|v| v.as_f64())
            .unwrap_or(2.0);
        let delta = params
            .extra
            .get("delta")
            .and_then(|v| v.as_f64())
            .unwrap_or(PI / 2.0);
        let scale = params
            .extra
            .get("scale")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
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

        let t_norm = 2.0 * PI * t / params.duration + phase;

        Vector3::new(
            scale * (a * t_norm + delta).sin(),
            scale * (b * t_norm).sin(),
            0.0,
        )
    }

    fn name(&self) -> &str {
        "lissajous"
    }
}
