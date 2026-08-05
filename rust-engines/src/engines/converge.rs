use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct Converge;

impl Engine for Converge {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let start_radius = params
            .extra
            .get("start_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.9);
        let end_radius = params
            .extra
            .get("end_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let easing = params
            .extra
            .get("easing")
            .and_then(|v| v.as_str())
            .unwrap_or("linear");

        let tn = t / params.duration;
        let eased = match easing {
            "ease_in" => tn * tn,
            "ease_out" => 1.0 - (1.0 - tn) * (1.0 - tn),
            "smooth" => 3.0 * tn * tn - 2.0 * tn * tn * tn,
            _ => tn,
        };

        let r = start_radius + (end_radius - start_radius) * eased;
        let base_angle = 2.0 * std::f64::consts::PI * object_index as f64 / params.n_objects as f64;

        Vector3::new(r * base_angle.cos(), r * base_angle.sin(), 0.0)
    }

    fn name(&self) -> &str {
        "converge"
    }
}
