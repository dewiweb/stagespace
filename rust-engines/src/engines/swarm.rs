use nalgebra::Vector3;
use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;

pub struct Swarm;

impl Engine for Swarm {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let separation = params.extra.get("separation")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3);
        let alignment = params.extra.get("alignment")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let cohesion = params.extra.get("cohesion")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3);
        let max_speed = params.extra.get("max_speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let seed = params.extra.get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;
        
        let dt = 1.0 / params.fps;
        let n_steps = (t * params.fps) as i32;
        let n_objects = params.n_objects;
        
        let mut rng = SimpleRng::new(seed);
        
        // Initialisation en cercle
        let mut pos = Vector3::zeros();
        let angle = 2.0 * std::f64::consts::PI * object_index as f64 / n_objects as f64;
        pos.x = 0.6 * angle.cos();
        pos.y = 0.6 * angle.sin();
        
        let mut vel = Vector3::new(
            rng.uniform(-0.1, 0.1),
            rng.uniform(-0.1, 0.1),
            0.0,
        );
        
        // Simuler tous les objets (simplifié)
        let mut all_positions: Vec<Vector3<f64>> = Vec::new();
        let mut all_velocities: Vec<Vector3<f64>> = Vec::new();
        for i in 0..n_objects {
            let a = 2.0 * std::f64::consts::PI * i as f64 / n_objects as f64;
            let p = Vector3::new(0.6 * a.cos(), 0.6 * a.sin(), 0.0);
            let v = Vector3::new(rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0.0);
            all_positions.push(p);
            all_velocities.push(v);
        }
        
        for _ in 0..n_steps {
            let mut sep = Vector3::zeros();
            let mut align = Vector3::zeros();
            let mut coh = Vector3::zeros();
            let mut neighbors = 0;
            
            for j in 0..n_objects {
                if j == object_index {
                    continue;
                }
                let diff = pos - all_positions[j];
                let dist = diff.norm();
                
                if dist < separation {
                    sep += diff / (dist + 1e-9);
                }
                
                if dist < 0.5 {
                    align += all_velocities[j];
                    coh += all_positions[j];
                    neighbors += 1;
                }
            }
            
            if neighbors > 0 {
                align /= neighbors as f64;
                coh /= neighbors as f64;
                coh = (coh - pos) * 0.1;
            }
            
            vel += sep * separation + align * alignment + coh * cohesion;
            
            // Limiter la vitesse
            if vel.norm() > max_speed {
                vel = vel.normalize() * max_speed;
            }
            
            pos += vel * dt;
            pos = pos.map(|v| v.clamp(-1.0, 1.0));
            
            all_positions[object_index] = pos;
            all_velocities[object_index] = vel;
        }
        
        pos
    }

    fn name(&self) -> &str {
        "swarm"
    }
}

