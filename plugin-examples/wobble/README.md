# wobble — modifier plugin (ABI v2)

Adds a circular oscillation in the xz plane around the upstream
position — demonstrates passing the upstream trajectory to the guest via
the `plugin_inputs_ptr` buffer.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
../../plugin-sdk/target/debug/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/wobble.wasm -o wobble.ssx
```

## Usage

The `Plugin` node with `plugin_id: "wobble"` takes **1 trajectory
input** (port `input`) — like a native modifier (`Scale`,
`Offset`): `Circular → wobble → Output`.

Params: `amp` (oscillation radius), `freq` (Hz).

## ABI v2 features demonstrated

- `kind: "modifier"` + `abi_version: 2` in the manifest
- `stagespace_plugin_modifier!` macro → exports `plugin_inputs_ptr`
  in addition to the v1 contract
- Signature `fn(t, i, n, d, params, input)` — `input` = upstream
  position of the current object
