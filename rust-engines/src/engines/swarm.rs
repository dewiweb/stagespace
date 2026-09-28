//! Swarm — boids de Reynolds (séparation / alignement / cohésion).
//!
//! Simulation 3D : les agents démarrent sur un cercle du plan xy (z=0) avec des
//! vitesses aléatoires faibles, puis interagissent. Tous les agents sont
//! intégrés à chaque pas (vrai flocking, pas de voisins figés).
//!
//! Audit B1 : l'état simulé est mis en cache (`Mutex`) — chaque appel n'intègre
//! que la fenêtre `[sim_t → t]` au lieu de re-simuler depuis t=0. Le coût par
//! frame passe de O(n³·t) à O(n²·Δframe). Un seek arrière (t < sim_t, sampling
//! arbitraire) reset l'état et re-simule — le résultat reste déterministe
//! (même séquence d'appels → mêmes positions ; RNG seedé à l'init).
//!
//! Params (extra) :
//!   separation        poids de la répulsion à courte portée      (défaut 0.3)
//!   alignment         poids d'alignement des vitesses            (défaut 0.5)
//!   cohesion          poids d'attraction vers le barycentre      (défaut 0.3)
//!   neighbor_radius   portée alignement/cohésion                 (défaut 0.5)
//!   max_speed         vitesse max, unités/s                      (défaut 0.5)
//!   seed              graine RNG                                 (défaut 42)

use crate::engines::{
    finite_or_zero, sim_window, Engine, EngineParams, MAX_OBJECTS, SIM_REWIND_EPS,
};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;
use std::sync::Mutex;

/// État simulé du troupeau — conservé entre appels (audit B1).
struct SwarmCache {
    /// Temps déjà couvert par l'intégration.
    sim_t: f64,
    n_objects: usize,
    positions: Vec<Vector3<f64>>,
    velocities: Vec<Vector3<f64>>,
    /// Buffer d'accélérations réutilisé à chaque pas (snapshot des forces
    /// avant mise à jour → intégration symplectique cohérente).
    acc: Vec<Vector3<f64>>,
}

impl Default for SwarmCache {
    fn default() -> Self {
        Self {
            sim_t: f64::INFINITY, // force le premier init (t < sim_t)
            n_objects: 0,
            positions: Vec::new(),
            velocities: Vec::new(),
            acc: Vec::new(),
        }
    }
}

impl SwarmCache {
    /// Init : cercle xy + vitesses aléatoires — toutes les valeurs sont
    /// tirées dans l'ordre des agents pour que la simulation ne dépende
    /// pas de l'objet interrogé.
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
            self.positions
                .push(Vector3::new(0.6 * a.cos(), 0.6 * a.sin(), 0.0));
            self.velocities.push(Vector3::new(
                rng.uniform(-0.1, 0.1),
                rng.uniform(-0.1, 0.1),
                0.0,
            ));
        }
        self.acc.clear();
        self.acc.resize(n_objects, Vector3::zeros());
    }
}

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Swarm {
    cache: Mutex<SwarmCache>,
}

impl Engine for Swarm {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let separation = params
            .extra
            .get("separation")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3)
            .max(0.0);
        let alignment = params
            .extra
            .get("alignment")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let cohesion = params
            .extra
            .get("cohesion")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3);
        let neighbor_radius = params
            .extra
            .get("neighbor_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .max(1e-3);
        let max_speed = params
            .extra
            .get("max_speed")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .max(1e-3);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        // object_index peut dépasser n_objects (hot-swap d'osc_id) : on dimensionne
        // le troupeau pour l'inclure plutôt que de paniquer. MAX_OBJECTS borne le
        // tout ; si object_index ≥ MAX_OBJECTS on retourne le dernier agent
        // (déterministe, fini) plutôt que de crasher.
        let n_objects = params
            .n_objects
            .max(1)
            .max(object_index.saturating_add(1))
            .min(MAX_OBJECTS);
        let queried = object_index.min(n_objects - 1);

        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        // Seek arrière (sampling arbitraire) ou changement de population →
        // reset + re-simulation depuis t=0 via la fenêtre [0 → t].
        if c.n_objects != n_objects || t < c.sim_t - SIM_REWIND_EPS {
            c.init(n_objects, seed);
        }

        let cost = (n_objects as u64).saturating_mul(n_objects as u64);
        let (n_steps, dt, new_t) = sim_window(c.sim_t, t, params.fps, cost);

        for _ in 0..n_steps {
            for i in 0..n_objects {
                let pos_i = c.positions[i];
                let mut sep = Vector3::zeros();
                let mut align = Vector3::zeros();
                let mut coh = Vector3::zeros();
                let mut neighbors = 0;

                for j in 0..n_objects {
                    if j == i {
                        continue;
                    }
                    let diff = pos_i - c.positions[j];
                    let dist = diff.norm();

                    if dist < separation {
                        sep += diff / (dist + 1e-9);
                    }

                    if dist < neighbor_radius {
                        align += c.velocities[j];
                        coh += c.positions[j];
                        neighbors += 1;
                    }
                }

                if neighbors > 0 {
                    align /= neighbors as f64;
                    coh /= neighbors as f64;
                    coh = (coh - pos_i) * 0.1;
                }

                c.acc[i] = sep * separation + align * alignment + coh * cohesion;
            }

            for i in 0..n_objects {
                // Kick d'accélération normalisé au pas nominal (60 Hz) :
                // sans ça la dynamique dépend du param fps (2× les steps =
                // 2× plus de kicks par seconde simulée).
                let mut vel = c.velocities[i] + c.acc[i] * (dt * 60.0);
                let speed = vel.norm();
                if speed > max_speed {
                    vel *= max_speed / speed;
                }
                c.velocities[i] = vel;
                c.positions[i] = (c.positions[i] + vel * dt).map(|v| v.clamp(-1.0, 1.0));
            }
        }
        c.sim_t = new_t;

        finite_or_zero(c.positions[queried])
    }

    fn name(&self) -> &str {
        "swarm"
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
    fn swarm_all_agents_move() {
        // Régression : les voisins n'étaient jamais intégrés (fantômes figés
        // sur le cercle initial). Tous les agents doivent bouger.
        let e = Swarm::default();
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
    fn swarm_neighbors_influence_each_other() {
        // Avec des voisins réellement intégrés, une forte cohésion rapproche
        // le groupe : le diamètre du nuage doit rester borné (les agents ne
        // dérivent pas indépendamment vers les coins du [-1,1]³).
        let e = Swarm::default();
        let p = params(
            6,
            json!({"separation": 0.1, "alignment": 0.0, "cohesion": 1.0,
                   "max_speed": 0.5, "seed": 7}),
        );
        let positions: Vec<Vector3<f64>> = (0..6).map(|i| e.position(2.0, i, &p)).collect();
        let center: Vector3<f64> = positions.iter().sum::<Vector3<f64>>() / 6.0;
        let max_dev = positions
            .iter()
            .map(|p| (p - center).norm())
            .fold(0.0_f64, f64::max);
        assert!(
            max_dev < 1.5,
            "la cohésion devrait garder le groupe compact, max_dev={max_dev}"
        );
    }

    #[test]
    fn swarm_separation_keeps_agents_apart() {
        // Séparation forte : aucun couple d'agents ne doit s'effondrer l'un
        // sur l'autre.
        let e = Swarm::default();
        let p = params(
            8,
            json!({"separation": 0.9, "alignment": 0.0, "cohesion": 0.0,
                   "max_speed": 1.0, "seed": 3}),
        );
        let positions: Vec<Vector3<f64>> = (0..8).map(|i| e.position(1.5, i, &p)).collect();
        let mut min_dist = f64::MAX;
        for i in 0..8 {
            for j in (i + 1)..8 {
                min_dist = min_dist.min((positions[i] - positions[j]).norm());
            }
        }
        assert!(
            min_dist > 0.1,
            "la séparation devrait éviter les collisions, min_dist={min_dist}"
        );
    }

    #[test]
    fn swarm_index_beyond_n_objects_does_not_panic() {
        // Régression : all_positions[object_index] paniquait quand
        // object_index >= n_objects (hot-swap d'osc_id → snap à l'origine
        // via catch_unwind).
        let e = Swarm::default();
        let p = params(4, json!({}));
        let pos = e.position(1.0, 10, &p);
        assert!(pos.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn swarm_deterministic() {
        // Deux engines frais, même séquence d'appels → mêmes positions.
        // (La re-simulation bit-exacte n'est plus garantie : l'état est
        // incrémental — la déterminisme est défini sur la séquence.)
        let a = Swarm::default();
        let b = Swarm::default();
        let p = params(4, json!({"seed": 99}));
        for i in 0..4 {
            assert_eq!(a.position(1.5, i, &p), b.position(1.5, i, &p));
        }
    }

    #[test]
    fn swarm_negative_t_gives_initial_positions() {
        let e = Swarm::default();
        let p = params(4, json!({"seed": 42}));
        let pos = e.position(-1.0, 0, &p);
        assert_eq!(pos, e.position(0.0, 0, &p));
    }

    #[test]
    fn swarm_incremental_matches_single_window() {
        // B1 : une marche frame par frame (90 fenêtres d'un pas) doit
        // rejoindre le même état qu'une fenêtre unique de 90 pas passant
        // par le même chemin de cache — c'est l'invariant qui compte : le
        // stepping incrémental conserve la trajectoire.
        let inc = Swarm::default();
        let single = Swarm::default();
        let p = params(6, json!({"seed": 7}));
        for f in 0..=90 {
            let t = f as f64 / 60.0;
            for i in 0..6 {
                inc.position(t, i, &p);
            }
        }
        for i in 0..6 {
            single.position(1.5, i, &p);
        }
        for i in 0..6 {
            let a = inc.position(1.5, i, &p);
            let b = single.position(1.5, i, &p);
            assert_eq!(a, b, "agent {i}: incrémental {a:?} ≠ fenêtre unique {b:?}");
        }
    }

    #[test]
    fn swarm_backward_seek_resets_and_resimulates() {
        // t < sim_t → reset : un appel arrière ne doit ni paniquer ni
        // retourner l'état futur.
        let e = Swarm::default();
        let p = params(4, json!({"seed": 42}));
        let far = e.position(2.0, 0, &p);
        let back = e.position(0.5, 0, &p);
        let fresh = Swarm::default().position(0.5, 0, &p);
        assert_eq!(back, fresh, "seek arrière doit re-simuler depuis t=0");
        assert_ne!(back, far);
    }
}
