use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

pub struct Pendulum;

impl Engine for Pendulum {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let length = params
            .extra
            .get("length")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.8);
        let gravity = params
            .extra
            .get("gravity")
            .and_then(|v| v.as_f64())
            .unwrap_or(9.81);
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
            std::f64::consts::PI * object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let mut theta = initial_angle + po * 0.1;
        let mut omega_p = 0.0;
        let omega_nat = (gravity / (length * 10.0)).sqrt();
        let dt = 1.0 / params.fps;

        // Intégration RK4 pour chaque frame jusqu'à t
        let n_steps = (t * params.fps) as i32;
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

        Vector3::new(x, 0.0, z)
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
