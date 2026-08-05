use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::Vector3;

pub struct Spring;

impl Engine for Spring {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let target = params
            .extra
            .get("target")
            .and_then(|v| v.as_array())
            .map(|arr| {
                [
                    arr[0].as_f64().unwrap_or(0.0),
                    arr[1].as_f64().unwrap_or(0.0),
                    arr[2].as_f64().unwrap_or(0.0),
                ]
            });
        let stiffness = params
            .extra
            .get("stiffness")
            .and_then(|v| v.as_f64())
            .unwrap_or(3.0);
        let damping_coef = params
            .extra
            .get("damping_coef")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        let dt = 1.0 / params.fps;
        let n_steps = (t * params.fps) as i32;

        let mut rng = SimpleRng::new(seed);

        let mut pos = Vector3::new(
            rng.uniform(-0.8, 0.8),
            rng.uniform(-0.8, 0.8),
            rng.uniform(-0.8, 0.8),
        );
        let mut vel = Vector3::zeros();

        for step in 0..n_steps {
            let current_t = step as f64 / params.fps;

            let tgt = if let Some(tgt) = target {
                Vector3::new(tgt[0], tgt[1], tgt[2])
            } else {
                // Cible animée en cercle
                let angle = 2.0 * std::f64::consts::PI * current_t / params.duration;
                Vector3::new(
                    0.5 * angle.cos(),
                    0.5 * angle.sin(),
                    0.2 * (4.0 * std::f64::consts::PI * current_t / params.duration).sin(),
                )
            };

            let offset = Vector3::new(
                0.1 * (2.0 * std::f64::consts::PI * object_index as f64 / params.n_objects as f64)
                    .cos(),
                0.1 * (2.0 * std::f64::consts::PI * object_index as f64 / params.n_objects as f64)
                    .sin(),
                0.05 * object_index as f64 / params.n_objects as f64,
            );
            let tgt_i = (tgt + offset).map(|v| v.clamp(-1.0, 1.0));

            let force = (tgt_i - pos) * stiffness - vel * damping_coef;
            vel += force * dt;
            pos += vel * dt;
            pos = pos.map(|v| v.clamp(-1.0, 1.0));
        }

        pos
    }

    fn name(&self) -> &str {
        "spring"
    }
}
