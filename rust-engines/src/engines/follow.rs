use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::Vector3;

pub struct Follow;

impl Engine for Follow {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let speed = params
            .extra
            .get("speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let distance = params
            .extra
            .get("distance")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        let mut rng = SimpleRng::new(seed);

        // Cible animée en cercle
        let angle = 2.0 * std::f64::consts::PI * t / params.duration;
        let target = Vector3::new(0.5 * angle.cos(), 0.5 * angle.sin(), 0.0);

        // Position initiale aléatoire
        let mut pos = Vector3::new(
            rng.uniform(-0.5, 0.5),
            rng.uniform(-0.5, 0.5),
            rng.uniform(-0.5, 0.5),
        );

        let dt = 1.0 / params.fps;
        let n_steps = (t * params.fps) as i32;

        for _ in 0..n_steps {
            let diff = target - pos;
            let dist = diff.norm();

            if dist > distance {
                let dir = diff / (dist + 1e-9);
                pos += dir * speed * dt;
            }
        }

        pos
    }

    fn name(&self) -> &str {
        "follow"
    }
}
