//! Bouncing — particule en rebonds dans un contenant (sphere / box /
//! cylinder) de demi-taille `container_size`, dans l'espace 3D.
//!
//! Re-simulation déterministe depuis t=0 à chaque appel (RNG seedé par objet).
//!
//! Params (extra) :
//!   container       "sphere" | "box" | "cylinder"    (défaut sphere)
//!   container_size  demi-taille du contenant         (défaut 0.9)
//!   restitution     coefficient de rebond 0..1       (défaut 0.95)
//!   gravity         pesanteur en unités·100/s² — NB: échelle arbitraire
//!                   historique (`gravity * dt * 0.01`, ~0.1 u/s² pour 9.81)
//!                   sans lien avec le `gravity/(length*10)` de pendulum.
//!                   (défaut 0.0)
//!   seed            graine RNG                       (défaut 42)

use crate::engines::{finite_or_zero, sim_steps, Engine, EngineParams};
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
            .unwrap_or(0.9)
            .max(1e-3);
        let restitution = params
            .extra
            .get("restitution")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.95)
            .clamp(0.0, 1.0);
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

        let (n_steps, dt) = sim_steps(t, params.fps);

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
            // Gravité (échelle 0.01 — voir doc du module)
            vel.z -= gravity * dt * 0.01;

            pos += vel * dt;

            // Collisions avec le contenant
            match container {
                "sphere" => {
                    let dist = pos.norm();
                    if dist > container_size {
                        let n = pos / (dist + 1e-9);
                        pos = n * container_size;
                        // Réfléchir seulement si la vitesse pointe vers
                        // l'extérieur (vel·n > 0) : sinon on injecterait de
                        // l'énergie en retournant une vitesse déjà rentrante.
                        let vn = vel.dot(&n);
                        if vn > 0.0 {
                            vel = (vel - 2.0 * vn * n) * restitution;
                        }
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
                        let vn = vel.dot(&n);
                        if vn > 0.0 {
                            vel = (vel - 2.0 * vn * n) * restitution;
                        }
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

        finite_or_zero(pos)
    }

    fn name(&self) -> &str {
        "bouncing"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn bouncing_stays_inside_sphere() {
        let e = Bouncing;
        let p = params(json!({"container": "sphere", "container_size": 0.9,
                              "gravity": 5.0, "seed": 42}));
        for i in 0..4 {
            for k in 0..10 {
                let pos = e.position(k as f64 * 0.5, i, &p);
                assert!(
                    pos.norm() <= 0.9 + 1e-9,
                    "hors contenant: t={} obj={i} |pos|={}",
                    k as f64 * 0.5,
                    pos.norm()
                );
            }
        }
    }

    #[test]
    fn bouncing_stays_inside_cylinder() {
        let e = Bouncing;
        let p = params(json!({"container": "cylinder", "container_size": 0.8,
                              "seed": 7}));
        for i in 0..4 {
            let pos = e.position(3.0, i, &p);
            let r_xy = (pos.x * pos.x + pos.y * pos.y).sqrt();
            assert!(r_xy <= 0.8 + 1e-9 && pos.z.abs() <= 0.8 + 1e-9);
        }
    }

    #[test]
    fn bouncing_deterministic_and_finite() {
        let e = Bouncing;
        let p = params(json!({"container": "box", "gravity": 9.81, "seed": 3}));
        for i in 0..4 {
            let a = e.position(2.0, i, &p);
            assert_eq!(a, e.position(2.0, i, &p));
            assert!(a.iter().all(|v| v.is_finite()));
        }
    }
}
