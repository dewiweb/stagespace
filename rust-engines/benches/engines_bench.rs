use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use serde_json::json;
use stagespace_engines::engines::{
    circular, lissajous, perlin_noise, spiral, swarm, Engine, EngineParams,
};

fn bench_circular(c: &mut Criterion) {
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

    c.bench_function("circular_position", |b| {
        b.iter(|| {
            for obj_idx in 0..9 {
                black_box(engine.position(black_box(1.0), obj_idx, &params));
            }
        })
    });
}

fn bench_spiral(c: &mut Criterion) {
    let engine = spiral::Spiral;
    let params = EngineParams {
        n_objects: 9,
        duration: 4.0,
        fps: 60.0,
        extra: json!({
            "radius": 0.5,
            "expansion": 1.0,
            "plane": "xz"
        }),
    };

    c.bench_function("spiral_position", |b| {
        b.iter(|| {
            for obj_idx in 0..9 {
                black_box(engine.position(black_box(1.0), obj_idx, &params));
            }
        })
    });
}

fn bench_lissajous(c: &mut Criterion) {
    let engine = lissajous::Lissajous;
    let params = EngineParams {
        n_objects: 9,
        duration: 4.0,
        fps: 60.0,
        extra: json!({
            "freq_x": 3.0,
            "freq_y": 2.0,
            "freq_z": 1.0,
            "plane": "xz"
        }),
    };

    c.bench_function("lissajous_position", |b| {
        b.iter(|| {
            for obj_idx in 0..9 {
                black_box(engine.position(black_box(1.0), obj_idx, &params));
            }
        })
    });
}

fn bench_perlin_noise(c: &mut Criterion) {
    let engine = perlin_noise::PerlinNoise;
    let params = EngineParams {
        n_objects: 9,
        duration: 4.0,
        fps: 60.0,
        extra: json!({
            "intensity": 0.5,
            "smoothness": 0.5,
            "seed": 42
        }),
    };

    c.bench_function("perlin_noise_position", |b| {
        b.iter(|| {
            for obj_idx in 0..9 {
                black_box(engine.position(black_box(1.0), obj_idx, &params));
            }
        })
    });
}

fn bench_swarm(c: &mut Criterion) {
    let engine = swarm::Swarm::default();
    let params = EngineParams {
        n_objects: 9,
        duration: 4.0,
        fps: 60.0,
        extra: json!({
            "separation": 0.3,
            "alignment": 0.5,
            "cohesion": 0.3
        }),
    };

    c.bench_function("swarm_position", |b| {
        b.iter(|| {
            for obj_idx in 0..9 {
                black_box(engine.position(black_box(1.0), obj_idx, &params));
            }
        })
    });
}

fn bench_scaling(c: &mut Criterion) {
    let engine = circular::Circular;
    let params_base = EngineParams {
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

    let mut group = c.benchmark_group("circular_scaling");
    for n_objects in [9, 50, 100, 500, 1000].iter() {
        let mut params = params_base.clone();
        params.n_objects = *n_objects;
        group.bench_with_input(BenchmarkId::from_parameter(n_objects), n_objects, |b, n| {
            b.iter(|| {
                for obj_idx in 0..*n {
                    black_box(engine.position(black_box(1.0), obj_idx, &params));
                }
            })
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_circular,
    bench_spiral,
    bench_lissajous,
    bench_perlin_noise,
    bench_swarm,
    bench_scaling
);
criterion_main!(benches);
