# Example plugin: Lemniscate

Horizontal figure-∞ (Bernoulli lemniscate) — demonstrates the complete
SDK → wasm32 → `.ssx` → STAGESPACE runtime pipeline.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../plugin-sdk/target/release/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/lemniscate.wasm -o lemniscate.ssx
```

## Usage

Drop `lemniscate.ssx` into the plugins folder (see `plugin-sdk/README.md`),
then in a sub-graph:

```
Objects → Plugin { plugin_id: "lemniscate", scale: 2.0 } → Output
Duration ──────────────────────────────────────┘
```

Params: `scale` (size), `aspect` (z stretching, √2 by default),
`speed` (speed multiplier).

The `lemniscate.ssx` bundle is also committed as a test fixture in
`rust-engines/tests/fixtures/` — the `real_ssx_fixture_executes` test
proves the pipeline without a wasm32 toolchain in CI.
