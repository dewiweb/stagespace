# Benchmarks

STAGESPACE utilise Criterion pour mesurer la performance des moteurs de trajectoires.

## Exécuter les benchmarks

```bash
cd rust-engines
cargo bench
```

## Résultats actuels

### Moteurs math (9 objets)

| Moteur | Temps moyen |
|--------|-------------|
| Circular | ~540 ns |
| Spiral | ~540 ns |
| Lissajous | ~640 ns |
| Perlin Noise | ~720 ns |

### Moteurs physiques (9 objets)

| Moteur | Temps moyen |
|--------|-------------|
| Swarm | ~1.2 µs |

### Scaling (Circular)

| Objets | Temps moyen |
|--------|-------------|
| 9 | ~484 ns |
| 50 | ~2.8 µs |
| 100 | ~5.5 µs |
| 500 | ~27.7 µs |
| 1000 | ~55.6 µs |

## Interprétation

- **Moteurs math** : très performants (< 1 µs pour 9 objets)
- **Moteurs physiques** : plus lents mais encore très performants (~1.2 µs pour 9 objets)
- **Scaling** : temps linéaire avec le nombre d'objets (O(n))
- **60 FPS** : 16.67 ms par frame → STAGESPACE peut gérer facilement 1000+ objets en temps réel

## Comparaison

STAGESPACE est optimisé pour le temps réel :
- **Python (OSCAI)** : ~100-500 µs par position (100-1000x plus lent)
- **STAGESPACE (Rust)** : ~50-500 ns par position (1000x plus rapide)

## Ajouter un nouveau benchmark

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

## Historique

Les benchmarks sont automatiquement enregistrés dans `target/criterion/` pour suivre l'évolution des performances au fil du temps.
