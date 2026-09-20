use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::Vector3;

/// Follow-the-leader étendu — steering behaviors (Reynolds).
///
/// Une cible animée (cercle de rayon `target_radius`, `target_speed`
/// révolutions par `duration`, altitude `target_z`) est poursuivie,
/// fuie, orbitée ou abordée par chaque objet selon `mode` :
///
/// - `follow`  : seek classique, arrêt à `distance` (comportement V1)
/// - `pursue`  : interception — vise la position prédite à `t + lookahead`
/// - `evade`   : fuite devant le point prédit, confiné par `bounds`
/// - `orbit`   : carrousel — chaque objet poursuit son slot sur l'anneau
///   mobile à `distance`, phases réparties, `orbit_speed`/`orbit_dir`
/// - `arrive`  : seek avec décélération dans `arrive_radius` — sans
///   dépassement
///
/// Le déplacement passe par un vecteur vitesse lissé (`responsiveness` =
/// 1 → instantané, valeurs basses → inertie lourde), capé à `speed`.
/// Déterministe : re-simulation depuis t=0, RNG seedé par objet.
pub struct Follow;

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Follow,
    Pursue,
    Evade,
    Orbit,
    Arrive,
}

fn get_f64(params: &EngineParams, key: &str, default: f64) -> f64 {
    params
        .extra
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

fn target_at(t: f64, radius: f64, speed: f64, z: f64, duration: f64) -> Vector3<f64> {
    let angle = 2.0 * std::f64::consts::PI * speed * t / duration.max(1e-9);
    Vector3::new(radius * angle.cos(), radius * angle.sin(), z)
}

impl Engine for Follow {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let mode = match params
            .extra
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("follow")
        {
            "pursue" => Mode::Pursue,
            "evade" => Mode::Evade,
            "orbit" => Mode::Orbit,
            "arrive" => Mode::Arrive,
            _ => Mode::Follow,
        };
        let speed = get_f64(params, "speed", 0.5).max(0.0);
        let distance = get_f64(params, "distance", 0.3).max(0.0);
        let lookahead = get_f64(params, "lookahead", 0.4);
        let arrive_radius = get_f64(params, "arrive_radius", 0.6).max(distance);
        let responsiveness = get_f64(params, "responsiveness", 1.0).clamp(0.0, 1.0);
        let target_radius = get_f64(params, "target_radius", 0.5);
        let target_speed = get_f64(params, "target_speed", 1.0);
        let target_z = get_f64(params, "target_z", 0.0);
        let orbit_dir = if get_f64(params, "orbit_dir", 1.0) >= 0.0 {
            1.0
        } else {
            -1.0
        };
        // Vitesse angulaire de l'anneau (m/s tangentiels) — découplée de
        // `speed` pour que l'objet garde de la marge pour rattraper son slot
        let orbit_speed = get_f64(params, "orbit_speed", 0.3);
        let init_radius = get_f64(params, "init_radius", 0.5).max(0.0);
        let bounds = get_f64(params, "bounds", 1.0).max(0.0);
        let containment = get_f64(params, "containment", 1.0);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        // RNG par objet — positions initiales distinctes
        let mut rng = SimpleRng::new(seed.wrapping_mul(31).wrapping_add(object_index as u64));
        let mut pos = Vector3::new(
            rng.uniform(-init_radius, init_radius),
            rng.uniform(-init_radius, init_radius),
            rng.uniform(0.0, init_radius * 0.2),
        );
        let mut vel = Vector3::zeros();

        // Phase par objet pour la répartition sur l'anneau en mode orbit
        let orbit_phase = if params.n_objects > 1 {
            2.0 * std::f64::consts::PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let dt = 1.0 / params.fps;
        let n_steps = (t * params.fps) as i32;

        for step in 0..n_steps {
            let tau = step as f64 * dt;
            let target = target_at(tau, target_radius, target_speed, target_z, params.duration);
            let predicted = target_at(
                tau + lookahead,
                target_radius,
                target_speed,
                target_z,
                params.duration,
            );
            let diff = target - pos;
            let dist = diff.norm();

            let desired = match mode {
                Mode::Follow => {
                    if dist > distance {
                        diff / (dist + 1e-9) * speed
                    } else {
                        Vector3::zeros()
                    }
                }
                Mode::Pursue => {
                    let d = predicted - pos;
                    let dn = d.norm();
                    if dn > 1e-9 {
                        d / dn * speed
                    } else {
                        Vector3::zeros()
                    }
                }
                Mode::Evade => {
                    let d = pos - predicted;
                    let dn = d.norm();
                    if dn > 1e-9 {
                        d / dn * speed
                    } else {
                        Vector3::new(orbit_dir * speed, 0.0, 0.0)
                    }
                }
                Mode::Orbit => {
                    // Chaque objet poursuit son propre slot sur l'anneau
                    // mobile (phases réparties) — carrousel autour de la cible
                    let omega = orbit_dir * orbit_speed / distance.max(0.05);
                    let ring = Vector3::new(
                        target.x + distance * (orbit_phase + omega * tau).cos(),
                        target.y + distance * (orbit_phase + omega * tau).sin(),
                        target.z,
                    );
                    (ring - pos) * (containment * 4.0).max(1.0)
                }
                Mode::Arrive => {
                    if dist > 1e-9 {
                        let s = if dist < arrive_radius {
                            speed * (dist / arrive_radius)
                        } else {
                            speed
                        };
                        diff / dist * s
                    } else {
                        Vector3::zeros()
                    }
                }
            };

            vel += (desired - vel) * responsiveness;
            let vn = vel.norm();
            if vn > speed {
                vel *= speed / vn;
            }
            pos += vel * dt;

            // Confinement doux (surtout utile en evade)
            if mode == Mode::Evade {
                for axis in 0..2 {
                    let over = pos[axis].abs() - bounds;
                    if over > 0.0 {
                        pos[axis] -= over * containment.min(1.0) * pos[axis].signum();
                    }
                }
            }
        }

        pos
    }

    fn name(&self) -> &str {
        "follow"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value, n: usize) -> EngineParams {
        EngineParams {
            n_objects: n,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    fn dist_to_target(pos: Vector3<f64>, t: f64, params: &EngineParams) -> f64 {
        let target = target_at(
            t,
            params
                .extra
                .get("target_radius")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.5),
            params
                .extra
                .get("target_speed")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0),
            params
                .extra
                .get("target_z")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            params.duration,
        );
        (pos - target).norm()
    }

    #[test]
    fn follow_converges_to_standoff_distance() {
        let e = Follow;
        // speed > vitesse tangentielle de la cible (0.5·2π·0.5/4 ≈ 0.39)
        let p = params(
            json!({"mode": "follow", "distance": 0.2, "speed": 1.5,
                   "target_speed": 0.5}),
            1,
        );
        let pos = e.position(3.0, 0, &p);
        let d = dist_to_target(pos, 3.0, &p);
        assert!(
            d < 0.45,
            "follow devrait tenir la distance de standoff, dist={d}"
        );
    }

    #[test]
    fn objects_have_distinct_trajectories() {
        let e = Follow;
        let p = params(json!({"seed": 7}), 4);
        let a = e.position(0.5, 0, &p);
        let b = e.position(0.5, 1, &p);
        assert!(
            (a - b).norm() > 1e-6,
            "deux objets ne doivent pas être superposés"
        );
    }

    #[test]
    fn pursue_leads_the_target() {
        let e = Follow;
        let p = params(
            json!({"mode": "pursue", "speed": 2.0, "lookahead": 0.5, "init_radius": 0.1}),
            1,
        );
        // Pursue vise la position prédite : l'objet se stabilise près du
        // point lookahead (il devance la cible, il ne traîne pas derrière)
        let t = 3.5;
        let pos = e.position(t, 0, &p);
        let predicted = target_at(t + 0.5, 0.5, 1.0, 0.0, p.duration);
        let d_pred = (pos - predicted).norm();
        assert!(
            d_pred < 0.25,
            "pursue devrait suivre le point prédit, dist={d_pred}"
        );
    }

    #[test]
    fn evade_stays_away_from_target() {
        let e = Follow;
        let p = params(
            json!({"mode": "evade", "speed": 1.0, "lookahead": 0.3, "init_radius": 0.2,
                   "bounds": 1.0, "containment": 1.0}),
            1,
        );
        // La cible tourne à rayon 0.5 ; l'objet fuit → il doit être plus
        // loin d'elle que sa position initiale ne le laisserait
        let pos = e.position(2.0, 0, &p);
        let d = dist_to_target(pos, 2.0, &p);
        assert!(d > 0.4, "evade devrait garder ses distances, dist={d}");
        // ... tout en restant confiné
        assert!(pos.x.abs() <= 1.05 && pos.y.abs() <= 1.05);
    }

    #[test]
    fn orbit_keeps_ring_distance() {
        let e = Follow;
        let p = params(
            json!({"mode": "orbit", "distance": 0.4, "speed": 1.5,
                   "orbit_speed": 0.3, "target_speed": 0.5,
                   "init_radius": 0.05, "containment": 1.0}),
            2,
        );
        let t = 3.0;
        for i in 0..2 {
            let pos = e.position(t, i, &p);
            let d = dist_to_target(pos, t, &p);
            assert!(
                (d - 0.4).abs() < 0.15,
                "objet {i} devrait être sur l'anneau r=0.4, dist={d}"
            );
        }
    }

    #[test]
    fn arrive_decelerates_near_target() {
        let e = Follow;
        let p = params(
            json!({"mode": "arrive", "speed": 2.0, "arrive_radius": 0.5,
                   "init_radius": 0.05}),
            1,
        );
        // La cible bouge → lag stationnaire = arrive_radius·v_cible/v_max,
        // mais l'objet reste collé à la cible sans dépassement
        let pos = e.position(3.0, 0, &p);
        let d = dist_to_target(pos, 3.0, &p);
        assert!(
            d < 0.3,
            "arrive devrait converger doucement vers la cible, dist={d}"
        );
    }

    #[test]
    fn deterministic_same_inputs() {
        let e = Follow;
        let p = params(json!({"mode": "orbit", "seed": 99}), 3);
        let a = e.position(1.5, 2, &p);
        let b = e.position(1.5, 2, &p);
        assert_eq!(a, b);
    }
}
