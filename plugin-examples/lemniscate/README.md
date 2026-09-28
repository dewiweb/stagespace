# Plugin exemple : Lemniscate

Figure-∞ horizontale (lemniscate de Bernoulli) — démontre le pipeline complet
SDK → wasm32 → `.ssx` → runtime STAGESPACE.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../plugin-sdk/target/release/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/lemniscate.wasm -o lemniscate.ssx
```

## Utilisation

Déposer `lemniscate.ssx` dans le dossier plugins (voir `plugin-sdk/README.md`),
puis dans un sub-graph :

```
Objects → Plugin { plugin_id: "lemniscate", scale: 2.0 } → Output
Duration ──────────────────────────────────────┘
```

Params : `scale` (taille), `aspect` (étirement z, √2 par défaut),
`speed` (multiplicateur de vitesse).

Le bundle `lemniscate.ssx` est aussi commité comme fixture de test dans
`rust-engines/tests/fixtures/` — le test `real_ssx_fixture_executes`
prouve le pipeline sans toolchain wasm32 en CI.
