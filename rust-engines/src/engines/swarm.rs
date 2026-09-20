//! Swarm — boids de Reynolds (séparation / alignement / cohésion).
//!
//! Simulation 3D : les agents démarrent sur un cercle du plan xy (z=0) avec des
//! vitesses aléatoires faibles, puis interagissent. Tous les agents sont
//! intégrés à chaque pas (vrai flocking, pas de voisins figés) — la fonction
//! reste pure : re-simulation déterministe depuis t=0 à chaque appel, RNG
//! seedé identiquement quel que soit l'objet interrogé. Coût O(n²·steps).
//!
//! Params (extra) :
//!   separation        poids de la répulsion à courte portée      (défaut 0.3)
//!   alignment         poids d'alignement des vitesses            (défaut 0.5)
//!   cohesion          poids d'attraction vers le barycentre      (défaut 0.3)
//!   neighbor_radius   portée alignement/cohésion                 (défaut 0.5)
//!   max_speed         vitesse max, unités/s                      (défaut 0.5)
//!   seed              graine RNG                                 (défaut 42)

use crate::engines::{finite_or_zero, sim_steps_n2, Engine, EngineParams, MAX_OBJECTS};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;

pub struct Swarm;

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

        let (n_steps, dt) = sim_steps_n2(t, params.fps, n_objects);

        let mut rng = SimpleRng::new(seed);

        // Init : cercle xy + vitesses aléatoires — toutes les valeurs sont
        // tirées dans l'ordre des agents pour que la simulation ne dépende pas
        // de l'objet interrogé.
        let mut all_positions: Vec<Vector3<f64>> = Vec::with_capacity(n_objects);
        let mut all_velocities: Vec<Vector3<f64>> = Vec::with_capacity(n_objects);
        for i in 0..n_objects {
            let a = TAU * i as f64 / n_objects as f64;
            all_positions.push(Vector3::new(0.6 * a.cos(), 0.6 * a.sin(), 0.0));
            all_velocities.push(Vector3::new(
                rng.uniform(-0.1, 0.1),
                rng.uniform(-0.1, 0.1),
                0.0,
            ));
        }

        // Buffer d'accélérations réutilisé à chaque pas (snapshot des forces
        // avant mise à jour → intégration symplectique cohérente).
        let mut acc: Vec<Vector3<f64>> = vec![Vector3::zeros(); n_objects];

        for _ in 0..n_steps {
            for i in 0..n_objects {
                let pos_i = all_positions[i];
                let mut sep = Vector3::zeros();
                let mut align = Vector3::zeros();
                let mut coh = Vector3::zeros();
                let mut neighbors = 0;

                for j in 0..n_objects {
                    if j == i {
                        continue;
                    }
                    let diff = pos_i - all_positions[j];
                    let dist = diff.norm();

                    if dist < separation {
                        sep += diff / (dist + 1e-9);
                    }

                    if dist < neighbor_radius {
                        align += all_velocities[j];
                        coh += all_positions[j];
                        neighbors += 1;
                    }
                }

                if neighbors > 0 {
                    align /= neighbors as f64;
                    coh /= neighbors as f64;
                    coh = (coh - pos_i) * 0.1;
                }

                acc[i] = sep * separation + align * alignment + coh * cohesion;
            }

            for i in 0..n_objects {
                let mut vel = all_velocities[i] + acc[i];
                let speed = vel.norm();
                if speed > max_speed {
                    vel *= max_speed / speed;
                }
                all_velocities[i] = vel;
                all_positions[i] = (all_positions[i] + vel * dt).map(|v| v.clamp(-1.0, 1.0));
            }
        }

        finite_or_zero(all_positions[queried])
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
        let e = Swarm;
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
        let e = Swarm;
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
        let e = Swarm;
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
        let e = Swarm;
        let p = params(4, json!({}));
        let pos = e.position(1.0, 10, &p);
        assert!(pos.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn swarm_deterministic() {
        let e = Swarm;
        let p = params(4, json!({"seed": 99}));
        for i in 0..4 {
            assert_eq!(e.position(1.5, i, &p), e.position(1.5, i, &p));
        }
    }

    #[test]
    fn swarm_negative_t_gives_initial_positions() {
        let e = Swarm;
        let p = params(4, json!({"seed": 42}));
        let pos = e.position(-1.0, 0, &p);
        assert_eq!(pos, e.position(0.0, 0, &p));
    }
}
