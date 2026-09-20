//! Champ de vecteurs procédural — advection + steering (Carpentier/Gerzso).
//!
//! Contrairement aux courbes paramétriques, les objets ne suivent pas une
//! trajectoire `f(t)` : ils sont *advectés* par un champ de vitesses `v(p)`
//! défini sur le plan (x, y). À chaque pas de temps :
//!   vel ← vel·(1−k) + v(p)·k        (steering inertiel, k = responsiveness)
//!   vel += jitter                    (wander, RNG seedé → déterministe)
//!   vel += rappel vers bounds        (containment doux)
//!   |vel| clampée à max_speed
//!   pos += vel·dt
//!
//! Le mouvement résultant est perpétuel et organique : rien ne se répète,
//! contrairement aux orbites. Comme `swarm`, le moteur reste une fonction pure
//! de `t` — la trajectoire est re-simulée déterministement depuis t=0 à chaque
//! appel (RNG seedé, init déterministe). Coût O(t·fps) par objet.
//!
//! Params (extra) :
//!   field        "vortex" | "sink" | "source" | "flow" | "noise"  (défaut vortex)
//!   strength     vitesse cible du champ, unités/s                 (défaut 0.5)
//!   center       [x, y] centre des champs radiaux                 (défaut [0,0])
//!   radius       rayon caractéristique (pic vortex / portée)      (défaut 0.6)
//!   swirl        composante tangentielle sink/source (spirale)    (défaut 0.0)
//!   direction    [x, y] direction du champ "flow"                 (défaut [1,0])
//!   noise_scale  fréquence spatiale du champ "noise"              (défaut 1.5)
//!   wander       amplitude du jitter aléatoire (0..1)             (défaut 0.1)
//!   responsiveness  inertie du steering par pas (0..1, bas=lourd) (défaut 0.1)
//!   max_speed    vitesse max, unités/s                            (défaut 1.0)
//!   bounds       rayon de confinement                             (défaut 1.0)
//!   containment  force du rappel vers bounds                      (défaut 0.5)
//!   init         "circle" | "line" | "grid" | "random" | "point"  (défaut circle)
//!   init_radius  rayon/taille du layout initial                   (défaut 0.6)
//!   z_init       hauteur initiale                                 (défaut 0.0)
//!   z_drift      dérive verticale, unités/s                       (défaut 0.0)
//!   seed         graine RNG (wander, noise, init random)          (défaut 42)

use crate::engines::{Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::{Vector2, Vector3};
use std::f64::consts::TAU;

pub struct VectorField;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldKind {
    Vortex,
    Sink,
    Source,
    Flow,
    Noise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InitLayout {
    Circle,
    Line,
    Grid,
    Random,
    Point,
}

#[derive(Debug, Clone)]
struct Config {
    kind: FieldKind,
    strength: f64,
    center: Vector2<f64>,
    radius: f64,
    swirl: f64,
    direction: Vector2<f64>,
    noise_scale: f64,
    wander: f64,
    responsiveness: f64,
    max_speed: f64,
    bounds: f64,
    containment: f64,
    layout: InitLayout,
    init_radius: f64,
    z_init: f64,
    z_drift: f64,
    seed: u64,
}

fn f64_param(params: &EngineParams, key: &str, default: f64) -> f64 {
    params
        .extra
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

fn vec2_param(params: &EngineParams, key: &str, default: Vector2<f64>) -> Vector2<f64> {
    params
        .extra
        .get(key)
        .and_then(|v| v.as_array())
        .and_then(|a| {
            match (
                a.first().and_then(|x| x.as_f64()),
                a.get(1).and_then(|y| y.as_f64()),
            ) {
                (Some(x), Some(y)) => Some(Vector2::new(x, y)),
                _ => None,
            }
        })
        .unwrap_or(default)
}

impl Config {
    fn from_params(params: &EngineParams) -> Self {
        let kind = match params
            .extra
            .get("field")
            .and_then(|v| v.as_str())
            .unwrap_or("vortex")
        {
            "sink" => FieldKind::Sink,
            "source" => FieldKind::Source,
            "flow" => FieldKind::Flow,
            "noise" => FieldKind::Noise,
            _ => FieldKind::Vortex,
        };
        let layout = match params
            .extra
            .get("init")
            .and_then(|v| v.as_str())
            .unwrap_or("circle")
        {
            "line" => InitLayout::Line,
            "grid" => InitLayout::Grid,
            "random" => InitLayout::Random,
            "point" => InitLayout::Point,
            _ => InitLayout::Circle,
        };
        Config {
            kind,
            strength: f64_param(params, "strength", 0.5).max(0.0),
            center: vec2_param(params, "center", Vector2::zeros()),
            radius: f64_param(params, "radius", 0.6).max(1e-3),
            swirl: f64_param(params, "swirl", 0.0),
            direction: vec2_param(params, "direction", Vector2::new(1.0, 0.0)),
            noise_scale: f64_param(params, "noise_scale", 1.5).max(1e-3),
            wander: f64_param(params, "wander", 0.1).max(0.0),
            responsiveness: f64_param(params, "responsiveness", 0.1).clamp(0.001, 1.0),
            max_speed: f64_param(params, "max_speed", 1.0).max(1e-3),
            bounds: f64_param(params, "bounds", 1.0).max(1e-3),
            containment: f64_param(params, "containment", 0.5).max(0.0),
            layout,
            init_radius: f64_param(params, "init_radius", 0.6).max(0.0),
            z_init: f64_param(params, "z_init", 0.0),
            z_drift: f64_param(params, "z_drift", 0.0),
            seed: params
                .extra
                .get("seed")
                .and_then(|v| v.as_i64())
                .unwrap_or(42) as u64,
        }
    }
}

fn smoothstep(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

/// Hash déterministe cellule → vecteur unitaire (angle uniforme).
fn hash_vec2(ix: i64, iy: i64, seed: u64) -> Vector2<f64> {
    let mut h = (ix as u64)
        .wrapping_mul(0x9E3779B97F4A7C15)
        .wrapping_add((iy as u64).wrapping_mul(0xC2B2AE3D27D4EB4F))
        .wrapping_add(seed.wrapping_mul(0x165667B19E3779F9));
    h ^= h >> 30;
    h = h.wrapping_mul(0xBF58476D1CE4E5B9);
    h ^= h >> 27;
    h = h.wrapping_mul(0x94D049BB133111EB);
    h ^= h >> 31;
    let angle = (h as f64 / u64::MAX as f64) * TAU;
    Vector2::new(angle.cos(), angle.sin())
}

/// Bruit vectoriel lisse déterministe (value noise bilinéaire sur grille).
/// Retourne un vecteur de norme ≤ 1.
fn noise_field(p: Vector2<f64>, seed: u64) -> Vector2<f64> {
    let ix = p.x.floor() as i64;
    let iy = p.y.floor() as i64;
    let fx = p.x - ix as f64;
    let fy = p.y - iy as f64;
    let sx = smoothstep(fx);
    let sy = smoothstep(fy);

    let v00 = hash_vec2(ix, iy, seed);
    let v10 = hash_vec2(ix + 1, iy, seed);
    let v01 = hash_vec2(ix, iy + 1, seed);
    let v11 = hash_vec2(ix + 1, iy + 1, seed);

    let a = v00 + (v10 - v00) * sx;
    let b = v01 + (v11 - v01) * sx;
    a + (b - a) * sy
}

/// Vitesse cible du champ au point p (plan x, y).
fn field_velocity(p: Vector2<f64>, cfg: &Config) -> Vector2<f64> {
    match cfg.kind {
        FieldKind::Flow => {
            let d = cfg.direction;
            if d.norm_squared() < 1e-12 {
                Vector2::zeros()
            } else {
                d.normalize() * cfg.strength
            }
        }
        FieldKind::Noise => noise_field(p * cfg.noise_scale, cfg.seed) * cfg.strength,
        _ => {
            // Champs radiaux autour de center
            let d = p - cfg.center;
            let r = d.norm().max(1e-6);
            let radial = d / r; // sortant
            let tangential = Vector2::new(-d.y, d.x) / r; // anti-horaire

            match cfg.kind {
                // Corps rigide à l'intérieur (v ∝ r), décroissance 1/r dehors —
                // vitesse maximale = strength au rayon caractéristique.
                FieldKind::Vortex => {
                    let profile = if r < cfg.radius {
                        r / cfg.radius
                    } else {
                        cfg.radius / r
                    };
                    tangential * (cfg.strength * profile) + radial * (cfg.swirl * profile)
                }
                // Pleine vitesse à l'intérieur de radius, décroissance 1/r dehors.
                // swirl > 0 transforme le puits/la source en spirale.
                FieldKind::Sink | FieldKind::Source => {
                    let sign = if cfg.kind == FieldKind::Sink {
                        -1.0
                    } else {
                        1.0
                    };
                    let profile = (cfg.radius / r).min(1.0);
                    radial * (sign * cfg.strength * profile) + tangential * (cfg.swirl * profile)
                }
                _ => Vector2::zeros(),
            }
        }
    }
}

/// Position initiale (plan x, y) selon le layout choisi.
fn initial_position2(i: usize, n: usize, cfg: &Config) -> Vector2<f64> {
    let n = n.max(1);
    match cfg.layout {
        InitLayout::Circle => {
            let a = TAU * i as f64 / n as f64;
            Vector2::new(a.cos(), a.sin()) * cfg.init_radius
        }
        InitLayout::Line => {
            let s = if n > 1 {
                i as f64 / (n - 1) as f64 * 2.0 - 1.0
            } else {
                0.0
            };
            Vector2::new(s * cfg.init_radius, 0.0)
        }
        InitLayout::Grid => {
            let cols = (n as f64).sqrt().ceil() as usize;
            let rows = n.div_ceil(cols);
            let col = i % cols;
            let row = i / cols;
            let x = if cols > 1 {
                (col as f64 / (cols - 1) as f64) * 2.0 - 1.0
            } else {
                0.0
            };
            let y = if rows > 1 {
                (row as f64 / (rows - 1) as f64) * 2.0 - 1.0
            } else {
                0.0
            };
            Vector2::new(x, y) * cfg.init_radius
        }
        InitLayout::Random => {
            let mut rng = SimpleRng::new(
                cfg.seed
                    .wrapping_add((i as u64).wrapping_mul(0x9E3779B97F4A7C15)),
            );
            let a = rng.uniform(0.0, TAU);
            let r = cfg.init_radius * rng.rand().sqrt();
            Vector2::new(a.cos() * r, a.sin() * r)
        }
        InitLayout::Point => cfg.center,
    }
}

impl Engine for VectorField {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let cfg = Config::from_params(params);
        let mut pos = initial_position2(object_index, params.n_objects, &cfg);
        // z en forme close : le champ est 2D, la hauteur dérive linéairement.
        let z = cfg.z_init + cfg.z_drift * t.max(0.0);

        let mut vel = Vector2::zeros();
        let fps = params.fps.max(1.0);
        let dt = 1.0 / fps;
        let n_steps = (t.max(0.0) * fps) as u64;
        // RNG par objet : la composante wander diverge entre objets mais reste
        // reproductible pour un seed donné.
        let mut rng = SimpleRng::new(
            cfg.seed
                .wrapping_add((object_index as u64).wrapping_mul(0x9E3779B97F4A7C15)),
        );

        let k = cfg.responsiveness;
        for _ in 0..n_steps {
            // Steering inertiel : vel poursuit le champ
            let target = field_velocity(pos, &cfg);
            vel = vel * (1.0 - k) + target * k;

            if cfg.wander > 0.0 {
                vel.x += rng.uniform(-cfg.wander, cfg.wander);
                vel.y += rng.uniform(-cfg.wander, cfg.wander);
            }

            // Containment doux : rappel proportionnel au dépassement des bounds
            let dc = pos - cfg.center;
            let r = dc.norm();
            if r > cfg.bounds && cfg.containment > 0.0 {
                vel -= dc / r * (r - cfg.bounds) * cfg.containment;
            }

            let speed = vel.norm();
            if speed > cfg.max_speed {
                vel *= cfg.max_speed / speed;
            }

            pos += vel * dt;
        }

        Vector3::new(pos.x, pos.y, z)
    }

    fn name(&self) -> &str {
        "vector_field"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(n: usize, extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: n,
            duration: 8.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn vortex_stays_bounded_and_moves() {
        let e = VectorField;
        let p = params(
            4,
            json!({"field": "vortex", "strength": 0.5, "radius": 0.6,
                   "bounds": 1.0, "wander": 0.0, "init_radius": 0.6}),
        );
        let p0 = e.position(0.0, 0, &p);
        let p1 = e.position(1.0, 0, &p);
        // L'objet a bougé (advection) et reste proche du rayon du vortex
        assert!((p1 - p0).norm() > 0.01);
        let r1 = (p1.x * p1.x + p1.y * p1.y).sqrt();
        assert!(r1 > 0.2 && r1 < 1.2, "r={r1}");
    }

    #[test]
    fn sink_converges_toward_center() {
        let e = VectorField;
        let p = params(
            4,
            json!({"field": "sink", "strength": 0.8, "radius": 0.5,
                   "wander": 0.0, "responsiveness": 0.2, "init_radius": 0.8}),
        );
        let r0 = {
            let p0 = e.position(0.0, 0, &p);
            (p0.x * p0.x + p0.y * p0.y).sqrt()
        };
        let r1 = {
            let p1 = e.position(2.0, 0, &p);
            (p1.x * p1.x + p1.y * p1.y).sqrt()
        };
        assert!(r1 < r0 * 0.5, "r0={r0} r1={r1}");
    }

    #[test]
    fn flow_translates_objects() {
        let e = VectorField;
        let p = params(
            2,
            json!({"field": "flow", "strength": 0.5, "direction": [1.0, 0.0],
                   "wander": 0.0, "responsiveness": 1.0, "bounds": 10.0,
                   "init": "point", "center": [0.0, 0.0]}),
        );
        let pos = e.position(2.0, 0, &p);
        // ~1 unité de déplacement en +x après 2s à 0.5 u/s
        assert!(pos.x > 0.8, "x={}", pos.x);
        assert!(pos.y.abs() < 0.01);
    }

    #[test]
    fn source_pushes_objects_outward() {
        let e = VectorField;
        let p = params(
            4,
            json!({"field": "source", "strength": 0.8, "radius": 0.4,
                   "wander": 0.0, "responsiveness": 0.3, "init": "circle",
                   "init_radius": 0.1, "bounds": 2.0}),
        );
        let r1 = {
            let p1 = e.position(1.5, 0, &p);
            (p1.x * p1.x + p1.y * p1.y).sqrt()
        };
        assert!(r1 > 0.3, "r={r1}");
    }

    #[test]
    fn noise_field_is_deterministic_and_bounded() {
        let e = VectorField;
        let p = params(
            4,
            json!({"field": "noise", "strength": 0.5, "noise_scale": 1.5,
                   "wander": 0.0, "bounds": 1.2, "seed": 7}),
        );
        let a = e.position(2.0, 0, &p);
        let b = e.position(2.0, 0, &p);
        assert_eq!(a, b, "non déterministe");
        assert!(a.norm() < 1.5);
    }

    #[test]
    fn wander_makes_objects_diverge() {
        let e = VectorField;
        let p = params(
            4,
            json!({"field": "vortex", "wander": 0.3, "init": "point",
                   "seed": 42}),
        );
        let a = e.position(2.0, 0, &p);
        let b = e.position(2.0, 1, &p);
        // Même point de départ, RNG par objet → trajectoires distinctes
        assert!((a - b).norm() > 0.01);
    }

    #[test]
    fn deterministic_for_same_seed() {
        let e = VectorField;
        let p = params(4, json!({"wander": 0.5, "seed": 99}));
        for i in 0..4 {
            assert_eq!(e.position(3.0, i, &p), e.position(3.0, i, &p));
        }
    }

    #[test]
    fn z_drift_is_closed_form() {
        let e = VectorField;
        let p = params(
            1,
            json!({"field": "flow", "strength": 0.0, "z_init": 0.5, "z_drift": 0.1}),
        );
        let pos = e.position(3.0, 0, &p);
        assert!((pos.z - 0.8).abs() < 1e-9, "z={}", pos.z);
    }

    #[test]
    fn t_zero_returns_initial_layout() {
        let e = VectorField;
        let p = params(4, json!({"init": "circle", "init_radius": 0.5}));
        let pos = e.position(0.0, 0, &p);
        assert!((pos.x - 0.5).abs() < 1e-9);
        assert!(pos.y.abs() < 1e-9);
    }
}
