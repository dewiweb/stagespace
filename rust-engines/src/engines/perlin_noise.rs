use nalgebra::Vector3;
use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;

pub struct PerlinNoise;

impl Engine for PerlinNoise {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let intensity = params.extra.get("intensity")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let smoothness = params.extra.get("smoothness")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let seed = params.extra.get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        // Approximation de Perlin par superposition harmonique
        let n_harmonics = (3.0 + 12.0 * (1.0 - smoothness)) as i32;
        let base_freq = 1.0 / params.duration;
        
        let obj_seed = seed + object_index as u64 * 31;
        let mut rng = SimpleRng::new(obj_seed);
        
        let mut x = 0.0;
        let mut y = 0.0;
        let mut z = 0.0;
        
        for h in 1..=n_harmonics {
            let freq = base_freq * h as f64 * (1.0 + 0.2 * rng.randn());
            let amp = intensity / (h as f64).powf(0.5 + smoothness);
            let phase = rng.uniform(0.0, 2.0 * std::f64::consts::PI);
            
            x += amp * (2.0 * std::f64::consts::PI * freq * t + phase).sin();
            y += amp * (2.0 * std::f64::consts::PI * freq * t + phase + 0.1).sin();
            z += amp * (2.0 * std::f64::consts::PI * freq * t + phase + 0.2).sin();
        }
        
        // Normaliser
        let max_val = x.abs().max(y.abs()).max(z.abs());
        if max_val > 0.0 {
            x = (x / max_val) * intensity;
            y = (y / max_val) * intensity;
            z = (z / max_val) * intensity;
        }
        
        Vector3::new(
            x.clamp(-1.0, 1.0),
            y.clamp(-1.0, 1.0),
            z.clamp(-1.0, 1.0),
        )
    }

    fn name(&self) -> &str {
        "perlin_noise"
    }
}
