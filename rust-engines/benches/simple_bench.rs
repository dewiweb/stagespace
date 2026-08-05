use serde_json::json;
use stagespace_engines::engines::{circular, Engine, EngineParams};
use std::time::Instant;

fn main() {
    let engine = circular::Circular;
    let params = EngineParams {
        n_objects: 9,
        duration: 4.0,
        fps: 60.0,
        extra: json!({
            "radius": 1.5,
            "speed": 1.0,
            "plane": "xz",
            "phase_offset": true
        }),
    };

    // Benchmark: 60 FPS * 4 secondes = 240 frames * 9 objects = 2160 calls
    let iterations = 2160;

    let start = Instant::now();
    for frame in 0..240 {
        for obj_idx in 0..9 {
            let t = frame as f64 / 60.0;
            engine.position(t, obj_idx, &params);
        }
    }
    let duration = start.elapsed();

    println!("Circular engine: {iterations} calls in {duration:?}");
    println!("Average per call: {:?}", duration / iterations as u32);
    println!(
        "FPS equivalent: {:.0}",
        iterations as f64 / duration.as_secs_f64()
    );
}
