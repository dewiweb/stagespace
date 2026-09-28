//! Spring — masse-ressort amorti 3D vers une cible fixe (`target = [x,y,z]`)
//! ou, à défaut, une cible animée en cercle.
//!
//! Audit B1 : état par objet mis en cache (`Mutex`) — chaque appel
//! n'intègre que la fenêtre `[sim_t → t]` de l'objet requis au lieu de
//! re-simuler depuis t=0. Seek arrière → reset + re-sim (déterministe).

use crate::engines::{finite_or_zero, sim_window, Engine, EngineParams, SIM_REWIND_EPS};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::sync::Mutex;

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Spring {
    cache: Mutex<SpringCache>,
}

#[derive(Default)]
struct SpringCache {
    /// État par objet — intégration lazy (l'objet requis avance seul).
    agents: Vec<SpringAgent>,
}

struct SpringAgent {
    sim_t: f64,
    pos: Vector3<f64>,
    vel: Vector3<f64>,
}

/// État initial déterministe d'un objet (RNG seedé par index).
fn init_agent(object_index: usize, seed: u64) -> SpringAgent {
    let mut rng = SimpleRng::new(seed.wrapping_add(object_index as u64));
    SpringAgent {
        sim_t: 0.0,
        pos: Vector3::new(
            rng.uniform(-0.8, 0.8),
            rng.uniform(-0.8, 0.8),
            rng.uniform(-0.8, 0.8),
        ),
        vel: Vector3::zeros(),
    }
}

impl Engine for Spring {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let target = params
            .extra
            .get("target")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                // Mirror de linear.rs : un array trop court ne doit pas paniquer
                if arr.len() >= 3 {
                    Some([
                        arr[0].as_f64().unwrap_or(0.0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(0.0),
                    ])
                } else {
                    None
                }
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

        let duration = params.duration.max(1e-9);
        let n_obj = params.n_objects.max(1) as f64;

        // Lazy per-agent : l'objet requis est créé/intégré seul — un
        // objet au-delà de n_objects (hot-swap) est géré sans paniquer.
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        while c.agents.len() <= object_index {
            let idx = c.agents.len();
            c.agents.push(init_agent(idx, seed));
        }
        let a = &mut c.agents[object_index];
        if t < a.sim_t - SIM_REWIND_EPS {
            *a = init_agent(object_index, seed);
        }

        let (n_steps, dt, new_t) = sim_window(a.sim_t, t, params.fps, 1);
        let sim_t0 = a.sim_t;

        for step in 0..n_steps {
            // Temps absolu du pas (la cible animée dépend du temps absolu)
            let current_t = sim_t0 + step as f64 * dt;

            let tgt = if let Some(tgt) = target {
                Vector3::new(tgt[0], tgt[1], tgt[2])
            } else {
                // Cible animée en cercle
                let angle = 2.0 * std::f64::consts::PI * current_t / duration;
                Vector3::new(
                    0.5 * angle.cos(),
                    0.5 * angle.sin(),
                    0.2 * (4.0 * std::f64::consts::PI * current_t / duration).sin(),
                )
            };

            let offset = Vector3::new(
                0.1 * (2.0 * std::f64::consts::PI * object_index as f64 / n_obj).cos(),
                0.1 * (2.0 * std::f64::consts::PI * object_index as f64 / n_obj).sin(),
                0.05 * object_index as f64 / n_obj,
            );
            let tgt_i = (tgt + offset).map(|v| v.clamp(-1.0, 1.0));

            let force = (tgt_i - a.pos) * stiffness - a.vel * damping_coef;
            a.vel += force * dt;
            a.pos += a.vel * dt;
            a.pos = a.pos.map(|v| v.clamp(-1.0, 1.0));
        }
        a.sim_t = new_t;
        let pos = a.pos;

        finite_or_zero(pos)
    }

    fn name(&self) -> &str {
        "spring"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn spring_short_target_array_does_not_panic() {
        // Régression : target indexé sans vérif de longueur → panic sur
        // "target": [0.5] ou [].
        let e = Spring::default();
        for extra in [json!({"target": [0.5]}), json!({"target": []})] {
            let p = params(extra);
            let pos = e.position(1.0, 0, &p);
            assert!(pos.iter().all(|v| v.is_finite()), "pos={pos:?}");
        }
    }

    #[test]
    fn spring_zero_duration_stays_finite() {
        // Régression : division par duration dans la boucle → inf/NaN
        let e = Spring::default();
        let p = EngineParams {
            n_objects: 1,
            duration: 0.0,
            fps: 60.0,
            extra: json!({}),
        };
        assert!(e.position(1.0, 0, &p).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn spring_converges_toward_target() {
        let e = Spring::default();
        let p = params(json!({"target": [0.5, 0.0, 0.0], "stiffness": 8.0,
                              "damping_coef": 2.0}));
        let pos = e.position(4.0, 0, &p);
        // Après 4s le ressort amorti doit être proche de la cible
        assert!(
            (pos - Vector3::new(0.5, 0.0, 0.0)).norm() < 0.3,
            "pos={pos:?}"
        );
    }

    #[test]
    fn spring_negative_t_gives_initial_position() {
        let e = Spring::default();
        let p = params(json!({"seed": 42}));
        assert_eq!(e.position(-1.0, 0, &p), e.position(0.0, 0, &p));
    }
}
