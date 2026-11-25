//! PoseRamp — rampe d'interpolation par objet entre deux endpoints
//! résolus au compile (design : docs/position-presets-design.md §5).
//!
//! L'engine est **pur et stateless** : il lit `resolved_from` /
//! `resolved_to` (arrays [x,y,z] par index local d'objet) cuits dans
//! `params.extra` par le compile — la résolution des références
//! (`live` / `pose:<name>`) est faite en amont via `PoseResolver`,
//! jamais ici. `position(t, obj) = lerp(from[obj], to[obj], easing(t/T))`
//! clampé à [0,1] : au-delà de duration la cible est tenue exactement
//! (le hold de fin de oneshot écrit la pose au centimètre près).

use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct PoseRamp;

fn read_pos(params: &EngineParams, key: &str, obj: usize) -> Option<Vector3<f64>> {
    params
        .extra
        .get(key)
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.get(obj))
        .and_then(|v| v.as_array())
        .and_then(|xyz| {
            if xyz.len() >= 3 {
                Some(Vector3::new(
                    xyz[0].as_f64().unwrap_or(0.0),
                    xyz[1].as_f64().unwrap_or(0.0),
                    xyz[2].as_f64().unwrap_or(0.0),
                ))
            } else {
                None
            }
        })
}

impl Engine for PoseRamp {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        // Endpoint manquant pour cet objet (graphe malformé — la résolution
        // normale produit des arrays complets) : repli sur l'autre endpoint,
        // l'objet ne bouge pas. Jamais de [0,0,0] téléporté silencieusement
        // si un seul côté est connu.
        let to = read_pos(params, "resolved_to", object_index);
        let from = read_pos(params, "resolved_from", object_index).or(to);
        let to = to.or(from);
        let (Some(from), Some(to)) = (from, to) else {
            return Vector3::zeros();
        };

        let easing = params
            .extra
            .get("easing")
            .and_then(|v| v.as_str())
            .unwrap_or("smooth");
        // Clamp [0,1] — même justification que Linear/Converge (phase
        // offsets, PingPong, speed) : la cible est tenue, pas extrapolée.
        let tn = (t / params.duration.max(1e-9)).clamp(0.0, 1.0);
        let k = match easing {
            "linear" => tn,
            "ease_in" => tn * tn,
            "ease_out" => 1.0 - (1.0 - tn) * (1.0 - tn),
            // smoothstep — départ et arrivée à vélocité nulle (défaut musical)
            _ => 3.0 * tn * tn - 2.0 * tn * tn * tn,
        };

        from + (to - from) * k
    }

    fn name(&self) -> &str {
        "poseramp"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(easing: &str) -> EngineParams {
        EngineParams {
            n_objects: 2,
            duration: 2.0,
            fps: 60.0,
            extra: json!({
                "easing": easing,
                "resolved_from": [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
                "resolved_to": [[4.0, 0.0, 0.0], [-2.0, 2.0, 0.0]],
            }),
        }
    }

    #[test]
    fn endpoints_exact() {
        let e = PoseRamp;
        let p = params("linear");
        assert_eq!(e.position(0.0, 0, &p), Vector3::new(0.0, 0.0, 0.0));
        // t = T → cible exacte (le hold écrit la pose au centimètre près)
        assert_eq!(e.position(2.0, 0, &p), Vector3::new(4.0, 0.0, 0.0));
        assert_eq!(e.position(2.0, 1, &p), Vector3::new(-2.0, 2.0, 0.0));
    }

    #[test]
    fn linear_midpoint() {
        let e = PoseRamp;
        let p = params("linear");
        assert_eq!(e.position(1.0, 0, &p), Vector3::new(2.0, 0.0, 0.0));
    }

    #[test]
    fn smooth_midpoint_is_half_but_eased_elsewhere() {
        let e = PoseRamp;
        let p = params("smooth");
        // smoothstep(0.5) = 0.5 — le milieu est invariant
        assert_eq!(e.position(1.0, 0, &p), Vector3::new(2.0, 0.0, 0.0));
        // mais à t=0.25 (tn=0.125) smoothstep < linéaire — départ doux
        let early = e.position(0.25, 0, &p).x;
        let linear_early = 4.0 * 0.125;
        assert!(early < linear_early, "smooth doit être en retard au départ");
    }

    #[test]
    fn clamped_beyond_duration() {
        let e = PoseRamp;
        let p = params("linear");
        assert_eq!(e.position(99.0, 0, &p), Vector3::new(4.0, 0.0, 0.0));
        assert_eq!(e.position(-5.0, 0, &p), Vector3::new(0.0, 0.0, 0.0));
    }

    #[test]
    fn missing_endpoints_no_jump() {
        // Array absente (graphe malformé) — pas de téléportation [0,0,0]
        // si l'autre côté est connu.
        let e = PoseRamp;
        let p = EngineParams {
            n_objects: 1,
            duration: 2.0,
            fps: 60.0,
            extra: json!({"resolved_to": [[3.0, 3.0, 3.0]]}),
        };
        assert_eq!(e.position(0.0, 0, &p), Vector3::new(3.0, 3.0, 3.0));
    }
}
