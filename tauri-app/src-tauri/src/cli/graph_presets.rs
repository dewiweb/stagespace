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
use stagespace_engines::GraphJson;

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
        (
            "follow",
            "Follow-the-leader — modes: pursue/evade/orbit/arrive (physics)",
        ),
        (
            "vectorfield",
            "Vector field advection — vortex/sink/flow/noise (physics)",
        ),
        (
            "plugin:<id>",
            "WASM plugin engine (abi v1) — ex: plugin:lemniscate",
        ),
        (
            "wobble",
            "WASM plugin modifier (abi v2) — Circular → wobble",
        ),
        (
            "morph",
            "WASM plugin composite (abi v2) — Circular+Spiral → morph",
        ),
    ]
}

/// Génère le graphe typé pour un template donné — le `Value` interne
/// (json! est la syntaxe de construction la plus lisible) est validé par
/// désérialisation dans le contrat `GraphJson` avant de partir.
pub fn build_template_graph(
    template: &str,
    n_objects: usize,
    duration: f64,
) -> Result<GraphJson, String> {
    build_template_graph_value(template, n_objects, duration).and_then(|v| {
        serde_json::from_value::<GraphJson>(v)
            .map_err(|e| format!("Internal error: template graph invalid: {e}"))
    })
}

fn build_template_graph_value(
    template: &str,
    n_objects: usize,
    duration: f64,
) -> Result<Value, String> {
    let template = template.to_lowercase();

    // Plugins WASM — graphes spécifiques par kind (engine/modifier/composite).
    if let Some(g) = plugin_template_graph(&template, n_objects, duration) {
        return g;
    }

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
        "follow" | "pursue" | "evade" | "orbit" | "arrive" => {
            ("Follow", json!({ "mode": template, "n_objects": n_objects }))
        }
        "vectorfield" | "vortex" | "field" => ("VectorField", json!({
            "field": "vortex", "strength": 0.5, "radius": 0.4,
            "wander": 0.15, "responsiveness": 0.08, "max_speed": 0.8,
            "bounds": 0.9, "init": "circle", "init_radius": 0.5, "seed": 42
        })),
        _ => return Err(format!(
            "Unknown template '{template}'. Available: circle, spiral, lissajous, figure8, linear, oscillation, formation, converge, pendulum, perlin, swarm, avoidance, bouncing, spring, follow/pursue/evade/orbit/arrive, vectorfield, plugin:<id>, wobble, morph"
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

/// Graphes de démo pour les plugins WASM (`plugin:<id>`, `wobble`, `morph`).
/// Retourne `None` pour les templates natifs.
fn plugin_template_graph(
    template: &str,
    n_objects: usize,
    duration: f64,
) -> Option<Result<Value, String>> {
    let objects = json!({ "id": "n-objects", "data": { "type": "Objects", "params": { "n_objects": n_objects } } });
    let dur = json!({ "id": "n-duration", "data": { "type": "Duration", "params": { "duration": duration } } });
    let output = json!({ "id": "n-output", "data": { "type": "Output", "params": {} } });
    let edge = |src: &str, tgt: &str, th: &str| json!({ "source": src, "target": tgt, "sourceHandle": "output", "targetHandle": th });

    // plugin:<id> — engine ABI v1 : Objects→Plugin→Output, Duration→Plugin.
    if let Some(id) = template.strip_prefix("plugin:") {
        if id.is_empty() {
            return Some(Err(
                "Usage: plugin:<plugin_id> (ex: plugin:lemniscate)".to_string()
            ));
        }
        let plugin = json!({ "id": "n-plugin", "data": { "type": "Plugin", "params": { "plugin_id": id } } });
        return Some(Ok(json!({
            "nodes": [objects, dur, plugin, output],
            "edges": [
                edge("n-objects", "n-plugin", "input"),
                edge("n-duration", "n-plugin", "duration"),
                edge("n-plugin", "n-output", "input"),
            ],
        })));
    }

    match template {
        // wobble — modifier ABI v2 : Objects→Circular→wobble→Output.
        "wobble" => Some(Ok(json!({
            "nodes": [
                objects, dur,
                { "id": "n-engine", "data": { "type": "Circular", "params": { "radius": 0.5 } } },
                { "id": "n-plugin", "data": { "type": "Plugin", "params": { "plugin_id": "wobble" } } },
                output,
            ],
            "edges": [
                edge("n-objects", "n-engine", "input"),
                edge("n-duration", "n-engine", "duration"),
                edge("n-engine", "n-plugin", "input"),
                edge("n-plugin", "n-output", "input"),
            ],
        }))),

        // morph — composite ABI v2 : Circular→input_a, Spiral→input_b.
        "morph" => Some(Ok(json!({
            "nodes": [
                objects, dur,
                { "id": "n-a", "data": { "type": "Circular", "params": { "radius": 0.5 } } },
                { "id": "n-b", "data": { "type": "Spiral", "params": { "radius": 0.5, "height": 0.4, "turns": 2.0 } } },
                { "id": "n-plugin", "data": { "type": "Plugin", "params": { "plugin_id": "morph" } } },
                output,
            ],
            "edges": [
                edge("n-objects", "n-a", "input"),
                edge("n-duration", "n-a", "duration"),
                edge("n-objects", "n-b", "input"),
                edge("n-duration", "n-b", "duration"),
                edge("n-a", "n-plugin", "input_a"),
                edge("n-b", "n-plugin", "input_b"),
                edge("n-plugin", "n-output", "input"),
            ],
        }))),

        _ => None,
    }
}
