//! Pendule amorti — oscillation dans le plan xz (x horizontal, z vertical),
//! intégrée en RK4.
//!
//! Audit B1 : état par objet mis en cache (`Mutex`) — chaque appel
//! n'intègre que la fenêtre `[sim_t → t]` au lieu de re-simuler depuis
//! t=0 en RK4 (4 évaluations de dérivée par pas × objet × frame).

use crate::engines::{finite_or_zero, sim_window, Engine, EngineParams, SIM_REWIND_EPS};
use nalgebra::Vector3;
use std::sync::Mutex;

/// Engine à état — `Default` produit un cache vide (premier appel = init).
#[derive(Default)]
pub struct Pendulum {
    cache: Mutex<PendulumCache>,
}

#[derive(Default)]
struct PendulumCache {
    /// État (theta, omega) par objet — intégration lazy.
    agents: Vec<PendulumAgent>,
}

struct PendulumAgent {
    sim_t: f64,
    theta: f64,
    omega: f64,
}

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

        let omega_nat = (gravity / (length * 10.0)).sqrt();

        // Lazy per-agent : init = angle de repos + décalage de phase.
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        while c.agents.len() <= object_index {
            let idx = c.agents.len();
            let po_i = if phase_offset {
                std::f64::consts::PI * idx as f64 / params.n_objects.max(1) as f64
            } else {
                0.0
            };
            c.agents.push(PendulumAgent {
                sim_t: 0.0,
                theta: initial_angle + po_i * 0.1,
                omega: 0.0,
            });
        }
        let a = &mut c.agents[object_index];
        if t < a.sim_t - SIM_REWIND_EPS {
            *a = PendulumAgent {
                sim_t: 0.0,
                theta: initial_angle + po * 0.1,
                omega: 0.0,
            };
        }

        let (n_steps, dt, new_t) = sim_window(a.sim_t, t, params.fps, 1);

        // Intégration RK4 sur la fenêtre [sim_t → t]
        for _ in 0..n_steps {
            let (k1_th, k1_om) = pendulum_deriv(a.theta, a.omega, damping, omega_nat);
            let (k2_th, k2_om) = pendulum_deriv(
                a.theta + 0.5 * dt * k1_th,
                a.omega + 0.5 * dt * k1_om,
                damping,
                omega_nat,
            );
            let (k3_th, k3_om) = pendulum_deriv(
                a.theta + 0.5 * dt * k2_th,
                a.omega + 0.5 * dt * k2_om,
                damping,
                omega_nat,
            );
            let (k4_th, k4_om) = pendulum_deriv(
                a.theta + dt * k3_th,
                a.omega + dt * k3_om,
                damping,
                omega_nat,
            );

            a.theta += dt * (k1_th + 2.0 * k2_th + 2.0 * k3_th + k4_th) / 6.0;
            a.omega += dt * (k1_om + 2.0 * k2_om + 2.0 * k3_om + k4_om) / 6.0;
        }
        a.sim_t = new_t;
        let theta = a.theta;

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
        let e = Pendulum::default();
        let p = params(json!({"length": 0.8, "gravity": 9.81, "damping": 0.0}));
        let p0 = e.position(0.0, 0, &p);
        let p1 = e.position(0.3, 0, &p);
        assert!((p1 - p0).norm() > 0.01, "le pendule doit osciller");
    }

    #[test]
    fn pendulum_degenerate_params_stay_finite() {
        // Régression : gravity < 0 ou length <= 0 → omega_nat = sqrt(<0) = NaN
        // propagé jusqu'à l'OSC (catch_unwind n'attrape pas les NaN).
        let e = Pendulum::default();
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
        let e = Pendulum::default();
        let p = params(json!({}));
        assert_eq!(e.position(-2.0, 0, &p), e.position(0.0, 0, &p));
    }

    #[test]
    fn pendulum_n_objects_zero_no_panic() {
        let e = Pendulum::default();
        let p = EngineParams {
            n_objects: 0,
            duration: 4.0,
            fps: 60.0,
            extra: json!({}),
        };
        assert!(e.position(1.0, 0, &p).iter().all(|v| v.is_finite()));
    }
}
