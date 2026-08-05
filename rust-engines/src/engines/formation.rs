use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Formation;

impl Engine for Formation {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let shape = params
            .extra
            .get("shape")
            .and_then(|v| v.as_str())
            .unwrap_or("circle");
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        let rotate = params
            .extra
            .get("rotate")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let elevation = params
            .extra
            .get("elevation")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let angle_offset = 2.0 * PI * rotate * t / params.duration;

        match shape {
            "circle" => {
                let base_angle = 2.0 * PI * object_index as f64 / params.n_objects as f64;
                let angle = base_angle + angle_offset;
                Vector3::new(radius * angle.cos(), radius * angle.sin(), elevation)
            }
            "sphere" => {
                // Distribution Fibonacci sur sphère
                let golden = PI * (3.0 - 5.0_f64.sqrt());
                let y = 1.0 - 2.0 * object_index as f64 / (params.n_objects - 1).max(1) as f64;
                let r = (1.0 - y * y).sqrt() * radius;
                let theta = golden * object_index as f64;
                let angle = theta + angle_offset;
                Vector3::new(r * angle.cos(), r * angle.sin(), y * radius)
            }
            "grid" => {
                let side = (params.n_objects as f64).sqrt().ceil() as usize;
                let row = object_index / side;
                let col = object_index % side;
                let x = (col as f64 / (side - 1).max(1) as f64 - 0.5) * 2.0 * radius;
                let y = (row as f64 / (side - 1).max(1) as f64 - 0.5) * 2.0 * radius;
                let cx = x * angle_offset.cos() - y * angle_offset.sin();
                let cy = x * angle_offset.sin() + y * angle_offset.cos();
                Vector3::new(cx, cy, elevation)
            }
            "line" => {
                let x = (object_index as f64 / (params.n_objects - 1).max(1) as f64 - 0.5)
                    * 2.0
                    * radius;
                Vector3::new(x * angle_offset.cos(), x * angle_offset.sin(), elevation)
            }
            "triangle" => {
                let base_angle = 2.0 * PI * object_index as f64 / params.n_objects as f64;
                let angle = base_angle + angle_offset;
                let r = radius * (1.0 + 0.3 * (3.0 * angle).cos());
                Vector3::new(r * angle.cos(), r * angle.sin(), elevation)
            }
            "hexagon" => {
                let base_angle = 2.0 * PI * object_index as f64 / params.n_objects as f64;
                let angle = base_angle + angle_offset;
                let r = radius * (1.0 + 0.2 * (6.0 * angle).cos());
                Vector3::new(r * angle.cos(), r * angle.sin(), elevation)
            }
            _ => Vector3::new(0.0, 0.0, 0.0),
        }
    }

    fn name(&self) -> &str {
        "formation"
    }
}
