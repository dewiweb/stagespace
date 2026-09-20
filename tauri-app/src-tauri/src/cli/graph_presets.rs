//! Presets de graphs — génère le JSON attendu par build_graph_from_json.
//!
//! Format JSON attendu :
//! {
//!   "nodes": [
//!     { "id": "n1", "data": { "type": "Objects", "params": { "n_objects": 8 } } },
//!     { "id": "n2", "data": { "type": "Duration", "params": { "duration": 4.0 } } },
//!     { "id": "n3", "data": { "type": "Circular", "params": { "radius": 0.5 } } },
//!     { "id": "n4", "data": { "type": "Output", "params": {} } }
//!   ],
//!   "edges": [
//!     { "source": "n1", "target": "n3", "sourceHandle": "output", "targetHandle": "input" },
//!     { "source": "n2", "target": "n3", "sourceHandle": "output", "targetHandle": "duration" },
//!     { "source": "n3", "target": "n4", "sourceHandle": "output", "targetHandle": "input" }
//!   ]
//! }

use serde_json::{json, Value};

/// Liste des templates disponibles
pub fn list_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("circle", "Circular orbit"),
        ("spiral", "Rising/descending helix"),
        ("lissajous", "3D Lissajous curves"),
        ("figure8", "Figure-8 lemniscate"),
        ("linear", "Linear pan A→B"),
        ("oscillation", "Sinusoidal oscillation"),
        ("formation", "Geometric formation"),
        ("converge", "Convergence/divergence"),
        ("pendulum", "Pendulum simulation"),
        ("perlin", "Organic Perlin noise movement"),
        ("swarm", "Boids swarm (physics)"),
        ("avoidance", "Mutual repulsion (physics)"),
        ("bouncing", "Bouncing in container (physics)"),
        ("spring", "Spring attraction (physics)"),
        ("follow", "Follow-the-leader (physics)"),
        (
            "vectorfield",
            "Vector field advection — vortex/sink/flow/noise (physics)",
        ),
    ]
}

/// Génère le JSON du graphe pour un template donné
pub fn build_template_graph(
    template: &str,
    n_objects: usize,
    duration: f64,
) -> Result<Value, String> {
    let template = template.to_lowercase();
    let (engine_type, engine_params) = match template.as_str() {
        "circle" | "circular" => ("Circular", json!({ "radius": 0.5 })),
        "spiral" => ("Spiral", json!({ "radius": 0.5, "height": 0.3, "turns": 2.0 })),
        "lissajous" => ("Lissajous", json!({ "a": 3.0, "b": 2.0, "delta": std::f64::consts::FRAC_PI_2, "radius": 0.5 })),
        "figure8" | "figure_8" => ("Figure8", json!({ "radius": 0.5 })),
        "linear" => ("Linear", json!({ "start": [-0.5, 0.0, 0.0], "end": [0.5, 0.0, 0.0] })),
        "oscillation" => ("Oscillation", json!({ "amplitude": 0.5, "frequency": 1.0, "axis": "x" })),
        "formation" => ("Formation", json!({ "shape": "circle", "radius": 0.5 })),
        "converge" => ("Converge", json!({ "target": [0.0, 0.0, 0.0], "radius": 0.5 })),
        "pendulum" => ("Pendulum", json!({ "length": 0.5, "amplitude": 0.5 })),
        "perlin" | "perlin_noise" => ("PerlinNoise", json!({ "scale": 0.3, "speed": 0.5 })),
        "swarm" => ("Swarm", json!({ "n_objects": n_objects, "speed": 0.3 })),
        "avoidance" => ("Avoidance", json!({ "repulsion_radius": 0.4, "repulsion_strength": 2.0 })),
        "bouncing" => ("Bouncing", json!({ "container_size": 0.8, "speed": 0.3 })),
        "spring" => ("Spring", json!({ "target": [0.0, 0.0, 0.0], "stiffness": 2.0 })),
        "follow" => ("Follow", json!({ "n_objects": n_objects, "spacing": 0.1 })),
        "vectorfield" | "vortex" | "field" => ("VectorField", json!({
            "field": "vortex", "strength": 0.5, "radius": 0.4,
            "wander": 0.15, "responsiveness": 0.08, "max_speed": 0.8,
            "bounds": 0.9, "init": "circle", "init_radius": 0.5, "seed": 42
        })),
        _ => return Err(format!(
            "Unknown template '{template}'. Available: circle, spiral, lissajous, figure8, linear, oscillation, formation, converge, pendulum, perlin, swarm, avoidance, bouncing, spring, follow, vectorfield"
        )),
    };

    // Graph: Objects → Engine → Output, Duration → Engine
    Ok(json!({
        "nodes": [
            { "id": "n-objects", "data": { "type": "Objects", "params": { "n_objects": n_objects } } },
            { "id": "n-duration", "data": { "type": "Duration", "params": { "duration": duration } } },
            { "id": "n-engine", "data": { "type": engine_type, "params": engine_params } },
            { "id": "n-output", "data": { "type": "Output", "params": {} } },
        ],
        "edges": [
            { "source": "n-objects", "target": "n-engine", "sourceHandle": "output", "targetHandle": "input" },
            { "source": "n-duration", "target": "n-engine", "sourceHandle": "output", "targetHandle": "duration" },
            { "source": "n-engine", "target": "n-output", "sourceHandle": "output", "targetHandle": "input" },
        ],
    }))
}
