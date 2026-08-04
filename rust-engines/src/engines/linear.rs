use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct Linear;

impl Engine for Linear {
    fn position(&self, t: f64, _object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let start = params.extra.get("start")
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

        let end = params.extra.get("end")
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

        let progress = t / params.duration;
        let direction = (end - start) * progress;

        start + direction
    }

    fn name(&self) -> &str {
        "linear"
    }
}
