use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Spiral;

impl Engine for Spiral {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        let speed = params
            .extra
            .get("speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let expansion = params
            .extra
            .get("expansion")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.1);
        let plane = params
            .extra
            .get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");
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

        let angle = 2.0 * PI * speed * t / params.duration + phase;
        let current_radius = radius + expansion * t / params.duration;

        match plane {
            "xy" => Vector3::new(
                current_radius * angle.cos(),
                current_radius * angle.sin(),
                0.0,
            ),
            "xz" => Vector3::new(
                current_radius * angle.cos(),
                0.0,
                current_radius * angle.sin(),
            ),
            "yz" => Vector3::new(
                0.0,
                current_radius * angle.cos(),
                current_radius * angle.sin(),
            ),
            _ => Vector3::new(
                current_radius * angle.cos(),
                0.0,
                current_radius * angle.sin(),
            ),
        }
    }

    fn name(&self) -> &str {
        "spiral"
    }
}
