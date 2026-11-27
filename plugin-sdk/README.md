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
/// params = the node's params JSON (manifest params + plugin_id — the
/// host also injects resolved "duration"/"n_objects" keys; prefer the
/// typed d/n arguments).
fn position(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64) {
    let radius = get_f64(params, "radius", 1.0);
    let phase = 2.0 * std::f64::consts::PI * (t / d.max(f64::EPSILON) + i as f64 / n.max(1) as f64);
    (radius * phase.cos(), 0.0, radius * phase.sin())
}

stagespace_plugin!(position);
```

`manifest.json` — see `plugin-examples/lemniscate/manifest.json` for the
full format (`id`, `abi_version: 1`, `kind: "engine"`, `params[]`).

## ABI v2 — modifier & composite plugins

An **engine** plugin is a pure `f(t)` source. Two more kinds can wrap or
combine existing trajectories — declare `"abi_version": 2` and use the
matching macro; the host writes the upstream position(s) into a memory
buffer before each call (no host callback, the guest stays import-free):

```rust
use stagespace_plugin_sdk::{get_f64, stagespace_plugin_modifier};

// kind: "modifier" — 1 trajectory input (port `in`), like `Scale`/`Offset`.
fn position(
    t: f64, i: usize, n: usize, d: f64,
    params: &serde_json::Value,
    input: (f64, f64, f64),   // upstream position of object i at time t
) -> (f64, f64, f64) {
    let amp = get_f64(params, "amp", 0.5);
    (input.0, input.1 + amp * t.sin(), input.2)
}

stagespace_plugin_modifier!(position);
```

```rust
// kind: "composite" — 2 trajectory inputs (ports `a`/`b`), like `Mix`.
fn position(
    t: f64, i: usize, n: usize, d: f64,
    params: &serde_json::Value,
    a: (f64, f64, f64), b: (f64, f64, f64),
) -> (f64, f64, f64) { /* … */ }

stagespace_plugin_composite!(position);
```

Full working examples: `plugin-examples/wobble/` (modifier),
`plugin-examples/morph/` (composite). Arity is strict — a modifier node
takes exactly 1 trajectory input, a composite exactly 2 (enforced at
validation *and* at compile).

## Build + package

```bash
cd my-plugin
cargo build --release --target wasm32-unknown-unknown
```

The packer is a feature-gated binary of the SDK crate — build it once
from `plugin-sdk/`:

```bash
cd plugin-sdk
cargo build --release --features packer   # produces target/release/stagespace-pack
```

then package from the plugin directory (`cargo run --bin stagespace-pack`
only resolves inside the SDK crate itself — call the built binary):

```bash
cd my-plugin
<path-to>/plugin-sdk/target/release/stagespace-pack manifest.json \
    target/wasm32-unknown-unknown/release/mon_plugin.wasm -o mon_plugin.ssx
```

`stagespace-pack --check manifest.json` validates a manifest without
packing. The packer writes exactly `manifest.json` + `module.wasm` into
the zip — the manifest is re-validated (same rules as the host) and the
wasm magic bytes checked before packing.

## Install

Either use the "**+ Import .ssx…**" button in the app's Plugins palette
(file dialog → validated copy into the plugins folder + rescan), or drop
the `.ssx` into the plugins folder manually:

| OS | Path |
|---|---|
| Linux | `~/.local/share/com.stagespace.studio/plugins/` |
| macOS | `~/Library/Application Support/com.stagespace.studio/plugins/` |
| Windows | `%APPDATA%/com.stagespace.studio/plugins/` |

then hit **↻ Rescan plugins** in the palette (the `reload_plugins` Tauri
command; the `stagespace-cli` scans the folder once at startup). The
graph's `Plugin` node references the plugin via
`params.plugin_id = "<manifest id>"`. Removing a `.ssx` + rescanning
uninstalls it — already-compiled moves keep their snapshot, only future
compilations see the change.

## Rules of a good plugin

- **Deterministic**: `position(t, i, params)` must return the same value
  for the same inputs — the same compiled function is sampled by several
  consumers (live 60 FPS worker, UI preview, cue/move recompiles,
  crossfades overlapping two evaluations); non-deterministic output shows
  up as position jumps.
- **No mutable global state** beyond the ABI buffers.
- **Fast**: called at 60 FPS × n_objects — a call > ~100k instructions
  is killed by fuel (zero position for the frame).
- **Robust params**: always use defaults via `get_f64`/`get_bool`/`get_str`
  — params may be absent (old graphs, unset value).
- Finite returns: `NaN`/`inf` → the host converts to (0,0,0) but it's a bug.
- **No imports**: the sandbox is total — a module declaring any wasm
  import is rejected at load (no WASI, no host functions; time comes in
  as the `t` argument, there is no randomness source — seed your own
  deterministic PRNG from `t`/`i` if needed).
