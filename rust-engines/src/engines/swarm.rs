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
//!
//! Extensions façon "boid brain" (toutes à 0/off par défaut) :
//!   k_neighbors      voisinage = k plus proches (0 = rayon)     (défaut 0)
//!   wander           cap aléatoire persistant par agent (poids)  (défaut 0)
//!   wander_freq      fréquence du wander, Hz                     (défaut 0.4)
//!   min_speed        vitesse min — vol perpétuel                 (défaut 0)
//!   max_acc          accélération max (0 = off)                  (défaut 0)
//!   max_turn         virage max rad/s — virages inclinés         (défaut 0)
//!   leader_weight    ressort vers l'origine locale (= leader
//!                    sous anchor:follow)                        (défaut 0)
//!   leader_standoff  distance préférée au leader (coquille)      (défaut 0)
//!   inline_weight    file indienne — l'agent i suit i−1,
//!                    l'agent 0 suit le leader                    (défaut 0)
//!   inline_standoff  espacement dans la file                     (défaut 0.3)
//!   bounds           enceinte locale — clamp ±bounds par axe     (défaut 1.0)

use crate::engines::{
    finite_or_zero, sim_window, Engine, EngineParams, MAX_OBJECTS, SIM_REWIND_EPS,
};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;
use std::sync::{Arc, Mutex};

/// État simulé du troupeau — conservé entre appels (audit B1).
/// `pub(crate)` : `EngineStateStore` le partage entre recompiles
/// (warm-start au hot-swap).
pub(crate) struct SwarmCache {
    /// Temps déjà couvert par l'intégration.
    sim_t: f64,
    n_objects: usize,
    /// `params.n_objects` vu au dernier init — la population SIMULÉE peut
    /// dépasser `declared` (grow monotone sur object_index supérieur) :
    /// la re-init ne se déclenche que sur changement du param déclaré.
    declared: usize,
    /// `pub(crate)` : le test warm-start du compiler y injecte un marqueur.
    pub(crate) positions: Vec<Vector3<f64>>,
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
            declared: 0,
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
/// `with_cache` injecte un cache partagé (`EngineStateStore`) — la
/// nouvelle instance d'un hot-swap adopte l'état de la précédente.
#[derive(Default)]
pub struct Swarm {
    cache: Arc<Mutex<SwarmCache>>,
}

impl Swarm {
    pub(crate) fn with_cache(cache: Arc<Mutex<SwarmCache>>) -> Self {
        Self { cache }
    }
}

/// Direction de wander lisse par agent — fonction pure de `t` (hash + sommes
/// de sinus comme `jitter`), donc déterministe et rewind-safe : re-simuler
/// depuis t=0 redonne exactement la même trajectoire.
fn wander_dir(i: usize, t: f64, freq: f64, seed: u64) -> Vector3<f64> {
    let h =
        |n: f64| (((i as f64) * 17.0 + seed as f64 * 12.9898 + n).sin() * 43758.5453).fract() * TAU;
    Vector3::new(
        (TAU * freq * t + h(0.0)).sin() + 0.5 * (TAU * freq * t * 1.3 + h(3.0)).sin(),
        (TAU * freq * t * 1.1 + h(1.0)).sin() + 0.5 * (TAU * freq * t * 0.7 + h(4.0)).sin(),
        (TAU * freq * t * 0.9 + h(2.0)).sin() + 0.5 * (TAU * freq * t * 1.7 + h(5.0)).sin(),
    )
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
        let get = |k: &str, d: f64| params.extra.get(k).and_then(|v| v.as_f64()).unwrap_or(d);
        // Voisinage k-plus-proches (0 = rayon fixe, comportement V1).
        let k_neighbors = get("k_neighbors", 0.0).max(0.0) as usize;
        // Wander — cap aléatoire persistant : sans lui le troupeau converge
        // vers un équilibre géométrique (tore/boule) et s'y fige.
        let wander = get("wander", 0.0);
        let wander_freq = get("wander_freq", 0.4).max(0.0);
        // Contraintes de vol — banking au lieu de snaps instantanés.
        let min_speed = get("min_speed", 0.0).max(0.0);
        let max_acc = get("max_acc", 0.0).max(0.0);
        let max_turn = get("max_turn", 0.0).max(0.0);
        // Leader — ressort vers la coquille `standoff` autour de l'origine
        // locale (la position émise du leader sous anchor:follow).
        let leader_weight = get("leader_weight", 0.0);
        let leader_standoff = get("leader_standoff", 0.0).max(0.0);
        // File indienne — l'agent i suit l'agent i−1, l'agent 0 suit le
        // leader (origine). Formation V/ligne émergente.
        let inline_weight = get("inline_weight", 0.0);
        let inline_standoff = get("inline_standoff", 0.3).max(0.0);
        // Enceinte locale — clamp ±bounds par axe (avant transform monde :
        // scale/shift du move s'appliquent ensuite). 1.0 = le cube historique.
        let bounds = get("bounds", 1.0).max(0.01);

        // object_index peut dépasser n_objects (hot-swap d'osc_id) : on dimensionne
        // le troupeau pour l'inclure plutôt que de paniquer. MAX_OBJECTS borne le
        // tout ; si object_index ≥ MAX_OBJECTS on retourne le dernier agent
        // (déterministe, fini) plutôt que de crasher.
        // `declared` = le param Objects (stable dans un compile) ;
        // `need` = la couverture requise CETTE eval (≥ object_index+1).
        // La sim grandit de façon MONOTONE : un object_index < c.n_objects
        // ne rétrécit pas la population — sinon chaque objet ferait varier
        // n → re-init + resim par objet par frame (63 resims à 63 pistes →
        // worker gelé → stale-kill ; observé en live).
        let declared = params.n_objects.max(1);
        let need = declared
            .max(object_index.saturating_add(1))
            .min(MAX_OBJECTS);
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        // Ré-init si : seek arrière (rewind), param Objects modifié
        // (hot-swap), ou objet jamais vu au-delà de la population (grow).
        // Rewind : conserver la taille courante (elle peut couvrir des
        // objets vus avant — un shrink ici referait le re-init par objet).
        if t < c.sim_t - SIM_REWIND_EPS {
            let n = c.n_objects.max(need);
            c.declared = declared;
            c.init(n, seed);
        } else if c.declared != declared || c.n_objects < need {
            c.declared = declared;
            c.init(need, seed);
        }
        let n_objects = c.n_objects;
        let queried = object_index.min(n_objects - 1);
        let k_take = if k_neighbors == 0 {
            0
        } else {
            k_neighbors.min(n_objects.saturating_sub(1)).max(1)
        };

        let cost = (n_objects as u64).saturating_mul(n_objects as u64);
        let (n_steps, dt, new_t) = sim_window(c.sim_t, t, params.fps, cost);
        let sim_t0 = c.sim_t;
        // Buffer réutilisé pour la sélection des k voisins — évite une alloc
        // par agent par pas.
        let mut scratch: Vec<(f64, usize)> = Vec::with_capacity(n_objects);

        for step in 0..n_steps {
            let tau = sim_t0 + step as f64 * dt;
            for i in 0..n_objects {
                let pos_i = c.positions[i];
                let mut sep = Vector3::zeros();
                let mut align = Vector3::zeros();
                let mut coh = Vector3::zeros();
                let mut neighbors = 0;

                if k_take > 0 {
                    // k plus proches — la densité locale s'adapte toute seule
                    // (pas de trou dans le voisinage quand le troupeau se dilate).
                    scratch.clear();
                    for (j, &pos_j) in c.positions.iter().enumerate() {
                        if j == i {
                            continue;
                        }
                        let diff = pos_i - pos_j;
                        let dist = diff.norm();
                        if dist < separation {
                            sep += diff / (dist + 1e-9);
                        }
                        scratch.push((dist, j));
                    }
                    scratch.sort_unstable_by(|a, b| {
                        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
                    });
                    for &(_, j) in scratch.iter().take(k_take) {
                        align += c.velocities[j];
                        coh += c.positions[j];
                        neighbors += 1;
                    }
                } else {
                    for (j, &pos_j) in c.positions.iter().enumerate() {
                        if j == i {
                            continue;
                        }
                        let diff = pos_i - pos_j;
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
                }

                if neighbors > 0 {
                    align /= neighbors as f64;
                    coh /= neighbors as f64;
                    coh = (coh - pos_i) * 0.1;
                }

                let mut acc = sep * separation + align * alignment + coh * cohesion;

                if wander != 0.0 {
                    acc += wander_dir(i, tau, wander_freq, seed) * wander;
                }

                if leader_weight != 0.0 {
                    // Ressort vers la coquille `standoff` autour de l'origine —
                    // standoff 0 = attraction pure vers le point-leader.
                    let d = pos_i.norm();
                    acc += pos_i * (-(d - leader_standoff) * leader_weight / (d + 1e-9));
                }

                if inline_weight != 0.0 && n_objects > 1 {
                    // File indienne — i suit i−1 ; l'agent 0 suit l'origine
                    // (le leader sous anchor:follow).
                    let ahead = if i == 0 {
                        Vector3::zeros()
                    } else {
                        c.positions[i - 1]
                    };
                    let to_ahead = ahead - pos_i;
                    let d = to_ahead.norm();
                    acc += to_ahead * ((d - inline_standoff) * inline_weight / (d + 1e-9));
                }

                c.acc[i] = acc;
            }

            for i in 0..n_objects {
                // Kick d'accélération normalisé au pas nominal (60 Hz) :
                // sans ça la dynamique dépend du param fps (2× les steps =
                // 2× plus de kicks par seconde simulée).
                let old = c.velocities[i];
                let mut vel = old + c.acc[i] * (dt * 60.0);

                if max_acc > 0.0 {
                    let dv = vel - old;
                    let m = dv.norm();
                    let cap = max_acc * dt * 60.0;
                    if m > cap {
                        vel = old + dv * (cap / m);
                    }
                }

                if max_turn > 0.0 {
                    let os = old.norm();
                    let ns = vel.norm();
                    if os > 1e-9 && ns > 1e-9 {
                        let od = old / os;
                        let nd = vel / ns;
                        let angle = od.dot(&nd).clamp(-1.0, 1.0).acos();
                        let max_a = max_turn * dt;
                        if angle > max_a {
                            // Slerp linéaire vers la direction désirée,
                            // bornée au virage max du pas.
                            let k = max_a / angle;
                            let dir = (od * (1.0 - k) + nd * k).normalize();
                            vel = dir * ns;
                        }
                    }
                }

                let speed = vel.norm();
                if speed > max_speed {
                    vel *= max_speed / speed;
                } else if speed < min_speed && speed > 1e-9 {
                    vel *= min_speed / speed;
                }
                c.velocities[i] = vel;
                c.positions[i] = (c.positions[i] + vel * dt).map(|v| v.clamp(-bounds, bounds));
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

    #[test]
    fn swarm_leader_weight_pulls_toward_origin() {
        // leader_weight > 0 → le troupeau doit se resserrer sur l'origine
        // locale (= le leader sous anchor:follow), vs sans attraction.
        let e = Swarm::default();
        let p = params(
            8,
            json!({"separation": 0.1, "alignment": 0.0, "cohesion": 0.0,
                   "leader_weight": 3.0, "leader_standoff": 0.2,
                   "max_speed": 1.0, "seed": 7}),
        );
        let positions: Vec<Vector3<f64>> = (0..8).map(|i| e.position(2.5, i, &p)).collect();
        let mean_d: f64 = positions.iter().map(|v| v.norm()).sum::<f64>() / positions.len() as f64;
        assert!(
            mean_d < 0.45,
            "leader_weight devrait rapprocher du standoff 0.2, mean={mean_d}"
        );
    }

    #[test]
    fn swarm_leader_weight_negative_scatters() {
        // leader_weight < 0 → dispersion loin du leader (mode prédateur).
        let e = Swarm::default();
        let p = params(
            8,
            json!({"separation": 0.1, "alignment": 0.0, "cohesion": 0.0,
                   "leader_weight": -2.0, "max_speed": 1.0, "seed": 7}),
        );
        let positions: Vec<Vector3<f64>> = (0..8).map(|i| e.position(2.0, i, &p)).collect();
        let mean_d: f64 = positions.iter().map(|v| v.norm()).sum::<f64>() / positions.len() as f64;
        assert!(
            mean_d > 0.5,
            "leader_weight négatif devrait disperser, mean={mean_d}"
        );
    }

    #[test]
    fn swarm_wander_keeps_agents_unsettled() {
        // wander > 0 : perturbation perpétuelle — les agents ne se figent
        // jamais même sans interactions.
        let e = Swarm::default();
        let p = params(
            4,
            json!({"separation": 0.0, "alignment": 0.0, "cohesion": 0.0,
                   "wander": 0.5, "min_speed": 0.2, "max_speed": 1.0, "seed": 42}),
        );
        // Deux lectures éloignées : les agents continuent de bouger.
        let a: Vec<Vector3<f64>> = (0..4).map(|i| e.position(3.0, i, &p)).collect();
        let b: Vec<Vector3<f64>> = (0..4).map(|i| e.position(5.0, i, &p)).collect();
        for i in 0..4 {
            assert!(
                (b[i] - a[i]).norm() > 1e-3,
                "agent {i} figé malgré wander: {a:?} -> {b:?}"
            );
        }
    }

    #[test]
    fn swarm_min_speed_prevents_stall() {
        // min_speed > 0 : la vitesse reste ≥ min_speed — aucun agent ne
        // s'arrête (contrainte de vol Blender).
        let e = Swarm::default();
        let p = params(
            4,
            json!({"separation": 0.0, "alignment": 0.0, "cohesion": 0.0,
                   "min_speed": 0.3, "max_speed": 1.0, "seed": 5}),
        );
        let a: Vec<Vector3<f64>> = (0..4).map(|i| e.position(2.0, i, &p)).collect();
        let b: Vec<Vector3<f64>> = (0..4).map(|i| e.position(3.0, i, &p)).collect();
        for i in 0..4 {
            assert!(
                (b[i] - a[i]).norm() > 1e-4,
                "agent {i} devrait garder une vitesse résiduelle"
            );
        }
    }

    #[test]
    fn swarm_inline_chains_agents() {
        // inline_weight : l'agent i suit i−1 → distances entre voisins
        // consécutifs proches de inline_standoff, pas de collapse global.
        let e = Swarm::default();
        let p = params(
            6,
            json!({"separation": 0.0, "alignment": 0.0, "cohesion": 0.0,
                   "inline_weight": 3.0, "inline_standoff": 0.3,
                   "max_speed": 1.0, "seed": 9}),
        );
        let positions: Vec<Vector3<f64>> = (0..6).map(|i| e.position(3.0, i, &p)).collect();
        let gaps: Vec<f64> = (1..6)
            .map(|i| (positions[i] - positions[i - 1]).norm())
            .collect();
        let mean_gap: f64 = gaps.iter().sum::<f64>() / gaps.len() as f64;
        assert!(
            (mean_gap - 0.3).abs() < 0.25,
            "les espacements en file devraient ~0.3, mean_gap={mean_gap}"
        );
    }

    #[test]
    fn swarm_bounds_clamps_spread() {
        // bounds réduit : même sous forte répulsion + wander, aucun agent
        // ne dépasse ±bounds par axe. Comparaison : bounds large → le
        // nuage s'étale davantage.
        let tight = Swarm::default();
        let p_tight = params(
            8,
            json!({"separation": 2.0, "wander": 0.6, "min_speed": 0.3,
                   "max_speed": 2.0, "bounds": 0.4, "seed": 13}),
        );
        for i in 0..8 {
            let p = tight.position(3.0, i, &p_tight);
            for axis in 0..3 {
                assert!(
                    p[axis].abs() <= 0.4 + 1e-9,
                    "agent {i} axe {axis} hors des murs: {}",
                    p[axis]
                );
            }
        }
        let wide = Swarm::default();
        let p_wide = params(
            8,
            json!({"separation": 2.0, "wander": 0.6, "min_speed": 0.3,
                   "max_speed": 2.0, "bounds": 1.8, "seed": 13}),
        );
        let spread = |e: &Swarm, p: &EngineParams| -> f64 {
            let pos: Vec<Vector3<f64>> = (0..8).map(|i| e.position(3.0, i, p)).collect();
            let center: Vector3<f64> = pos.iter().sum::<Vector3<f64>>() / 8.0;
            pos.iter().map(|v| (v - center).norm()).fold(0.0, f64::max)
        };
        assert!(
            spread(&wide, &p_wide) > spread(&tight, &p_tight),
            "bounds large devrait permettre plus d'étalement"
        );
    }

    #[test]
    fn swarm_extensions_are_deterministic() {
        // Wander + leader + inline restent des fonctions déterministes
        // de t (re-sim identique).
        let e = Swarm::default();
        let p = params(
            5,
            json!({"wander": 0.4, "leader_weight": 1.0, "inline_weight": 1.0,
                   "k_neighbors": 3, "min_speed": 0.1, "max_turn": 2.0,
                   "max_acc": 3.0, "seed": 11}),
        );
        for i in 0..5 {
            let a = e.position(2.0, i, &p);
            let b = e.position(2.0, i, &p);
            assert_eq!(a, b, "agent {i}: non déterministe");
        }
    }

    #[test]
    fn swarm_with_cache_warm_starts() {
        // Warm-start hot-swap : une seconde instance partageant le cache
        // adopte sim_t/positions/vélocités — pas de re-init, pas de resim.
        let cache = Arc::new(Mutex::new(SwarmCache::default()));
        let p = params(4, json!({"seed": 42}));

        // A pousse la sim jusqu'à t=2.
        let a = Swarm::with_cache(cache.clone());
        let pos_a = a.position(2.0, 0, &p);
        assert!((cache.lock().unwrap().sim_t - 2.0).abs() < 1e-9);

        // B partage le cache : même t → fenêtre nulle → même état lu,
        // aucune re-simulation (sinon init() repartirait sur le cercle).
        let b = Swarm::with_cache(cache.clone());
        let pos_b = b.position(2.0, 0, &p);
        assert_eq!(pos_a, pos_b);

        // Marqueur : l'état injecté est lu tel quel (fenêtre nulle) —
        // un cache froid l'aurait écrasé par l'init cercle.
        cache.lock().unwrap().positions[0] = Vector3::new(9.9, 9.9, 9.9);
        let marked = b.position(2.0, 0, &p);
        assert!((marked - Vector3::new(9.9, 9.9, 9.9)).norm() < 1e-9);
        let cold = Swarm::default();
        let pos_cold = cold.position(2.0, 0, &p);
        assert_ne!(pos_cold, marked, "un cache froid ignore le marqueur");
    }

    #[test]
    fn swarm_with_cache_reinits_on_n_change() {
        // n_objects différent au hot-swap (Objects changé) → re-init :
        // l'adoption ne doit jamais lire un tableau à la mauvaise taille.
        let cache = Arc::new(Mutex::new(SwarmCache::default()));
        let a = Swarm::with_cache(cache.clone());
        a.position(1.0, 0, &params(4, json!({"seed": 42})));
        assert_eq!(cache.lock().unwrap().n_objects, 4);

        let b = Swarm::with_cache(cache.clone());
        let _ = b.position(1.0, 5, &params(7, json!({"seed": 42})));
        assert_eq!(
            cache.lock().unwrap().n_objects,
            7,
            "n changé → re-init à la nouvelle taille"
        );
    }
}

#[test]
fn swarm_n_objects_mismatch_grows_monotonically() {
    // Régression : node Objects déclaré à 1 alors que le move pilote 63
    // objets (slot injecté sans sync). La population doit grandir de
    // façon MONOTONE vers 63 puis rester stable — l'ancien comportement
    // recalculait n par objet → chaque object_index < n déclenchait un
    // re-init + resim complet (63 resims/frame → worker gelé →
    // supervisor stale-kill, observé live).
    let cache = Arc::new(Mutex::new(SwarmCache::default()));
    let e = Swarm::with_cache(cache.clone());
    let params = EngineParams {
        n_objects: 1,
        duration: 4.0,
        fps: 60.0,
        extra: serde_json::json!({}),
    };
    for i in 0..63 {
        let _ = e.position(0.05, i, &params);
    }
    assert_eq!(cache.lock().unwrap().n_objects, 63);
    // Un objet seul au rang suivant NE DOIT PAS rétrécir la sim —
    // sous l'ancien code il re-init à n=1.
    let _ = e.position(0.10, 0, &params);
    assert_eq!(
        cache.lock().unwrap().positions.len(),
        63,
        "la population simulée ne doit pas rétrécir sur un object_index bas"
    );
}
