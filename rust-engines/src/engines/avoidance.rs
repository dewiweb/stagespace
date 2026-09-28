//! Avoidance — agents en répulsion mutuelle dans une boîte.
//!
//! Simulation 3D : agents initialisés sur un cercle du plan xy (z=0) avec un
//! jitter aléatoire, puis répulsion en 1/d² à courte portée + amortissement +
//! rebonds amortis sur les parois. Tous les agents sont intégrés à chaque pas —
//! Audit B1 : état simulé mis en cache (`Mutex`) — chaque appel n'intègre
//! que la fenêtre `[sim_t → t]` au lieu de re-simuler depuis t=0 : le coût
//! par frame passe de O(n³·t) à O(n²·Δframe). Seek arrière → reset + re-sim
//! (déterministe : même séquence d'appels → mêmes positions).
//!
//! Params (extra) :
//!   repulsion_radius   portée de la répulsion                    (défaut 0.4)
//!   repulsion_strength intensité de la répulsion (force/d²)      (défaut 2.0)
//!   damping            amortissement par pas (0..1)              (défaut 0.95)
//!   container_size     demi-côté de la boîte de confinement      (défaut 0.9)
//!   seed               graine RNG                                (défaut 42)

use crate::engines::{
    finite_or_zero, sim_window, Engine, EngineParams, MAX_OBJECTS, SIM_REWIND_EPS,
};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;
use std::sync::Mutex;

/// État simulé de l'essaim — conservé entre appels (audit B1).
struct AvoidanceCache {
    sim_t: f64,
    n_objects: usize,
    positions: Vec<Vector3<f64>>,
    velocities: Vec<Vector3<f64>>,
    /// Buffer de forces réutilisé (snapshot avant intégration).
    forces: Vec<Vector3<f64>>,
}

impl Default for AvoidanceCache {
    fn default() -> Self {
        Self {
            sim_t: f64::INFINITY, // force le premier init (t < sim_t)
            n_objects: 0,
            positions: Vec::new(),
            velocities: Vec::new(),
            forces: Vec::new(),
        }
    }
}

impl AvoidanceCache {
    /// Init : cercle xy jitteré + vitesses aléatoires — tirées dans
    /// l'ordre des agents pour que la simulation ne dépende pas de
    /// l'objet requêté.
    fn init(&mut self, n_objects: usize, seed: u64) {
        let mut rng = SimpleRng::new(seed);
        self.sim_t = 0.0;
        self.n_objects = n_objects;
        self.positions.clear();
        self.velocities.clear();
        self.positions.reserve(n_objects);
        self.velocities.reserve(n_objects);
        for i in 0..n_objects {
            let a = TAU * i as f64 / n_objects as f64;
            self.positions.push(Vector3::new(
                0.6 * a.cos() + rng.uniform(-0.05, 0.05),
                0.6 * a.sin() + rng.uniform(-0.05, 0.05),
                0.0,
            ));
            self.velocities.push(Vector3::new(
                rng.uniform(-0.05, 0.05),
                rng.uniform(-0.05, 0.05),
                0.0,
            ));
        }
        self.forces.clear();
        self.forces.resize(n_objects, Vector3::zeros());
    }
}

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Avoidance {
    cache: Mutex<AvoidanceCache>,
}

impl Engine for Avoidance {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let repulsion_radius = params
            .extra
            .get("repulsion_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.4)
            .max(0.0);
        let repulsion_strength = params
            .extra
            .get("repulsion_strength")
            .and_then(|v| v.as_f64())
            .unwrap_or(2.0);
        let damping = params
            .extra
            .get("damping")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.95)
            .clamp(0.0, 1.0);
        let container_size = params
            .extra
            .get("container_size")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.9)
            .max(1e-3);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        // object_index peut dépasser n_objects (hot-swap d'osc_id) : on
        // dimensionne l'essaim pour l'inclure plutôt que de paniquer
        // (MAX_OBJECTS borne le coût ; au-delà on retourne le dernier agent).
        let n_objects = params
            .n_objects
            .max(1)
            .max(object_index.saturating_add(1))
            .min(MAX_OBJECTS);
        let queried = object_index.min(n_objects - 1);

        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        // Seek arrière ou changement de population → reset + re-sim.
        if c.n_objects != n_objects || t < c.sim_t - SIM_REWIND_EPS {
            c.init(n_objects, seed);
        }

        let cost = (n_objects as u64).saturating_mul(n_objects as u64);
        let (n_steps, dt, new_t) = sim_window(c.sim_t, t, params.fps, cost);

        for _ in 0..n_steps {
            for i in 0..n_objects {
                let pos_i = c.positions[i];
                let mut f = Vector3::zeros();
                for (j, &pos_j) in c.positions.iter().enumerate() {
                    if j == i {
                        continue;
                    }
                    let diff = pos_i - pos_j;
                    let dist = diff.norm() + 1e-9;
                    if dist < repulsion_radius {
                        f += (diff / dist) * (repulsion_strength / (dist * dist));
                    }
                }
                c.forces[i] = f;
            }

            for i in 0..n_objects {
                let mut pos = c.positions[i];
                let mut vel = c.velocities[i];
                vel += c.forces[i] * dt;
                vel *= damping;
                pos += vel * dt;

                // Contenir dans une boîte (rebond amorti)
                for ax in 0..3 {
                    if pos[ax].abs() > container_size {
                        pos[ax] = pos[ax].signum() * container_size;
                        vel[ax] *= -0.8;
                    }
                }

                c.positions[i] = pos;
                c.velocities[i] = vel;
            }
        }
        c.sim_t = new_t;

        finite_or_zero(c.positions[queried])
    }

    fn name(&self) -> &str {
        "avoidance"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(n: usize, extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: n,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn avoidance_all_agents_move() {
        // Régression : les voisins restaient figés à leur position initiale
        // (la mise à jour all_positions[object_index] était inerte — l'index
        // sauté par la boucle de force). Tous les agents doivent bouger.
        let e = Avoidance::default();
        let p = params(4, json!({"seed": 42}));
        for i in 0..4 {
            let init = e.position(0.0, i, &p);
            let later = e.position(1.0, i, &p);
            assert!(
                (later - init).norm() > 1e-4,
                "agent {i} n'a pas bougé: {init:?} -> {later:?}"
            );
        }
    }

    #[test]
    fn avoidance_repulsion_keeps_agents_apart() {
        // 8 agents proches sur le cercle initial + répulsion forte : les
        // distances mutuelles ne doivent pas s'effondrer.
        let e = Avoidance::default();
        let p = params(
            8,
            json!({"repulsion_radius": 0.8, "repulsion_strength": 3.0,
                   "damping": 0.9, "seed": 5}),
        );
        let positions: Vec<Vector3<f64>> = (0..8).map(|i| e.position(2.0, i, &p)).collect();
        let mut min_dist = f64::MAX;
        for i in 0..8 {
            for j in (i + 1)..8 {
                min_dist = min_dist.min((positions[i] - positions[j]).norm());
            }
        }
        assert!(
            min_dist > 0.15,
            "la répulsion devrait maintenir les agents écartés, min_dist={min_dist}"
        );
    }

    #[test]
    fn avoidance_index_beyond_n_objects_does_not_panic() {
        // Régression : all_positions[object_index] paniquait quand
        // object_index >= n_objects.
        let e = Avoidance::default();
        let p = params(4, json!({}));
        let pos = e.position(1.0, 10, &p);
        assert!(pos.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn avoidance_stays_in_container() {
        let e = Avoidance::default();
        let p = params(
            6,
            json!({"container_size": 0.9, "repulsion_strength": 4.0, "seed": 11}),
        );
        for i in 0..6 {
            let pos = e.position(3.0, i, &p);
            assert!(
                pos.iter().all(|v| v.abs() <= 0.9 + 1e-9),
                "agent {i} hors de la boîte: {pos:?}"
            );
        }
    }

    #[test]
    fn avoidance_deterministic() {
        let e = Avoidance::default();
        let p = params(4, json!({"seed": 77}));
        for i in 0..4 {
            assert_eq!(e.position(1.5, i, &p), e.position(1.5, i, &p));
        }
    }
}
