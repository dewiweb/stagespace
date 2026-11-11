# stagespace-plugin-sdk

SDK for writing STAGESPACE WASM plugins (custom nodes, `.ssx` bundles).

## Writing a plugin

`cdylib` crate, `wasm32-unknown-unknown` target:

```toml
# Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
stagespace-plugin-sdk = { path = "../plugin-sdk" }
serde_json = "1.0"

[profile.release]
lto = true
opt-level = "s"
panic = "abort"
```

```rust
// src/lib.rs
use stagespace_plugin_sdk::{get_f64, stagespace_plugin};

/// f(t, i, n, d, params) -> (x, y, z)
/// t = time (s), i = object index, n = n_objects, d = graph duration.
/// params = the node's params JSON (manifest params + plugin_id).
fn position(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64) {
    let radius = get_f64(params, "radius", 1.0);
    let phase = 2.0 * std::f64::consts::PI * (t / d.max(f64::EPSILON) + i as f64 / n.max(1) as f64);
    (radius * phase.cos(), 0.0, radius * phase.sin())
}

stagespace_plugin!(position);
```

`manifest.json` — see `plugin-examples/lemniscate/manifest.json` for the
full format (`id`, `abi_version: 1`, `kind: "engine"`, `params[]`).

## Build + package

```bash
cd my-plugin
cargo build --release --target wasm32-unknown-unknown

# packer (from plugin-sdk)
cargo run --release --features packer --bin stagespace-pack -- \
    manifest.json target/wasm32-unknown-unknown/release/mon_plugin.wasm \
    -o mon_plugin.ssx
```

## Install

Drop the `.ssx` into the plugins folder:

| OS | Path |
|---|---|
| Linux | `~/.local/share/com.stagespace.studio/plugins/` |
| macOS | `~/Library/Application Support/com.stagespace.studio/plugins/` |
| Windows | `%APPDATA%/com.stagespace.studio/plugins/` |

Then `reload_plugins` (UI or CLI) — the graph's `Plugin` node references
the plugin via `params.plugin_id = "<manifest id>"`.

## Rules of a good plugin

- **Deterministic**: `position(t, i, params)` must return the same value
  for the same inputs (the runtime samples in parallel and compares).
- **No mutable global state** beyond the ABI buffers.
- **Fast**: called at 60 FPS × n_objects — a call > ~100k instructions
  is killed by fuel (zero position for the frame).
- **Robust params**: always use defaults via `get_f64`/`get_bool`/`get_str`
  — params may be absent (old graphs, unset value).
- Finite returns: `NaN`/`inf` → the host converts to (0,0,0) but it's a bug.
