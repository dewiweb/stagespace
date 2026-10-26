//! Formation — place les objets sur une figure géométrique statique dans le
//! plan xy (élévation sur z), avec rotation optionnelle autour de z.

use crate::engines::{finite_or_zero, Engine, EngineParams};
use nalgebra::Vector3;
use std::f64::consts::PI;

pub struct Formation;

impl Engine for Formation {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let shape = params
            .extra
            .get("shape")
            .and_then(|v| v.as_str())
            .unwrap_or("circle");
        let radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.7);
        let rotate = params
            .extra
            .get("rotate")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let elevation = params
            .extra
            .get("elevation")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // n_objects = 0 ou object_index >= n_objects sont atteignables
        // (hot-swap d'osc_id) : les divisions doivent rester saines.
        let n = params.n_objects.max(1);
        let duration = params.duration.max(1e-9);
        let angle_offset = 2.0 * PI * rotate * t / duration;

        let pos = match shape {
            "circle" => {
                let base_angle = 2.0 * PI * object_index as f64 / n as f64;
                let angle = base_angle + angle_offset;
                Vector3::new(radius * angle.cos(), radius * angle.sin(), elevation)
            }
            "sphere" => {
                // Distribution Fibonacci sur sphère.
                // object_index >= n donnerait y < -1 → sqrt(<0) = NaN : clamp.
                let golden = PI * (3.0 - 5.0_f64.sqrt());
                let y = (1.0 - 2.0 * object_index as f64 / n.saturating_sub(1).max(1) as f64)
                    .clamp(-1.0, 1.0);
                let r = (1.0 - y * y).sqrt() * radius;
                let theta = golden * object_index as f64;
                let angle = theta + angle_offset;
                Vector3::new(r * angle.cos(), r * angle.sin(), y * radius)
            }
            "grid" => {
                let side = (n as f64).sqrt().ceil() as usize;
                let row = object_index / side;
                let col = object_index % side;
                let x = (col as f64 / side.saturating_sub(1).max(1) as f64 - 0.5) * 2.0 * radius;
                let y = (row as f64 / side.saturating_sub(1).max(1) as f64 - 0.5) * 2.0 * radius;
                let cx = x * angle_offset.cos() - y * angle_offset.sin();
                let cy = x * angle_offset.sin() + y * angle_offset.cos();
                Vector3::new(cx, cy, elevation)
            }
            "line" => {
                let x =
                    (object_index as f64 / n.saturating_sub(1).max(1) as f64 - 0.5) * 2.0 * radius;
                Vector3::new(x * angle_offset.cos(), x * angle_offset.sin(), elevation)
            }
            "arc" => {
                // Demi-cercle — objets répartis sur [−π/2, +π/2] autour
                // de l'axe X, rotate faisant tourner l'arc dans le temps.
                let span = PI;
                let frac = if n > 1 {
                    object_index as f64 / (n - 1) as f64
                } else {
                    0.5
                };
                let angle = frac * span - span / 2.0 + angle_offset;
                Vector3::new(radius * angle.cos(), radius * angle.sin(), elevation)
            }
            "triangle" => {
                let base_angle = 2.0 * PI * object_index as f64 / n as f64;
                let angle = base_angle + angle_offset;
                let r = radius * (1.0 + 0.3 * (3.0 * angle).cos());
                Vector3::new(r * angle.cos(), r * angle.sin(), elevation)
            }
            "hexagon" => {
                let base_angle = 2.0 * PI * object_index as f64 / n as f64;
                let angle = base_angle + angle_offset;
                let r = radius * (1.0 + 0.2 * (6.0 * angle).cos());
                Vector3::new(r * angle.cos(), r * angle.sin(), elevation)
            }
            _ => Vector3::new(0.0, 0.0, 0.0),
        };

        finite_or_zero(pos)
    }

    fn name(&self) -> &str {
        "formation"
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
    fn sphere_index_beyond_n_objects_is_finite() {
        // Régression : object_index >= n_objects → y < -1 → sqrt(1-y²) = NaN
        let e = Formation;
        let p = params(4, json!({"shape": "sphere"}));
        let pos = e.position(0.0, 10, &p);
        assert!(pos.iter().all(|v| v.is_finite()), "pos={pos:?}");
    }

    #[test]
    fn n_objects_zero_does_not_panic() {
        // Régression : (n_objects - 1) underflowait en usize quand n = 0.
        let e = Formation;
        for shape in ["circle", "sphere", "grid", "line", "triangle", "hexagon"] {
            let p = params(0, json!({"shape": shape}));
            let pos = e.position(1.0, 0, &p);
            assert!(
                pos.iter().all(|v| v.is_finite()),
                "shape={shape} pos={pos:?}"
            );
        }
    }

    #[test]
    fn sphere_single_object_is_finite() {
        // n_objects = 1 : dénominateur (n-1) = 0 → clamp protège.
        let e = Formation;
        let p = params(1, json!({"shape": "sphere"}));
        assert!(e.position(0.0, 0, &p).iter().all(|v| v.is_finite()));
    }
}
