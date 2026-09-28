//! Bouncing — particule en rebonds dans un contenant (sphere / box /
//! cylinder) de demi-taille `container_size`, dans l'espace 3D.
//!
//! Audit B1 : état par objet mis en cache (`Mutex`) — chaque appel
//! n'intègre que la fenêtre `[sim_t → t]` de l'objet requis au lieu de
//! re-simuler depuis t=0 (RNG seedé par objet à l'init). Seek arrière →
//! reset + re-sim (déterministe).
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

use crate::engines::{finite_or_zero, sim_window, Engine, EngineParams, SIM_REWIND_EPS};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::sync::Mutex;

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Bouncing {
    cache: Mutex<BouncingCache>,
}

#[derive(Default)]
struct BouncingCache {
    /// État par objet — intégration lazy (l'objet requis avance seul).
    agents: Vec<BouncingAgent>,
}

struct BouncingAgent {
    sim_t: f64,
    pos: Vector3<f64>,
    vel: Vector3<f64>,
}

/// État initial déterministe (RNG seedé par index d'objet).
fn init_agent(object_index: usize, seed: u64, container_size: f64) -> BouncingAgent {
    let mut rng = SimpleRng::new(seed + object_index as u64 * 31);
    BouncingAgent {
        sim_t: 0.0,
        pos: Vector3::new(
            rng.uniform(-container_size * 0.5, container_size * 0.5),
            rng.uniform(-container_size * 0.5, container_size * 0.5),
            rng.uniform(-container_size * 0.5, container_size * 0.5),
        ),
        vel: Vector3::new(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0.0),
    }
}

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

        // Lazy per-agent : l'objet requis est créé/intégré seul.
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        while c.agents.len() <= object_index {
            let idx = c.agents.len();
            c.agents.push(init_agent(idx, seed, container_size));
        }
        let a = &mut c.agents[object_index];
        if t < a.sim_t - SIM_REWIND_EPS {
            *a = init_agent(object_index, seed, container_size);
        }

        let (n_steps, dt, new_t) = sim_window(a.sim_t, t, params.fps, 1);

        for _ in 0..n_steps {
            // Gravité (échelle 0.01 — voir doc du module)
            a.vel.z -= gravity * dt * 0.01;

            a.pos += a.vel * dt;

            // Collisions avec le contenant
            match container {
                "sphere" => {
                    let dist = a.pos.norm();
                    if dist > container_size {
                        let n = a.pos / (dist + 1e-9);
                        a.pos = n * container_size;
                        // Réfléchir seulement si la vitesse pointe vers
                        // l'extérieur (vel·n > 0) : sinon on injecterait de
                        // l'énergie en retournant une vitesse déjà rentrante.
                        let vn = a.vel.dot(&n);
                        if vn > 0.0 {
                            a.vel = (a.vel - 2.0 * vn * n) * restitution;
                        }
                    }
                }
                "box" => {
                    for ax in 0..3 {
                        if a.pos[ax] > container_size {
                            a.pos[ax] = container_size;
                            a.vel[ax] *= -restitution;
                        } else if a.pos[ax] < -container_size {
                            a.pos[ax] = -container_size;
                            a.vel[ax] *= -restitution;
                        }
                    }
                }
                "cylinder" => {
                    let r_xy = (a.pos.x * a.pos.x + a.pos.y * a.pos.y).sqrt();
                    if r_xy > container_size {
                        let n = Vector3::new(a.pos.x / (r_xy + 1e-9), a.pos.y / (r_xy + 1e-9), 0.0);
                        a.pos.x = n.x * container_size;
                        a.pos.y = n.y * container_size;
                        let vn = a.vel.dot(&n);
                        if vn > 0.0 {
                            a.vel = (a.vel - 2.0 * vn * n) * restitution;
                        }
                    }
                    if a.pos.z > container_size {
                        a.pos.z = container_size;
                        a.vel.z *= -restitution;
                    } else if a.pos.z < -container_size {
                        a.pos.z = -container_size;
                        a.vel.z *= -restitution;
                    }
                }
                _ => {}
            }
        }
        a.sim_t = new_t;
        let pos = a.pos;

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
        let e = Bouncing::default();
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
        let e = Bouncing::default();
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
        let e = Bouncing::default();
        let p = params(json!({"container": "box", "gravity": 9.81, "seed": 3}));
        for i in 0..4 {
            let a = e.position(2.0, i, &p);
            assert_eq!(a, e.position(2.0, i, &p));
            assert!(a.iter().all(|v| v.is_finite()));
        }
    }
}
