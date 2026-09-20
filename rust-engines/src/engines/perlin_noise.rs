//! PerlinNoise — bruit organique 3D par superposition d'harmoniques.
//! Chaque axe a sa propre suite d'harmoniques (stream RNG indépendant par
//! axe) : sans ça, y et z n'étaient que des copies de x déphasées de
//! +0.1/+0.2 rad → mouvement quasi 1-D le long de la diagonale.

use crate::engines::{finite_or_zero, Engine, EngineParams};
use crate::rng::SimpleRng;
use nalgebra::Vector3;
use std::f64::consts::TAU;

pub struct PerlinNoise;

impl Engine for PerlinNoise {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let intensity = params
            .extra
            .get("intensity")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        // Clampé : < 0 produisait un nombre d'harmoniques non borné, > 1
        // laissait 0 harmonique → sortie nulle.
        let smoothness = params
            .extra
            .get("smoothness")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);
        let seed = params
            .extra
            .get("seed")
            .and_then(|v| v.as_i64())
            .unwrap_or(42) as u64;

        // Approximation de Perlin par superposition harmonique
        let n_harmonics = (3.0 + 12.0 * (1.0 - smoothness)) as i32;
        let base_freq = 1.0 / params.duration.max(1e-9);

        let obj_seed = seed.wrapping_add(object_index as u64 * 31);

        // Un stream RNG par axe → phases et fréquences indépendantes
        // (composantes décorrélées, vrai mouvement 3D).
        let axis_component = |axis: u64| -> f64 {
            let mut rng =
                SimpleRng::new(obj_seed.wrapping_add(axis.wrapping_mul(0x9E3779B97F4A7C15)));
            let mut acc = 0.0;
            for h in 1..=n_harmonics {
                let freq = base_freq * h as f64 * (1.0 + 0.2 * rng.randn());
                let amp = intensity / (h as f64).powf(0.5 + smoothness);
                let phase = rng.uniform(0.0, TAU);
                acc += amp * (TAU * freq * t + phase).sin();
            }
            acc
        };

        let mut x = axis_component(0);
        let mut y = axis_component(1);
        let mut z = axis_component(2);

        // Normaliser
        let max_val = x.abs().max(y.abs()).max(z.abs());
        if max_val > 0.0 && max_val.is_finite() {
            x = (x / max_val) * intensity;
            y = (y / max_val) * intensity;
            z = (z / max_val) * intensity;
        }

        finite_or_zero(Vector3::new(
            x.clamp(-1.0, 1.0),
            y.clamp(-1.0, 1.0),
            z.clamp(-1.0, 1.0),
        ))
    }

    fn name(&self) -> &str {
        "perlin_noise"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn perlin_axes_are_independent() {
        // Régression : y et z étaient les harmoniques de x déphasées de
        // +0.1/+0.2 rad → trajectoire quasi 1-D sur la diagonale. Avec des
        // streams indépendants, var(x−y) ≈ var(x)+var(y) >> var(x).
        let e = PerlinNoise;
        let p = params(json!({"intensity": 0.8, "smoothness": 0.3, "seed": 42}));
        let n = 40;
        let mut xs = Vec::with_capacity(n);
        let mut ys = Vec::with_capacity(n);
        for k in 0..n {
            let pos = e.position(k as f64 * 0.11, 0, &p);
            xs.push(pos.x);
            ys.push(pos.y);
        }
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        let var = |v: &[f64]| {
            let m = mean(v);
            v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / v.len() as f64
        };
        let diff: Vec<f64> = xs.iter().zip(&ys).map(|(x, y)| x - y).collect();
        let var_x = var(&xs);
        let var_diff = var(&diff);
        assert!(var_x > 1e-4, "pas de mouvement sur x (var_x={var_x})");
        assert!(
            var_diff > 0.5 * var_x,
            "axes corrélés (quasi 1-D) : var(x-y)={var_diff} vs var(x)={var_x}"
        );
    }

    #[test]
    fn perlin_extreme_smoothness_is_finite() {
        let e = PerlinNoise;
        for s in [-1.0, 0.0, 1.0, 5.0] {
            let p = params(json!({"smoothness": s}));
            let pos = e.position(1.0, 0, &p);
            assert!(
                pos.iter().all(|v| v.is_finite()),
                "smoothness={s} → {pos:?}"
            );
        }
    }

    #[test]
    fn perlin_zero_duration_is_finite() {
        let e = PerlinNoise;
        let p = EngineParams {
            n_objects: 1,
            duration: 0.0,
            fps: 60.0,
            extra: json!({}),
        };
        assert!(e.position(1.0, 0, &p).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn perlin_deterministic() {
        let e = PerlinNoise;
        let p = params(json!({"seed": 9}));
        assert_eq!(e.position(1.3, 2, &p), e.position(1.3, 2, &p));
    }
}
