use nalgebra::Vector3;
use crate::engines::{Engine, EngineParams};

pub struct CustomTrajectory;

impl Engine for CustomTrajectory {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let equations = params.extra.get("equations")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(|| serde_json::Map::new());
        
        let coordinate_system = params.extra.get("coordinate_system")
            .and_then(|v| v.as_str())
            .unwrap_or("cartesian");
        
        let x = Self::evaluate_simple(
            equations.get("x").and_then(|v| v.as_str()).unwrap_or("0"),
            t,
            object_index,
            params.duration,
        );
        
        let y = Self::evaluate_simple(
            equations.get("y").and_then(|v| v.as_str()).unwrap_or("0"),
            t,
            object_index,
            params.duration,
        );
        
        let z = Self::evaluate_simple(
            equations.get("z").and_then(|v| v.as_str()).unwrap_or("0"),
            t,
            object_index,
            params.duration,
        );
        
        match coordinate_system {
            "cartesian" => Vector3::new(x, y, z),
            "polar" => {
                let azimuth = Self::evaluate_simple(
                    equations.get("azimuth").and_then(|v| v.as_str()).unwrap_or("0"),
                    t,
                    object_index,
                    params.duration,
                );
                let elevation = Self::evaluate_simple(
                    equations.get("elevation").and_then(|v| v.as_str()).unwrap_or("0"),
                    t,
                    object_index,
                    params.duration,
                );
                let distance = Self::evaluate_simple(
                    equations.get("distance").and_then(|v| v.as_str()).unwrap_or("1"),
                    t,
                    object_index,
                    params.duration,
                );
                
                let azim_rad = azimuth.to_radians();
                let elev_rad = elevation.to_radians();
                
                let px = distance * elev_rad.cos() * azim_rad.cos();
                let py = distance * elev_rad.cos() * azim_rad.sin();
                let pz = distance * elev_rad.sin();
                
                Vector3::new(px, py, pz)
            }
            _ => Vector3::new(0.0, 0.0, 0.0),
        }
    }

    fn name(&self) -> &str {
        "custom_trajectory"
    }
}

impl CustomTrajectory {
    fn evaluate_simple(expr: &str, t: f64, _object_index: usize, _duration: f64) -> f64 {
        // Parser très simple pour les expressions de base
        // Supporte: nombre, t, sin(), cos(), +, -, *, /
        let expr = expr
            .replace("t", &t.to_string())
            .replace("pi", &std::f64::consts::PI.to_string())
            .replace("e", &std::f64::consts::E.to_string());
        
        // Évaluation simplifiée avec eval-like
        if expr.contains("sin(") {
            let start = expr.find("sin(").unwrap_or(0) + 4;
            let end = expr.find(')').unwrap_or(expr.len());
            let inner = &expr[start..end];
            let value: f64 = inner.parse().unwrap_or(0.0);
            value.to_radians().sin()
        } else if expr.contains("cos(") {
            let start = expr.find("cos(").unwrap_or(0) + 4;
            let end = expr.find(')').unwrap_or(expr.len());
            let inner = &expr[start..end];
            let value: f64 = inner.parse().unwrap_or(0.0);
            value.to_radians().cos()
        } else if expr.contains("sqrt(") {
            let start = expr.find("sqrt(").unwrap_or(0) + 5;
            let end = expr.find(')').unwrap_or(expr.len());
            let inner = &expr[start..end];
            let value: f64 = inner.parse().unwrap_or(0.0);
            value.sqrt()
        } else {
            expr.parse().unwrap_or(0.0)
        }
    }
}
