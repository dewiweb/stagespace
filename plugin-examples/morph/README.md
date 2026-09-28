# morph — plugin composite (ABI v2)

Interpolation linéaire entre deux trajectoires upstream :
`result = a·(1−w) + b·w` — comme un `Mix`/`Crossfade` natif, en wasm.
Démontre les deux slots du buffer `plugin_inputs_ptr` (input_a aux
indices 0..3, input_b aux indices 3..6).

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../../plugin-sdk/target/debug/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/morph.wasm -o morph.ssx
```

## Usage

Le node `Plugin` avec `plugin_id: "morph"` prend **2 entrées
trajectoire** (ports `input_a`/`input_b`, handles A/B bleus/violets) —
comme un composite natif : `Circular → A`, `Spiral → B`,
`morph → Output`.

Param : `w` — 0 = trajectoire A pure, 1 = B pure, live.

## Points ABI v2 illustrés

- `kind: "composite"` + `abi_version: 2` dans le manifeste
- Macro `stagespace_plugin_composite!` → exporte `plugin_inputs_ptr`
  en plus du contrat v1
- Signature `fn(t, i, n, d, params, a, b)` — `a`/`b` = positions
  upstream des deux ports
