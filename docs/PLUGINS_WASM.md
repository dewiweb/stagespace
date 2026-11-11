# PLUGINS_WASM.md — WASM plugin system for custom nodes

Status: **shipped (v0.5.2) — phases 1+3+4+5 delivered + ABI v2** — functional host
runtime + Tauri integration (registry in AppState, commands
`list_plugins`/`reload_plugins`, `compile_graph_live` = single compile
path). 17 green plugin tests, generated TS contracts.

## Next steps (recommended order)

1. ~~**Phase 3 — Tauri**~~ ✅ `343b73d`: `AppState.plugin_registry`
   (`Arc<Mutex>`) + `plugins_dir` (`<data_dir>/com.stagespace.studio/plugins/`,
   created + scanned at boot, non-fatal errors); commands `list_plugins` /
   `reload_plugins` → `PluginRegistryReport { manifests, errors, plugins_dir }`;
   **`compile_graph_live(graph, &Shared)`** = single path (audio + OSC +
   plugins) for `activate_move`, `update_move_graph_merged` and cue
   respawn; `PluginManifest`/`PluginKind`/`PluginParamDef`/`PluginRegistryReport`
   exported via ts-rs. Note: errors reported in the report (frontend toasts)
   rather than events — sufficient while the scan is UI-triggered.
2. **Remaining phase 6/7** — plugin in the `MATH` pool of the generative
   fuzzer, `list_plugins` tauri test, `.ssx` import from the UI (dialog →
   copy into the folder + rescan), `CONTRIBUTING.md` + `AGENTS.md` docs,
   bundle icon.

Cross-cutting rule: **ABI v1 = engines only**; **ABI v2** adds
`kind: "modifier" | "composite"` — the upstream is passed to the guest
via a memory buffer (`plugin_inputs_ptr`), no host-callback (the guest
stays import-free). Delivered — see §2.3.

> Goal: let third-party developers extend STAGESPACE's node palette
> without recompiling the app, via WebAssembly modules packaged in a
> `.ssx` bundle (zip) containing code + declarative manifest.

## 1. Design principles

- **Unified registry, two backends** — the compiler no longer dispatches
  via a frozen `match NodeType` but via a `NodeRegistry`:
  ```rust
  enum NodeImpl {
      Native(Box<dyn Engine>),  // current built-ins, unchanged
      Wasm(PluginEngine),       // .ssx plugins
  }
  ```
  Built-ins are *registered* at boot (not recompiled to wasm — otherwise
  a build-time circular dependency + mandatory ABI v2 for modifiers).
  Real dogfooding: if the registry works for built-ins, it works for
  plugins. Migration to wasm possible later without changing the arch.
- **The plugin is a container node `NodeType::Plugin`** — `params.plugin_id`
  designates the plugin; the other params are those declared by the
  manifest. `NodeType` stays `Copy` (a `Custom(String)` variant would
  kill it), the `.hfg`/cues/snapshots format is unchanged. The UI shows
  the plugin name via the registry, not the raw type.
- **The manifest is the UI source of truth** — the plugin declares its
  params (schema) and its ports; `NodeParamsPanel` is already
  schema-driven (`ParamDef[]`), just wire the registry into it.
- **Strict sandbox** — untrusted third-party code in the 60 FPS loop:
  wasmtime + fuel + traps. No WASI, pure computation only.
- **No unstable Rust ABI** — dylib ruled out permanently (no stable ABI,
  cross-FFI panic, unmaintainable 3-platform packaging).
- **F(t) respected** — a plugin implements the same pure signature
  `position(t, i, n, d, params) -> Vec3` as the native engines.

## 2. `.ssx` bundle format

Zip archive with a dedicated extension (`.vsix` model):

```
lemniscate.ssx
├── manifest.json      (required, validated at load)
├── module.wasm        (required, wasm32-unknown-unknown, no WASI)
├── icon.svg           (optional — palette)
└── README.md          (optional — doc displayed in the app)
```

### 2.1 Manifest (`manifest.json`)

```json
{
  "id": "lemniscate",
  "name": "Lemniscate",
  "version": "1.0.0",
  "author": "...",
  "abi_version": 1,
  "kind": "engine",
  "category": "Plugins",
  "description": "Parametric figure-∞",
  "ports": { "inputs": ["input", "duration"], "outputs": ["trajectory"] },
  "params": [
    { "key": "scale",  "type": "number", "default": 1.0, "min": 0.1, "max": 10, "label": "Scale", "live": true },
    { "key": "aspect", "type": "number", "default": 1.414 }
  ],
  "capabilities": []
}
```

- `abi_version`: compatibility gate — the host refuses `abi_version > HOST_ABI` (=2).
- `kind`: `engine` (abi 1+), `modifier` | `composite` (abi 2 required — refused in v1).
- `params[]`: same types as frontend `ParamDef` (`number`, `boolean`,
  `enum`, `vec3`, `text`) — rendered directly by the existing `NodeParamField`.
- `capabilities`: deny by default; future `audio`, `osc_in`.

### 2.2 ABI v1 (host ↔ guest contract)

Target `wasm32-unknown-unknown`, no WASI. **Static** buffers in linear
memory — no alloc/free on the guest side (trivial SDK, allocator-free
WAT tests):

```rust
// Exported by the plugin
fn plugin_params_ptr() -> i32;   // ≥ 64 KB buffer reserved in .data
fn plugin_result_ptr() -> i32;   // 24-byte buffer ([f64;3]) in .data
fn plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32);
// + export "memory"
```

Host: serializes `params` JSON (64 KB cap) → writes at `params_ptr` →
calls `plugin_position` → reads 24 bytes at `result_ptr` →
`finite_or_zero`. Buffers are safe because the wasmtime `Store` is
`Mutex`-guarded per node (sequential access). Trap → zero position +
logged error (never propagated to the 60 FPS worker). `fuel` enabled:
per-call budget, an infinite loop traps instead of freezing the runtime.

### 2.3 ABI v2 — modifier / composite

ABI v2 adds one export and reuses `plugin_position` unchanged:

```rust
fn plugin_inputs_ptr() -> i32;   // 48-byte buffer ([f64;6]) in .data — REQUIRED if abi_version ≥ 2
```

Before each `plugin_position`, the host writes the current object's
upstream position(s) into the buffer: slot 0 (indices 0..3) =
`input`/`input_a`, slot 1 (indices 3..6) = `input_b`. The guest reads
them in linear memory — zero host-callback, the guest stays import-free.

| `kind` | Node ports | Inputs written | Semantics |
|---|---|---|---|
| `engine` | `input` (Objects), `duration` | — | `f(t)` source |
| `modifier` | `input` (trajectory) | 1 | wraps the upstream (like `Scale`) |
| `composite` | `input_a`, `input_b` | 2 | combines 2 upstreams (like `Mix`) |

The validator is kind-aware (`NodeId → PluginKind` map resolved by the
compiler from the registry): trajectory arity (modifier=1,
composite=2), `n_objects` compatibility, duration propagation follow
the rules of the same-named native nodes. Unknown kind → permissive
superset (exact arity is guaranteed at compile). SDK:
`stagespace_plugin_modifier!` and `stagespace_plugin_composite!`
generate the inputs buffer + the export.

## 3. Phased implementation plan

### Phase 1 — Host runtime (rust-engines) — ✅ `3527441`

- [x] `Cargo.toml`: `wasmtime` v38 (fuel enabled via `Config`), `zip` v2.4
- [x] `src/plugins/manifest.rs` — `PluginManifest` (serde) + validation
      (id, `abi_version ≤ HOST_ABI_VERSION`, kinds, param types)
- [x] `src/plugins/loader.rs` — `load_bundle`/`load_bundle_bytes`
      (zip → validated manifest → `wasmtime::Module` + ABI exports check)
- [x] `src/plugins/registry.rs` — `PluginRegistry`: `scan_dir`,
      `register_wasm` (tests/embedded), collected non-fatal errors
- [x] `src/plugins/wasm_engine.rs` — `PluginEngine` implements `Engine`:
      mutex-guarded Store, static buffers, 100k fuel/call, trap→zeros,
      first error logged via `log_plugin_error`
- [x] `src/graph.rs` — `NodeType::Plugin` (wire `"Plugin"`)
- [x] `src/compiler.rs` — `NodeType::Plugin` arm resolving `params.plugin_id`
      via `LiveInputs.plugins`; public `compile_with_live_inputs`
- [x] `src/validator.rs` — `Plugin` treated as engine: `input`+`duration`
      ports, feeds Output/composites/modifiers, sub-graph only,
      automatic n_objects arity
- [x] Minimal frontend: `'Plugin'` union, `connectionRules`, "Plugins"
      category, `plugin_id` schema
- [x] 14 inline WAT tests (`plugin_tests.rs`): positions, trap→zero,
      fuel, `.ssx` roundtrip, validate+compile+sample integration

### Phase 2 — Registry in the compiler

`Compiler` receives `plugins: Option<Arc<PluginRegistry>>` (builder
`.with_plugin_registry()`, default `None` → `Plugin` nodes fail at
compile with `InvalidParameter("plugin_id unknown or missing")`). src-tauri
call sites updated in Phase 3. The current `compile_engine` `match` stays
as-is in v1 — the unified `NodeImpl::{Native,Wasm}` registry is an
optional later refactoring; Phase 1 only adds the `NodeType::Plugin` arm
that consults the registry.

### Phase 3 — Tauri (src-tauri) — ✅ `343b73d`

- [x] `AppState.plugin_registry: Option<Arc<Mutex<PluginRegistry>>>` +
      `plugins_dir` — built in `.manage` (no AppHandle →
      `dirs::data_dir()` + identifier `com.stagespace.studio`)
- [x] `Shared.plugin_registry` propagated to compile call sites
- [x] `compile_graph_live(graph, &Shared)` — audio + OSC + plugins, used
      by `activate_move`, `update_move_graph_merged`, cue respawn
- [x] Commands: `list_plugins` / `reload_plugins` → `PluginRegistryReport`
      (manifests + formatted errors + folder path)
- [x] ts-rs: `PluginManifest`/`PluginKind`/`PluginParamDef`/
      `PluginRegistryReport` exported → contracts regenerated

### Phase 4 — Frontend — ✅ delivered

- [x] `store/types/index.ts`: `'Plugin'` in the `NodeType` union (Phase 1)
- [x] `utils/connectionRules.ts`: `Plugin` = engine rules (Phase 1)
- [x] `nodeParamSchema.ts`: "Plugins" category + `PARAM_SCHEMA['Plugin']`
      + helpers `pluginParamDefs`/`pluginNodeSchema`/`pluginDefaultParams`
      (manifest → `ParamDef`, defaults from `params[].default`)
- [x] `slices/pluginSlice.ts` in `useGraphStore`: `plugins`/`pluginErrors`/
      `pluginsDir`/`pluginsLoaded`, `fetchPlugins` (boot in App + lazy on
      NodeEditor mount), `reloadPlugins` (toasts + scan errors)
- [x] `NodeEditor.tsx`: dynamic "Plugins" category — one item per
      manifest (name + version + description/author tooltip), prefilled
      node creation (`plugin_id` + defaults), plugins folder hint when
      empty, scan errors displayed, ↻ Rescan button; the generic `Plugin`
      item stays for manual `plugin_id` entry
- [x] `NodeParamsPanel`: Plugin schema = `plugin_id` + manifest defs;
      chips show the plugin name (with indexed occurrence)
- [x] `CustomNode`: label = manifest name (fallback `data.label`),
      inline params merged into the expanded node
- [ ] `icon.svg` bundle icon in the palette (optional MVP)

### Phase 5 — Guest SDK (`stagespace-plugin-sdk`) — ✅ delivered

- [x] `plugin-sdk/` crate (minimal rlib — `serde_json` alone, zero native
      deps) + `stagespace_plugin!(fn)` macro (declarative macro, no
      proc-macro crate) generating the ABI exports: `plugin_params_ptr`,
      `plugin_result_ptr`, `plugin_position` — static 64 KB/24 B buffers,
      params deserialized to `serde_json::Value` + `get_f64`/`get_bool`/
      `get_str` helpers with defaults
- [x] `stagespace-pack` CLI (binary in the same crate, `packer`
      feature-gated → optional `zip` so no C compiles into the wasm32
      graph): `stagespace-pack manifest.json module.wasm -o out.ssx` +
      `--check`
- [x] `plugin-examples/lemniscate/` example (figure-∞, scale/aspect/
      speed params) compiled `wasm32-unknown-unknown`, packaged
      `lemniscate.ssx`, documented in `plugin-sdk/README.md` + dedicated README
- [x] End-to-end pipeline proven: `real_ssx_fixture_executes` loads the
      committed `.ssx` (`rust-engines/tests/fixtures/`) via `PluginRegistry` →
      `compile_with_live_inputs` → correct positions, JSON params received

### Phase 6 — Tests

- [x] **rust-engines**: inline WAT modules (`wasmtime` `wat` feature) —
      no wasm32 toolchain needed in CI. Cases: correct position, JSON
      params read, trap → zero + no panic, fuel exhausted → zero,
      invalid manifest → clean error, incompatible `abi_version` →
      refused (Phase 1)
- [x] **Real `.ssx` fixture** committed (`tests/fixtures/lemniscate.ssx`) —
      SDK→wasm→registry→compile→sample pipeline tested in CI without toolchain
- [x] **compiler_tests**: `Objects→Plugin→Output` graph compiles and samples
- [ ] **validator_tests**: Plugin accepted as engine, rejected as target
      of an invalid upstream modifier
- [ ] **generative_graph_tests**: `Plugin` in the `MATH` pool (with a
      registered test plugin) → automatic fuzz
- [ ] **tauri**: `list_plugins` on a fixture folder (1 valid + 1 broken
      manifest → error reported without global failure)
- [ ] **frontend**: palette shows the mocked plugin, `NodeParamsPanel`
      renders the dynamic schema

### Phase 7 — CI / release

- [ ] `ci.yml`: no new job required for the host (wasmtime compiles
      natively). Building the example plugin (wasm32 target) = optional
      separate job or committed precompiled artifact for fixtures
- [ ] Docs: "Developing a plugin" section in `CONTRIBUTING.md` +
      SDK README
- [ ] `AGENTS.md`: plugins section (folder, ABI, test commands)

## 4. Safety & real-time

| Risk | Mitigation |
|---|---|
| Infinite loop in the plugin | wasmtime `fuel` — 100k instr./call, set **before** `Instance::new` (`start` sections are bounded too), reset per call, fail-fast if the engine lacks `consume_fuel` |
| Plugin panic/crash | wasmtime traps — never host UB, zero position + logged once |
| Hostile `memory.grow` | `StoreLimits`: 32 MiB linear memory, 10k table elements, 1 memory per instance — fuel does NOT bound grow |
| Hostile memory declaration | Rejected at load: shared / memory64 / minimum > 512 pages (32 MiB) |
| Zip bomb | Decompression caps: `.ssx` file ≤ 64 MB, `manifest.json` ≤ 256 KB, `module.wasm` ≤ 16 MB — read via bounded `take()` |
| Destructive import | `import_plugin`: src == dest detected by `canonicalize` (copy skipped, never truncated), bounded size, `file_name` only (no traversal) |
| Blocking scan | `spawn_blocking` for scan/import — wasmtime compilation never runs on the async executor |
| Hostile allocation | Static ABI buffers, `params_len` 64 KB cap |
| I/O from the plugin | No WASI, **zero imports** — any module declaring an import is rejected at load |
| Malicious plugin | Wasm sandbox = untrusted code with no system access; bundle signature/checksum = later phase |

### Registry lifecycle

- `scan_dir` **reconciles**: a deleted `.ssx` unregisters its plugin on
  rescan (effective uninstall without restart)
- Two files declaring the same `manifest.id` → collected error
  ("duplicate plugin id"), deterministic alphabetical first-wins
- **Snapshot semantics**: already-compiled moves keep their
  `Arc<Plugin>` — a rescan only affects future compilations
- `register_wasm` (tests / future embedded) applies the same module
  validation as file bundles

## 5. Out of scope (v1 plugins)

- ✅ `kind: "modifier" | "composite"` — delivered via ABI v2 (§2.3)
- ❌ Host functions (`log`, `audio`, `osc_in`) — `capabilities` reserved
- ❌ Marketplace / signing / hardened sandboxing
- ❌ Hot-reload of a plugin during playback (a rescan only affects
  future compilations — active moves keep their snapshot)

## 6. Estimated effort

| Phase | Load | Risk |
|---|---|---|
| 1 — host runtime | M | Linear memory ABI (ptr/len handling) |
| 2 — compiler registry | S | `compile_graph` signature — touching call sites |
| 3 — Tauri | S | — |
| 4 — frontend | M | Dynamic palette (the rest is schema-driven) |
| 5 — SDK | M | Proc-macro (or simple codegen without macro in MVP) |
| 6 — tests | S | Inline WAT avoids the wasm32 toolchain in CI |
| 7 — CI/docs | XS | — |

The trickiest point is the linear memory ABI (alloc/free/write/read of
`plugin_position`). The rest is plumbing into already-clean seams
(Engine trait, registry, schema-driven UI).
