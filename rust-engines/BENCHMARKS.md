# Benchmarks

STAGESPACE uses Criterion to measure trajectory engine performance.

## Running the benchmarks

```bash
cd rust-engines
cargo bench
```

## Current results

### Math engines (9 objects)

| Engine | Average time |
|--------|-------------|
| Circular | ~540 ns |
| Spiral | ~540 ns |
| Lissajous | ~640 ns |
| Perlin Noise | ~720 ns |

### Physics engines (9 objects)

| Engine | Average time |
|--------|-------------|
| Swarm | ~1.2 µs |

### Scaling (Circular)

| Objects | Average time |
|--------|-------------|
| 9 | ~484 ns |
| 50 | ~2.8 µs |
| 100 | ~5.5 µs |
| 500 | ~27.7 µs |
| 1000 | ~55.6 µs |

## Interpretation

- **Math engines**: very fast (< 1 µs for 9 objects)
- **Physics engines**: slower but still very fast (~1.2 µs for 9 objects)
- **Scaling**: linear time with object count (O(n))
- **60 FPS**: 16.67 ms per frame → STAGESPACE can easily handle 1000+ objects in real time

## Comparison

STAGESPACE is optimized for real time:
- **Python (OSCAI)**: ~100-500 µs per position (100-1000x slower)
- **STAGESPACE (Rust)**: ~50-500 ns per position (1000x faster)

## Adding a new benchmark

```rust
fn bench_my_engine(c: &mut Criterion) {
    let engine = MyEngine;
    let params = EngineParams {
        n_objects: 100,
        duration: 4.0,
        fps: 60.0,
        extra: json!({}),
    };

    c.bench_function("my_engine", |b| {
        b.iter(|| {
            for i in 0..100 {
                black_box(engine.position(0.0, i, &params));
            }
        })
    });
}
```

## History

Benchmarks are automatically recorded in `target/criterion/` to track performance over time.
