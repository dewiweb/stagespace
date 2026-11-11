# morph — composite plugin (ABI v2)

Linear interpolation between two upstream trajectories:
`result = a·(1−w) + b·w` — like a native `Mix`/`Crossfade`, in wasm.
Demonstrates both slots of the `plugin_inputs_ptr` buffer (input_a at
indices 0..3, input_b at indices 3..6).

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../../plugin-sdk/target/debug/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/morph.wasm -o morph.ssx
```

## Usage

The `Plugin` node with `plugin_id: "morph"` takes **2 trajectory
inputs** (ports `input_a`/`input_b`, blue/violet A/B handles) —
like a native composite: `Circular → A`, `Spiral → B`,
`morph → Output`.

Param: `w` — 0 = pure A trajectory, 1 = pure B, live.

## ABI v2 features demonstrated

- `kind: "composite"` + `abi_version: 2` in the manifest
- `stagespace_plugin_composite!` macro → exports `plugin_inputs_ptr`
  in addition to the v1 contract
- Signature `fn(t, i, n, d, params, a, b)` — `a`/`b` = upstream
  positions of the two ports
