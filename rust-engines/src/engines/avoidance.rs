use nalgebra::Vector3;
use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;

pub struct Avoidance;

impl Engine for Avoidance {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let repulsion_radius = params.extra.get("repulsion_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.4);
        let repulsion_strength = params.extra.get("repulsion_strength")
            .and_then(|v| v.as_f64())
            .unwrap_or(2.0);
        let damping = params.extra.get("damping")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.95);
        let container_size = params.extra.get("container_size")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.9);
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
        pos.x = 0.6 * angle.cos() + rng.uniform(-0.05, 0.05);
        pos.y = 0.6 * angle.sin() + rng.uniform(-0.05, 0.05);
        
        let mut vel = Vector3::new(
            rng.uniform(-0.05, 0.05),
            rng.uniform(-0.05, 0.05),
            0.0,
        );
        
        // Simuler tous les objets (simplifié: on simule juste les autres statiquement)
        let mut all_positions: Vec<Vector3<f64>> = Vec::new();
        for i in 0..n_objects {
            let a = 2.0 * std::f64::consts::PI * i as f64 / n_objects as f64;
            let p = Vector3::new(0.6 * a.cos(), 0.6 * a.sin(), 0.0);
            all_positions.push(p);
        }
        
        for _ in 0..n_steps {
            let mut forces = Vector3::zeros();
            
            for j in 0..n_objects {
                if j == object_index {
                    continue;
                }
                let diff = pos - all_positions[j];
                let dist = diff.norm() + 1e-9;
                if dist < repulsion_radius {
                    forces += (diff / dist) * (repulsion_strength / (dist * dist));
                }
            }
            
            vel += forces * dt;
            vel *= damping;
            pos += vel * dt;
            
            // Contenir dans une boîte
            for ax in 0..3 {
                if pos[ax].abs() > container_size {
                    pos[ax] = pos[ax].signum() * container_size;
                    vel[ax] *= -0.8;
                }
            }
            
            // Mettre à jour la position dans all_positions
            all_positions[object_index] = pos;
        }
        
        pos
    }

    fn name(&self) -> &str {
        "avoidance"
    }
}

