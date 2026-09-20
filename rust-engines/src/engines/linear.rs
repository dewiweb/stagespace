//! Linear — interpolation directe start→end en 3D. La progression est clampée
//! à [0,1] : au-delà de `duration` l'objet tient la position `end`.

use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct Linear;

impl Engine for Linear {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let start = params
            .extra
            .get("start")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                if arr.len() >= 3 {
                    Some(Vector3::new(
                        arr[0].as_f64().unwrap_or(0.0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(0.0),
                    ))
                } else {
                    None
                }
            })
            .unwrap_or(Vector3::new(-1.0, 0.0, 0.0));

        let end = params
            .extra
            .get("end")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                if arr.len() >= 3 {
                    Some(Vector3::new(
                        arr[0].as_f64().unwrap_or(0.0),
                        arr[1].as_f64().unwrap_or(0.0),
                        arr[2].as_f64().unwrap_or(0.0),
                    ))
                } else {
                    None
                }
            })
            .unwrap_or(Vector3::new(1.0, 0.0, 0.0));

        // Clamp : t > duration est atteignable (phase offsets, PingPong à
        // t = duration) — on tient `end` plutôt que d'extrapoler.
        let progress = (t / params.duration.max(1e-9)).clamp(0.0, 1.0);
        let direction = (end - start) * progress;

        start + direction
    }

    fn name(&self) -> &str {
        "linear"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn linear_beyond_duration_holds_end() {
        // Régression : progress non clampé → extrapolation au-delà de `end`.
        let e = Linear;
        let p = EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra: json!({"start": [-1.0, 0.0, 0.0], "end": [1.0, 0.0, 0.0]}),
        };
        let at_end = e.position(4.0, 0, &p);
        let beyond = e.position(9.0, 0, &p);
        assert_eq!(at_end, Vector3::new(1.0, 0.0, 0.0));
        assert_eq!(at_end, beyond);
    }

    #[test]
    fn linear_negative_t_holds_start() {
        let e = Linear;
        let p = EngineParams {
            n_objects: 1,
            duration: 4.0,
            fps: 60.0,
            extra: json!({"start": [-1.0, 0.0, 0.0], "end": [1.0, 0.0, 0.0]}),
        };
        assert_eq!(e.position(-2.0, 0, &p), Vector3::new(-1.0, 0.0, 0.0));
    }
}
