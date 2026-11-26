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
//!   avoid_strength     répulseur externe — force/d²              (défaut 0 = off)
//!   avoid_radius       portée du répulseur externe               (défaut 0.5)
//!   avoid_x/y/z        position du répulseur (repère local)      (défaut origine)
//!   avoid_object       index objet → position LIVE via
//!                      `external_positions` (override avoid_xyz)

use crate::engines::{
    finite_or_zero, sim_window, Engine, EngineParams, MAX_OBJECTS, SIM_REWIND_EPS,
};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;
use std::sync::{Arc, Mutex};

/// État simulé de l'essaim — conservé entre appels (audit B1).
pub(crate) struct AvoidanceCache {
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

/// Positions d'objets externes vues dans le repère LOCAL du move —
/// remplies par le worker à chaque frame (inverse du move_transform
/// appliqué aux positions canoniques émises). Permet aux engines de
/// réagir à un objet animé par un autre move (évitement, poursuite).
pub type ExternalPositions = Arc<std::sync::RwLock<std::collections::HashMap<usize, Vector3<f64>>>>;

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Avoidance {
    cache: Arc<Mutex<AvoidanceCache>>,
    /// Répulseur live : index objet → position en repère local.
    /// Map vide (défaut) → `avoid_object` retombe sur `avoid_point`.
    external: ExternalPositions,
}

impl Avoidance {
    /// Cache partagé via `EngineStateStore` — warm-start au hot-swap.
    pub(crate) fn with_cache(cache: Arc<Mutex<AvoidanceCache>>) -> Self {
        Self {
            cache,
            external: ExternalPositions::default(),
        }
    }

    /// Canal positions externes (chemin live — move worker).
    pub(crate) fn with_external(mut self, external: ExternalPositions) -> Self {
        self.external = external;
        self
    }
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
        // Répulseur externe — `avoid_object` : position live d'un objet
        // animé (repère local via `external_positions`), sinon `avoid_point`.
        let avoid_strength = params
            .extra
            .get("avoid_strength")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let avoid_radius = params
            .extra
            .get("avoid_radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .max(0.0);
        let avoid_point = Vector3::new(
            params
                .extra
                .get("avoid_x")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            params
                .extra
                .get("avoid_y")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            params
                .extra
                .get("avoid_z")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
        );
        let avoid_object = params
            .extra
            .get("avoid_object")
            .and_then(|v| v.as_i64())
            .filter(|&o| o >= 0)
            .map(|o| o as usize);
        let repulsor = if avoid_strength != 0.0 {
            avoid_object
                .and_then(|o| {
                    self.external
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&o)
                        .copied()
                })
                .or(Some(avoid_point))
        } else {
            None
        };

        // `declared` = le param Objects (stable dans un compile) ;
        // `need` = la couverture requise CETTE eval (≥ object_index+1).
        // La sim grandit de façon MONOTONE : un object_index < c.n_objects
        // ne rétrécit pas la population — sinon chaque objet ferait varier
        // n → re-init + resim par objet par frame (worker gelé →
        // stale-kill ; même pathologie que swarm.rs).
        let declared = params.n_objects.max(1);
        let need = declared
            .max(object_index.saturating_add(1))
            .min(MAX_OBJECTS);

        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        // Rewind : conserver la taille courante. Hors rewind : ré-init
        // uniquement sur GROW — jamais sur `declared` seul (pendant le
        // crossfade d'un hot-swap, l'ancienne fn et la nouvelle partagent
        // ce cache avec des declared différents → un re-init ici ferait
        // alterner init(N)/init(M) à chaque eval = resim × objets × frames
        // → deassign à chaud = freeze → stale-kill ; même pathologie
        // que swarm.rs).
        if t < c.sim_t - SIM_REWIND_EPS {
            let n = c.n_objects.max(need);
            c.init(n, seed);
        } else if c.n_objects < need {
            c.init(need, seed);
        }
        let n_objects = c.n_objects;
        let queried = object_index.min(n_objects - 1);

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
                // Répulseur externe — même famille 1/d² ; sa position est
                // constante dans la fenêtre (rafraîchie par frame, pas par pas).
                if let Some(rep) = repulsor {
                    let diff = pos_i - rep;
                    let dist = diff.norm() + 1e-9;
                    if dist < avoid_radius {
                        f += (diff / dist) * (avoid_strength / (dist * dist));
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
    fn avoidance_with_cache_never_shrinks_on_declared_decrease() {
        // Régression : deassign à chaud — pendant le crossfade, l'ancienne
        // fn (Objects=60) et la nouvelle (30) partagent ce cache. Un
        // re-init sur shrink alternerait init(60)/init(30) à chaque eval
        // = resim × objets × frames → worker gelé → stale-kill.
        let cache = Arc::new(Mutex::new(AvoidanceCache::default()));
        let big = Avoidance::with_cache(cache.clone());
        let small = Avoidance::with_cache(cache.clone());
        let p60 = params(60, json!({"seed": 42}));
        let p30 = params(30, json!({"seed": 42}));
        big.position(1.0, 0, &p60);
        assert_eq!(cache.lock().unwrap().n_objects, 60);
        cache.lock().unwrap().positions[0] = Vector3::new(9.9, 9.9, 9.9);
        small.position(1.0, 0, &p30);
        {
            let c = cache.lock().unwrap();
            assert_eq!(c.n_objects, 60, "shrink interdit sur declared");
            assert_eq!(
                c.positions[0],
                Vector3::new(9.9, 9.9, 9.9),
                "pas de re-init"
            );
        }
        big.position(1.0, 0, &p60);
        assert_eq!(cache.lock().unwrap().n_objects, 60);
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

    #[test]
    fn avoidance_external_repulsor_point_pushes_agents_out() {
        // Répulseur statique à l'origine (anneau initial r=0.6 dedans) :
        // les agents doivent s'en écarter nettement vs sans répulseur.
        let e_off = Avoidance::default();
        let e_on = Avoidance::default();
        let p_off = params(8, json!({"damping": 0.98, "seed": 3}));
        let p_on = params(
            8,
            json!({"damping": 0.98, "seed": 3,
                   "avoid_strength": 3.0, "avoid_radius": 2.0,
                   "avoid_x": 0.0, "avoid_y": 0.0, "avoid_z": 0.0}),
        );
        let r_off: f64 = (0..8)
            .map(|i| e_off.position(2.0, i, &p_off).norm())
            .sum::<f64>()
            / 8.0;
        let r_on: f64 = (0..8)
            .map(|i| e_on.position(2.0, i, &p_on).norm())
            .sum::<f64>()
            / 8.0;
        assert!(
            r_on > r_off + 0.3,
            "le répulseur doit écarter les agents de l'origine: off={r_off} on={r_on}"
        );
    }

    #[test]
    fn avoidance_external_repulsor_object_reads_live_map() {
        // avoid_object : la position vient de `external_positions` — lue à
        // chaque eval. Trois cas sur des engines frais (même sim deterministe) :
        let p = json!({"damping": 0.98, "seed": 3,
                       "avoid_strength": 3.0, "avoid_radius": 2.0,
                       "avoid_x": 0.0, "avoid_y": 0.0, "avoid_z": 0.0,
                       "avoid_object": 7});
        let mean_r = |e: &Avoidance, p: &super::EngineParams| {
            (0..8).map(|i| e.position(2.0, i, p).norm()).sum::<f64>() / 8.0
        };
        // Référence : pas de répulseur.
        let e_ref = Avoidance::default();
        let r_ref = mean_r(&e_ref, &params(8, json!({"damping": 0.98, "seed": 3})));

        // a) objet 7 LOIN du champ → pas de répulsion ≈ référence.
        let ext_far = ExternalPositions::default();
        ext_far
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(7, Vector3::new(50.0, 50.0, 50.0));
        let e_far = Avoidance::default().with_external(ext_far);
        let r_far = mean_r(&e_far, &params(8, p.clone()));
        assert!(
            (r_far - r_ref).abs() < 0.1,
            "objet lointain → pas de répulsion: {r_far} vs ref {r_ref}"
        );

        // b) objet 7 au CENTRE → agents écartés.
        let ext_mid = ExternalPositions::default();
        ext_mid
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(7, Vector3::zeros());
        let e_mid = Avoidance::default().with_external(ext_mid);
        let r_mid = mean_r(&e_mid, &params(8, p.clone()));
        assert!(
            r_mid > r_ref + 0.3,
            "objet au centre → agents repoussés: {r_mid} vs ref {r_ref}"
        );

        // c) map VIDE → fallback avoid_xyz (= origine) → pareil que b).
        let e_empty = Avoidance::default().with_external(ExternalPositions::default());
        let r_empty = mean_r(&e_empty, &params(8, p));
        assert!(
            r_empty > r_ref + 0.3,
            "map vide → fallback avoid_xyz: {r_empty} vs ref {r_ref}"
        );
    }
}
