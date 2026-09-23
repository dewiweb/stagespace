// Diagnostic : compile chaque slot graph de examples/full-feature-show.hfg
// et vérifie que l'engine produit du mouvement (position varie avec t).
// Le fichier est un artefact généré — voir frontend/scripts/generate-example-show.ts.
#[allow(clippy::uninlined_format_args)]
mod example_show_tests {
    use crate::graph::compilation::compile_graph_with_audio;
    use crate::graph::parser::build_graph_from_json;
    use stagespace_engines::AudioState;
    use std::sync::{Arc, Mutex};

    fn load_show() -> serde_json::Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../examples/full-feature-show.hfg"
        );
        let text = std::fs::read_to_string(path)
            .expect("example .hfg missing — run npm run generate:example");
        serde_json::from_str(&text).expect("invalid .hfg JSON")
    }

    /// Échantillonne f(t) pour chaque objet et retourne le déplacement max
    /// observé entre deux instants.
    fn max_displacement(f: &stagespace_engines::PositionFn, n_objects: usize) -> f64 {
        let times = [0.1, 0.5, 1.0, 2.0, 4.0, 7.0, 12.0];
        let mut max_d = 0.0f64;
        for obj in 0..n_objects {
            let p0 = f(times[0], obj);
            for &t in &times[1..] {
                max_d = max_d.max((f(t, obj) - p0).norm());
            }
        }
        max_d
    }

    #[test]
    fn all_slot_engines_produce_movement() {
        let show = load_show();
        let audio = Arc::new(Mutex::new(AudioState::new()));
        let mut report = Vec::new();
        for slot in show["slots"].as_array().expect("slots") {
            let name = slot["name"].as_str().unwrap();
            let graph = build_graph_from_json(
                &slot["graphJson"],
                &audio.lock().unwrap_or_else(|e| e.into_inner()),
            )
            .unwrap_or_else(|e| panic!("{name}: graph build failed: {e}"));
            let f = compile_graph_with_audio(&graph, audio.clone())
                .unwrap_or_else(|e| panic!("{name}: compile failed: {e}"));
            let n = slot["trackIds"].as_array().unwrap().len();
            let d = max_displacement(&f, n);
            report.push(format!("{name}: max displacement {d:.3}"));
            assert!(
                d > 1e-3,
                "{name}: engine produces no movement (max displacement {d})"
            );
        }
        eprintln!("\n{}", report.join("\n"));
    }
}
