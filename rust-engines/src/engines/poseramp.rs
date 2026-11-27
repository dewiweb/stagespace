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

/// Courbes d'easing standard (Penner / easings.net — le vocabulaire des
/// consoles). `tn` est clampé [0,1] en amont : les courbes in/out restent
/// dans leurs bornes, `overshoot` dépasse volontairement la cible en
/// cours de rampe (arrivée élastique — c'est son propos).
fn ease(name: &str, tn: f64) -> f64 {
    // Endpoints exacts quelle que soit la courbe — overshoot laisse un
    // résidu flottant ~1e-16 à tn=0 (1−C3+C1), et le hold de fin écrit la
    // cible au centimètre près.
    if tn <= 0.0 {
        return 0.0;
    }
    if tn >= 1.0 {
        return 1.0;
    }
    match name {
        "linear" => tn,
        "ease_in" => tn * tn,
        "ease_out" => 1.0 - (1.0 - tn) * (1.0 - tn),
        // cubic in-out — version plus marquée du smoothstep
        "ease_in_out" => {
            if tn < 0.5 {
                4.0 * tn * tn * tn
            } else {
                1.0 - (-2.0 * tn + 2.0).powi(3) / 2.0
            }
        }
        // expo — départ quasi immobile puis snap (in), ou départ franc
        // puis atterrissage très doux (out)
        "expo_in" => {
            if tn <= 0.0 {
                0.0
            } else {
                (10.0 * tn - 10.0).exp2()
            }
        }
        "expo_out" => {
            if tn >= 1.0 {
                1.0
            } else {
                1.0 - (-10.0 * tn).exp2()
            }
        }
        // back-out — dépasse la cible puis se rétracte dessus (percussif)
        "overshoot" => {
            const C1: f64 = 1.70158;
            const C3: f64 = C1 + 1.0;
            let u = tn - 1.0;
            1.0 + C3 * u * u * u + C1 * u * u
        }
        // smoothstep — départ et arrivée à vélocité nulle (défaut musical)
        _ => 3.0 * tn * tn - 2.0 * tn * tn * tn,
    }
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
        let k = ease(easing, tn);

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
    fn all_easings_hit_endpoints_exactly() {
        // Quelle que soit la courbe, le départ est la source et l'arrivée
        // la cible exacte — le hold de fin écrit la pose au centimètre près.
        let e = PoseRamp;
        for name in [
            "linear",
            "smooth",
            "ease_in",
            "ease_out",
            "ease_in_out",
            "expo_in",
            "expo_out",
            "overshoot",
        ] {
            let p = params(name);
            assert_eq!(
                e.position(0.0, 0, &p),
                Vector3::new(0.0, 0.0, 0.0),
                "{name} depart"
            );
            assert_eq!(
                e.position(2.0, 0, &p),
                Vector3::new(4.0, 0.0, 0.0),
                "{name} arrivee"
            );
        }
    }

    #[test]
    fn ease_in_out_plus_marque_que_smooth() {
        // cubic in-out est plus lent au départ que smoothstep — c'est une
        // version accentuée du même profil.
        let e = PoseRamp;
        let tn25 = 0.5; // t=0.5 sur T=2 → tn=0.25
        let x_inout = e.position(tn25, 0, &params("ease_in_out")).x;
        let x_smooth = e.position(tn25, 0, &params("smooth")).x;
        assert!(
            x_inout < x_smooth,
            "in-out plus lent au depart: {x_inout} < {x_smooth}"
        );
    }

    #[test]
    fn expo_in_quasi_immobile_puis_snap() {
        let e = PoseRamp;
        let p = params("expo_in");
        // À mi-temps expo_in n'a presque rien parcouru (2^-5 ≈ 3%)
        let mid = e.position(1.0, 0, &p).x;
        assert!(mid < 0.5, "expo_in à mi-temps ~immobile: {mid}");
        // Mais la cible est atteinte exactement
        assert_eq!(e.position(2.0, 0, &p).x, 4.0);
    }

    #[test]
    fn overshoot_depasse_la_cible_en_cours_de_rampe() {
        // back-out : la position dépasse la cible avant de se rétracter
        // dessus — c'est le propos de la courbe (arrivée élastique).
        let e = PoseRamp;
        let p = params("overshoot");
        let mut max_x = 0.0_f64;
        for i in 0..40 {
            let x = e.position(i as f64 * 2.0 / 40.0, 0, &p).x;
            max_x = max_x.max(x);
        }
        assert!(max_x > 4.0, "overshoot doit dépasser la cible: max {max_x}");
        assert_eq!(e.position(2.0, 0, &p).x, 4.0);
    }

    #[test]
    fn unknown_easing_falls_back_to_smooth() {
        let e = PoseRamp;
        let unknown = e.position(0.5, 0, &params("nimportequoi")).x;
        let smooth = e.position(0.5, 0, &params("smooth")).x;
        assert!((unknown - smooth).abs() < 1e-9);
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
