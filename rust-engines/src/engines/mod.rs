pub mod audio_amplitude;
pub mod audio_amplitude_falloff;
pub mod audio_spectrum;
pub mod avoidance;
pub mod bouncing;
pub mod bpm;
pub mod circular;
pub mod converge;
pub mod custom_trajectory;
pub mod directional_falloff;
pub mod elliptical;
pub mod figure8;
pub mod follow;
pub mod formation;
pub mod helix;
pub mod linear;
pub mod lissajous;
pub mod modifiers;
pub mod osc_input;
pub mod oscillation;
pub mod pendulum;
pub mod perlin_noise;
pub mod point_distance_falloff;
pub mod rose_curve;
pub mod spiral;
pub mod spline;
pub mod spring;
pub mod swarm;
pub mod time_falloff;
pub mod vector_field;
pub mod wave;

use nalgebra::Vector3;
use serde::{Deserialize, Serialize};

/// Borne haute du nombre d'objets simulables.
///
/// Les moteurs à interaction (swarm, avoidance) sont en O(n²) par pas de temps et
/// allouent des vecteurs de taille `n_objects` : sans borne, une valeur venue du
/// frontend ou d'un fichier de patch peut épuiser la mémoire ou geler le runtime.
pub const MAX_OBJECTS: usize = 1024;

/// Nombre max de pas de simulation rejoués depuis t=0 par les moteurs à état
/// (intégration pas à pas : swarm, avoidance, bouncing, spring, follow,
/// pendulum, vector_field).
///
/// Au-delà, le pas de temps est dilaté (`dt' = t / MAX_SIM_STEPS`) : la
/// trajectoire reste globalement correcte en moyenne mais perd en fidélité
/// locale — compromis délibéré pour qu'une durée de plusieurs heures ne puisse
/// pas geler une frame (4M pas ≈ 18.5h à 60 fps en pas fins).
pub const MAX_SIM_STEPS: u64 = 4_000_000;

/// Nombre de pas de re-simulation et pas de temps effectif pour les moteurs
/// dont le coût par pas est O(1) par objet (bouncing, spring, follow,
/// pendulum, vector_field).
///
/// Retourne `(n_steps, dt)` :
/// - cas nominal : `n_steps = (t.max(0) * fps.max(1)) as u64`, `dt = 1/fps`
///   (pattern de référence : vector_field) — les t négatifs donnent 0 pas,
///   c.-à-d. la position initiale ;
/// - si `n_steps > MAX_SIM_STEPS`, on plafonne à `MAX_SIM_STEPS` avec
///   `dt = t / MAX_SIM_STEPS` (dégradation douce, voir [`MAX_SIM_STEPS`]).
pub fn sim_steps(t: f64, fps: f64) -> (u64, f64) {
    let fps = fps.max(1.0);
    let t = t.max(0.0);
    let steps = (t * fps) as u64;
    if steps <= MAX_SIM_STEPS {
        (steps, 1.0 / fps)
    } else {
        (MAX_SIM_STEPS, t / MAX_SIM_STEPS as f64)
    }
}

/// Variante de [`sim_steps`] pour les moteurs à interaction entre agents
/// (swarm, avoidance) dont le pas de temps coûte O(n²) : le budget de pas est
/// divisé par n² pour borner le coût total d'une re-simulation (~4M
/// évaluations de paires), puis le dt est dilaté de la même façon.
pub fn sim_steps_n2(t: f64, fps: f64, n_agents: usize) -> (u64, f64) {
    let fps = fps.max(1.0);
    let t = t.max(0.0);
    let n2 = (n_agents as u64).saturating_mul(n_agents as u64).max(1);
    let cap = (MAX_SIM_STEPS / n2).max(1);
    let steps = (t * fps) as u64;
    if steps <= cap {
        (steps, 1.0 / fps)
    } else {
        (cap, t / cap as f64)
    }
}

/// Garde-fou de sortie : un NaN/inf produit par des paramètres dégénérés ne
/// doit jamais partir vers l'OSC — on retombe sur l'origine.
pub fn finite_or_zero(p: Vector3<f64>) -> Vector3<f64> {
    if p.iter().all(|v| v.is_finite()) {
        p
    } else {
        Vector3::zeros()
    }
}

/// Paramètres communs pour tous les moteurs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineParams {
    pub n_objects: usize,
    pub duration: f64,
    pub fps: f64,
    // Paramètres spécifiques au moteur
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Interface commune pour tous les moteurs
pub trait Engine {
    /// Calcule la position d'un objet à un instant t
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64>;

    /// Nom du moteur
    fn name(&self) -> &str;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_params(n_objects: usize, duration: f64, extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects,
            duration,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn test_circular() {
        let engine = circular::Circular;
        let params = create_params(
            9,
            4.0,
            json!({
                "radius": 1.5,
                "speed": 1.0,
                "plane": "xz",
                "phase_offset": true
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        assert!((pos.x - 1.5).abs() < 0.01);
        assert!((pos.y - 0.0).abs() < 0.01);
        assert!((pos.z - 0.0).abs() < 0.01);

        let pos = engine.position(1.0, 0, &params);
        // Après 1s (25% de 4s), angle = PI/2
        assert!((pos.x - 0.0).abs() < 0.1);
        assert!((pos.z - 1.5).abs() < 0.1);
    }

    #[test]
    fn test_spiral() {
        let engine = spiral::Spiral;
        let params = create_params(
            9,
            4.0,
            json!({
                "radius": 0.5,
                "expansion": 1.0,
                "plane": "xz"
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        assert!((pos.x - 0.5).abs() < 0.01);

        let pos = engine.position(2.0, 0, &params);
        // Après 2s (50% de 4s), radius = 0.5 + 0.5 = 1.0
        let radius = (pos.x.powi(2) + pos.z.powi(2)).sqrt();
        assert!((radius - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_formation_circle() {
        let engine = formation::Formation;
        let params = create_params(
            9,
            4.0,
            json!({
                "shape": "circle",
                "radius": 0.7
            }),
        );

        let pos0 = engine.position(0.0, 0, &params);
        let pos1 = engine.position(0.0, 1, &params);

        // Les objets devraient être répartis sur un cercle
        let radius0 = (pos0.x.powi(2) + pos0.y.powi(2)).sqrt();
        let radius1 = (pos1.x.powi(2) + pos1.y.powi(2)).sqrt();
        assert!((radius0 - radius1).abs() < 0.01);
    }

    #[test]
    fn test_perlin_noise() {
        let engine = perlin_noise::PerlinNoise;
        let params = create_params(
            1,
            4.0,
            json!({
                "intensity": 0.5,
                "smoothness": 0.5,
                "seed": 42
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should be within [-1, 1]
        assert!(pos.x >= -1.0 && pos.x <= 1.0);
        assert!(pos.y >= -1.0 && pos.y <= 1.0);
        assert!(pos.z >= -1.0 && pos.z <= 1.0);
    }

    #[test]
    fn test_converge() {
        let engine = converge::Converge;
        let params = create_params(
            4,
            4.0,
            json!({
                "start_radius": 0.9,
                "end_radius": 0.0,
                "easing": "linear"
            }),
        );

        let pos_start = engine.position(0.0, 0, &params);
        let pos_end = engine.position(4.0, 0, &params);

        // Start should be at radius 0.9
        let r_start = (pos_start.x.powi(2) + pos_start.y.powi(2)).sqrt();
        assert!((r_start - 0.9).abs() < 0.1);

        // End should be at radius 0.0
        let r_end = (pos_end.x.powi(2) + pos_end.y.powi(2)).sqrt();
        assert!(r_end < 0.1);
    }

    #[test]
    fn test_pendulum() {
        let engine = pendulum::Pendulum;
        let params = create_params(
            1,
            4.0,
            json!({
                "length": 0.8,
                "gravity": 9.81,
                "initial_angle": 0.5
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should start at initial angle
        assert!(pos.x.abs() > 0.0);
    }

    #[test]
    fn test_avoidance() {
        let engine = avoidance::Avoidance;
        let params = create_params(
            4,
            4.0,
            json!({
                "repulsion_radius": 0.4,
                "repulsion_strength": 2.0
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should be within bounds
        assert!(pos.norm() < 1.0);
    }

    #[test]
    fn test_bouncing() {
        let engine = bouncing::Bouncing;
        let params = create_params(
            1,
            4.0,
            json!({
                "container": "sphere",
                "container_size": 0.9
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should be within container
        assert!(pos.norm() <= 1.0);
    }

    #[test]
    fn test_spring() {
        let engine = spring::Spring;
        let params = create_params(
            1,
            4.0,
            json!({
                "stiffness": 3.0,
                "damping_coef": 0.5
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should be within bounds
        assert!(pos.x >= -1.0 && pos.x <= 1.0);
    }

    #[test]
    fn test_follow() {
        let engine = follow::Follow;
        let params = create_params(
            1,
            4.0,
            json!({
                "speed": 0.5,
                "distance": 0.3
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should start somewhere
        assert!(pos.norm() < 1.0);
    }

    #[test]
    fn test_swarm() {
        let engine = swarm::Swarm;
        let params = create_params(
            4,
            4.0,
            json!({
                "separation": 0.3,
                "alignment": 0.5,
                "cohesion": 0.3
            }),
        );

        let pos = engine.position(0.0, 0, &params);
        // Should be within bounds
        assert!(pos.norm() < 1.0);
    }

    #[test]
    fn test_sim_steps_nominal() {
        let (steps, dt) = sim_steps(1.0, 60.0);
        assert_eq!(steps, 60);
        assert!((dt - 1.0 / 60.0).abs() < 1e-12);
    }

    #[test]
    fn test_sim_steps_negative_t_is_frozen() {
        // t négatif → 0 pas → position initiale (pas de simulation à rebours)
        let (steps, dt) = sim_steps(-5.0, 60.0);
        assert_eq!(steps, 0);
        assert!((dt - 1.0 / 60.0).abs() < 1e-12);
    }

    #[test]
    fn test_sim_steps_zero_fps_clamped() {
        let (steps, dt) = sim_steps(2.0, 0.0);
        assert_eq!(steps, 2); // fps.max(1.0)
        assert!((dt - 1.0).abs() < 1e-12);
    }

    #[test]
    fn test_sim_steps_caps_long_durations() {
        // ~24h à 60 fps dépasse le cap → dt dilaté pour couvrir t
        let t = 24.0 * 3600.0;
        let (steps, dt) = sim_steps(t, 60.0);
        assert_eq!(steps, MAX_SIM_STEPS);
        assert!((dt - t / MAX_SIM_STEPS as f64).abs() < 1e-12);
    }

    #[test]
    fn test_sim_steps_n2_bounds_total_work() {
        // n=1024 agents : le cap est divisé par n² → la re-simulation ne peut
        // pas dépasser ~MAX_SIM_STEPS évaluations de paires
        let (steps, dt) = sim_steps_n2(1000.0, 60.0, 1024);
        assert!(steps <= MAX_SIM_STEPS / (1024 * 1024) + 1);
        assert!(dt > 1.0 / 60.0); // pas dilaté
    }

    #[test]
    fn test_finite_or_zero() {
        assert_eq!(
            finite_or_zero(Vector3::new(1.0, 2.0, 3.0)),
            Vector3::new(1.0, 2.0, 3.0)
        );
        assert_eq!(
            finite_or_zero(Vector3::new(f64::NAN, 0.0, 0.0)),
            Vector3::zeros()
        );
        assert_eq!(
            finite_or_zero(Vector3::new(0.0, f64::INFINITY, 0.0)),
            Vector3::zeros()
        );
    }

    #[test]
    fn test_custom_trajectory() {
        let params = create_params(
            1,
            4.0,
            json!({
                "coordinate_system": "cartesian",
                "equations": {
                    "x": "0.5",
                    "y": "0.3",
                    "z": "0.0"
                }
            }),
        );
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");

        let pos = engine.position(0.0, 0, &params);
        // Parser simplifié: on vérifie juste que ça compile et retourne quelque chose
        assert!(pos.x.abs() < 10.0); // Valeur quelconque mais bornée
    }

    #[test]
    fn test_custom_trajectory_arithmetic_and_vars() {
        let params = create_params(
            4,
            8.0,
            json!({
                "coordinate_system": "cartesian",
                "equations": { "x": "2*t + i*0.5", "y": "d/2", "z": "n" }
            }),
        );
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        // t=1, i=3, d=8, n=4 → x=2+1.5=3.5, y=4, z=4
        let pos = engine.position(1.0, 3, &params);
        assert!((pos.x - 3.5).abs() < 1e-9);
        assert!((pos.y - 4.0).abs() < 1e-9);
        assert!((pos.z - 4.0).abs() < 1e-9);
    }

    #[test]
    fn test_custom_trajectory_functions_radians() {
        let params = create_params(
            1,
            4.0,
            json!({
                "equations": { "x": "sin(pi/2)", "y": "sqrt(4)", "z": "max(1, 3)" }
            }),
        );
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        let pos = engine.position(0.0, 0, &params);
        assert!((pos.x - 1.0).abs() < 1e-9); // sin(pi/2) en radians = 1
        assert!((pos.y - 2.0).abs() < 1e-9); // sqrt fonctionne (n'est pas clobber par 't')
        assert!((pos.z - 3.0).abs() < 1e-9); // fonction 2 args
    }

    #[test]
    fn test_custom_trajectory_string_equations() {
        // Format legacy frontend : string "x,y,z" — le split ignore les
        // virgules dans les appels de fonction.
        let params = create_params(1, 4.0, json!({ "equations": "min(t,2), 0.3, abs(-1)" }));
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        let pos = engine.position(5.0, 0, &params);
        assert!((pos.x - 2.0).abs() < 1e-9);
        assert!((pos.y - 0.3).abs() < 1e-9);
        assert!((pos.z - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_custom_trajectory_invalid_and_nan() {
        // NaN/inf à l'évaluation → 0, jamais propagé en OSC
        let params = create_params(
            1,
            4.0,
            json!({
                "equations": { "x": "sqrt(-1)", "y": "1/0", "z": "0*t" }
            }),
        );
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        let pos = engine.position(1.0, 0, &params);
        assert!(pos.x.is_finite() && pos.y.is_finite() && pos.z.is_finite());
        assert_eq!(pos, Vector3::zeros());

        // Expression malformée → rejet propre à la construction (audit B3)
        let bad = create_params(1, 4.0, json!({ "equations": { "x": "t**" } }));
        assert!(custom_trajectory::CustomTrajectory::new(&bad).is_err());
    }

    #[test]
    fn test_custom_trajectory_bounds() {
        // Expression trop longue → Err (audit B3)
        let long_expr = "t+".repeat(3000) + "1";
        let params = create_params(1, 4.0, json!({ "equations": { "x": long_expr } }));
        assert!(custom_trajectory::CustomTrajectory::new(&params).is_err());

        // Parenthèses imbriquées au-delà de MAX_EXPR_DEPTH → Err propre,
        // pas de stack overflow
        let deep = "(".repeat(5000) + "t" + &")".repeat(5000);
        let params = create_params(1, 4.0, json!({ "equations": { "x": deep } }));
        assert!(custom_trajectory::CustomTrajectory::new(&params).is_err());

        // Fonction inconnue → Err ; variable inconnue → tolérée (0)
        let params = create_params(1, 4.0, json!({ "equations": { "x": "bogus(t)" } }));
        assert!(custom_trajectory::CustomTrajectory::new(&params).is_err());
        let params = create_params(1, 4.0, json!({ "equations": { "x": "bogusvar + 1" } }));
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        assert!((engine.position(0.0, 0, &params).x - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_custom_trajectory_polar() {
        let params = create_params(
            1,
            4.0,
            json!({
                "coordinate_system": "polar",
                "equations": { "azimuth": "0", "elevation": "0", "distance": "2" }
            }),
        );
        let engine = custom_trajectory::CustomTrajectory::new(&params).expect("valid");
        let pos = engine.position(0.0, 0, &params);
        // azim=0, elev=0, dist=2 → front (+Y) convention
        assert!((pos.y - 2.0).abs() < 1e-9);
        assert!(pos.x.abs() < 1e-9 && pos.z.abs() < 1e-9);
    }
}
