# wobble — plugin modifier (ABI v2)

Ajoute une oscillation circulaire dans le plan xz autour de la position
upstream — démontre le passage de la trajectoire amont au guest via le
buffer `plugin_inputs_ptr`.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../../plugin-sdk/target/debug/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/wobble.wasm -o wobble.ssx
```

## Usage

Le node `Plugin` avec `plugin_id: "wobble"` prend **1 entrée
trajectoire** (port `input`) — comme un modifier natif (`Scale`,
`Offset`) : `Circular → wobble → Output`.

Params : `amp` (rayon de l'oscillation), `freq` (Hz).

## Points ABI v2 illustrés

- `kind: "modifier"` + `abi_version: 2` dans le manifeste
- Macro `stagespace_plugin_modifier!` → exporte `plugin_inputs_ptr`
  en plus du contrat v1
- Signature `fn(t, i, n, d, params, input)` — `input` = position
  upstream de l'objet courant
