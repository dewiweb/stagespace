//! Pendule amorti — oscillation dans le plan xz (x horizontal, z vertical),
//! intégrée en RK4. Re-simulation déterministe depuis t=0 à chaque appel.

use crate::engines::{finite_or_zero, sim_steps, Engine, EngineParams};
use nalgebra::Vector3;

pub struct Pendulum;

impl Engine for Pendulum {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        // length <= 0 ou gravity < 0 rendraient omega_nat = sqrt(<0) = NaN :
        // on borne les entrées au domaine physique.
        let length = params
            .extra
            .get("length")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.8)
            .max(1e-3);
        let gravity = params
            .extra
            .get("gravity")
            .and_then(|v| v.as_f64())
            .unwrap_or(9.81)
            .max(0.0);
        let initial_angle = params
            .extra
            .get("initial_angle")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let damping = params
            .extra
            .get("damping")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.05);
        let phase_offset = params
            .extra
            .get("phase_offset")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let po = if phase_offset {
            std::f64::consts::PI * object_index as f64 / params.n_objects.max(1) as f64
        } else {
            0.0
        };

        let mut theta = initial_angle + po * 0.1;
        let mut omega_p = 0.0;
        let omega_nat = (gravity / (length * 10.0)).sqrt();
        let (n_steps, dt) = sim_steps(t, params.fps);

        // Intégration RK4 pour chaque frame jusqu'à t
        for _ in 0..n_steps {
            let (k1_th, k1_om) = pendulum_deriv(theta, omega_p, damping, omega_nat);
            let (k2_th, k2_om) = pendulum_deriv(
                theta + 0.5 * dt * k1_th,
                omega_p + 0.5 * dt * k1_om,
                damping,
                omega_nat,
            );
            let (k3_th, k3_om) = pendulum_deriv(
                theta + 0.5 * dt * k2_th,
                omega_p + 0.5 * dt * k2_om,
                damping,
                omega_nat,
            );
            let (k4_th, k4_om) =
                pendulum_deriv(theta + dt * k3_th, omega_p + dt * k3_om, damping, omega_nat);

            theta += dt * (k1_th + 2.0 * k2_th + 2.0 * k3_th + k4_th) / 6.0;
            omega_p += dt * (k1_om + 2.0 * k2_om + 2.0 * k3_om + k4_om) / 6.0;
        }

        let x = (length * theta.sin()).clamp(-1.0, 1.0);
        let z = (-length * theta.cos() + length * 0.5).clamp(-1.0, 1.0);

        finite_or_zero(Vector3::new(x, 0.0, z))
    }

    fn name(&self) -> &str {
        "pendulum"
    }
}

fn pendulum_deriv(theta: f64, omega: f64, damping: f64, omega_nat: f64) -> (f64, f64) {
    (
        omega,
        -damping * omega - omega_nat * omega_nat * theta.sin(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects: 2,
            duration: 4.0,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn pendulum_oscillates() {
        let e = Pendulum;
        let p = params(json!({"length": 0.8, "gravity": 9.81, "damping": 0.0}));
        let p0 = e.position(0.0, 0, &p);
        let p1 = e.position(0.3, 0, &p);
        assert!((p1 - p0).norm() > 0.01, "le pendule doit osciller");
    }

    #[test]
    fn pendulum_degenerate_params_stay_finite() {
        // Régression : gravity < 0 ou length <= 0 → omega_nat = sqrt(<0) = NaN
        // propagé jusqu'à l'OSC (catch_unwind n'attrape pas les NaN).
        let e = Pendulum;
        for extra in [
            json!({"gravity": -9.81}),
            json!({"length": 0.0}),
            json!({"length": -2.0}),
            json!({"gravity": 0.0}),
        ] {
            let p = params(extra);
            let pos = e.position(1.0, 0, &p);
            assert!(
                pos.iter().all(|v| v.is_finite()),
                "params {pos:?} non finis"
            );
        }
    }

    #[test]
    fn pendulum_negative_t_is_frozen() {
        let e = Pendulum;
        let p = params(json!({}));
        assert_eq!(e.position(-2.0, 0, &p), e.position(0.0, 0, &p));
    }

    #[test]
    fn pendulum_n_objects_zero_no_panic() {
        let e = Pendulum;
        let p = EngineParams {
            n_objects: 0,
            duration: 4.0,
            fps: 60.0,
            extra: json!({}),
        };
        assert!(e.position(1.0, 0, &p).iter().all(|v| v.is_finite()));
    }
}
