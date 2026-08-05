use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::Vector3;

pub struct Bouncing;

impl Engine for Bouncing {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let container = params
            .extra
            .get("container")
            .and_then(|v| v.as_str())
            .unwrap_or("sphere");
        let container_size = params
            .extra
            .get("container_size")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.9);
        let restitution = params
            .extra
            .get("restitution")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.95);
        let gravity = params
            .extra
            .get("gravity")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        let dt = 1.0 / params.fps;
        let n_steps = (t * params.fps) as i32;

        let mut rng = SimpleRng::new(seed + object_index as u64 * 31);

        // Position initiale
        let mut pos = Vector3::new(
            rng.uniform(-container_size * 0.5, container_size * 0.5),
            rng.uniform(-container_size * 0.5, container_size * 0.5),
            rng.uniform(-container_size * 0.5, container_size * 0.5),
        );

        // Vélocité initiale
        let mut vel = Vector3::new(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0.0);

        for _ in 0..n_steps {
            // Gravité
            vel.z -= gravity * dt * 0.01;

            pos += vel * dt;

            // Collisions avec le contenant
            match container {
                "sphere" => {
                    let dist = pos.norm();
                    if dist > container_size {
                        let n = pos / (dist + 1e-9);
                        pos = n * container_size;
                        vel = vel - 2.0 * vel.dot(&n) * n;
                        vel *= restitution;
                    }
                }
                "box" => {
                    for ax in 0..3 {
                        if pos[ax] > container_size {
                            pos[ax] = container_size;
                            vel[ax] *= -restitution;
                        } else if pos[ax] < -container_size {
                            pos[ax] = -container_size;
                            vel[ax] *= -restitution;
                        }
                    }
                }
                "cylinder" => {
                    let r_xy = (pos.x * pos.x + pos.y * pos.y).sqrt();
                    if r_xy > container_size {
                        let n = Vector3::new(pos.x / (r_xy + 1e-9), pos.y / (r_xy + 1e-9), 0.0);
                        pos.x = n.x * container_size;
                        pos.y = n.y * container_size;
                        vel = vel - 2.0 * vel.dot(&n) * n;
                        vel *= restitution;
                    }
                    if pos.z > container_size {
                        pos.z = container_size;
                        vel.z *= -restitution;
                    } else if pos.z < -container_size {
                        pos.z = -container_size;
                        vel.z *= -restitution;
                    }
                }
                _ => {}
            }
        }

        pos
    }

    fn name(&self) -> &str {
        "bouncing"
    }
}
