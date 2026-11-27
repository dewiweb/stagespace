# PLUGINS_WASM.md — WASM plugin system for custom nodes

Status: **shipped (v0.5.2) — phases 1+2+3+4+5 delivered + ABI v2, phase 6
mostly delivered** — functional host runtime + Tauri integration (registry
in AppState, commands `list_plugins`/`reload_plugins`/`import_plugin`,
`compile_graph_live` = single compile path). 31 green host plugin tests
(+ 6 tauri command tests, + frontend slice/connection-rules tests),
3 committed `.ssx` fixtures (lemniscate/wobble/morph), generated TS
contracts.

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
   `d21601b` added the **`import_plugin`** command (validate-before-copy,
   duplicate-id refusal, symlink protection) + UI "+ Import .ssx…" dialog.
2. **Remaining** — `AGENTS.md` plugins section (folder, ABI, test
   commands — `CONTRIBUTING.md` ✅ done), bundle `icon.svg` in the
   palette, frontend palette/params-panel render tests, optional CI job
   building the example plugins (wasm32 target — today the fixtures are
   committed precompiled).

Cross-cutting rule: **ABI v1 = engines only**; **ABI v2** adds
`kind: "modifier" | "composite"` — the upstream is passed to the guest
via a memory buffer (`plugin_inputs_ptr`), no host-callback (the guest
stays import-free). Delivered — see §2.3.

> Goal: let third-party developers extend STAGESPACE's node palette
> without recompiling the app, via WebAssembly modules packaged in a
> `.ssx` bundle (zip) containing code + declarative manifest.

## 1. Design principles

- **Unified registry, two backends** — *target design, not implemented as
  such*: the shipped compiler still dispatches via `match NodeType`, with
  a dedicated `NodeType::Plugin` arm resolving `params.plugin_id` in the
  `PluginRegistry` (see Phase 2). The unified `NodeRegistry` —
  ```rust
  enum NodeImpl {
      Native(Box<dyn Engine>),  // current built-ins, unchanged
      Wasm(PluginEngine),       // .ssx plugins
  }
  ```
  — remains an optional later refactoring. Built-ins would be *registered*
  at boot (not recompiled to wasm — otherwise a build-time circular
  dependency + mandatory ABI v2 for modifiers). Real dogfooding: if the
  registry works for built-ins, it works for plugins. Migration to wasm
  possible later without changing the arch.
- **The plugin is a container node `NodeType::Plugin`** — `params.plugin_id`
  designates the plugin; the other params are those declared by the
  manifest. `NodeType` stays a fieldless enum — a `Custom(String)` variant
  would complicate every `match` and the wire format — the
  `.hfg`/cues/snapshots format is unchanged. The UI shows the plugin name
  via the registry, not the raw type.
- **The manifest is the UI source of truth** — the plugin declares its
  params (schema); its ports derive from `kind` (engine/modifier/composite).
  `NodeParamsPanel` is already schema-driven (`ParamDef[]`), just wire the
  registry into it.
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
├── icon.svg           (optional — palette; reserved, not yet read anywhere)
└── README.md          (optional — doc displayed in the app; reserved, not yet read anywhere)
```

Only the two required entries are read today — `stagespace-pack` writes
exactly those two, and extra entries in the zip are ignored at load.

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
  "ports": { "inputs": ["objects", "duration"], "outputs": ["trajectory"] },
  "params": [
    { "key": "scale",  "type": "number", "default": 1.0, "min": 0.1, "max": 10, "label": "Scale", "live": true },
    { "key": "aspect", "type": "number", "default": 1.414 }
  ],
  "capabilities": []
}
```

- `abi_version`: compatibility gate — the host refuses `abi_version > HOST_ABI` (=2)
  and `abi_version: 0`.
- `kind`: `engine` (abi 1+), `modifier` | `composite` (abi 2 required — refused in v1).
- `ports`: **informational only, ignored at load** — the node's effective
  ports derive from `kind` (see §2.3), not from this declaration.
- `params[]`: same types as frontend `ParamDef` (`number`, `boolean`,
  `enum`, `vec3`, `text`, `string`) — rendered directly by the existing
  `NodeParamField`. Validated at load: non-empty unique keys, `enum`
  requires `options`, `min < max`.
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
`in`/`a`, slot 1 (indices 3..6) = `b`. The guest reads
them in linear memory — zero host-callback, the guest stays import-free.

| `kind` | Node ports (graph-level names) | Inputs written | Semantics |
|---|---|---|---|
| `engine` | `objects` (ObjectSet), `duration` (Duration) | — | `f(t)` source |
| `modifier` | `in` (Positions, required) | 1 | wraps the upstream (like `Scale`) |
| `composite` | `a` + `b` (Positions, required) | 2 | combines 2 upstreams (like `Mix`) |

The validator is kind-aware (`NodeId → PluginKind` map resolved by the
compiler from the registry): trajectory arity (modifier=1,
composite=2), `n_objects` compatibility, duration propagation follow
the rules of the same-named native nodes. Unknown kind → permissive
superset (exact arity is guaranteed at compile). Arity is **strict**,
enforced both at validation (ports don't exist beyond the kind's own)
and at compile (defense in depth: a modifier compiled without
validation with 0 or 2 upstreams fails with "requires exactly 1
trajectory input" rather than silently ignoring one). SDK:
`stagespace_plugin_modifier!` and `stagespace_plugin_composite!`
generate the inputs buffer + the export. Examples:
`plugin-examples/wobble/` (modifier), `plugin-examples/morph/`
(composite).

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
- [x] `src/compiler.rs` (since split into `src/compiler/` — mod.rs +
      plugins.rs) — `NodeType::Plugin` arm resolving `params.plugin_id`
      via `LiveInputs.plugins`; public `compile_with_live_inputs`
- [x] `src/validator.rs` — `Plugin` treated as engine: `objects`+`duration`
      ports, feeds Output/composites/modifiers, sub-graph only,
      automatic n_objects arity (kind-aware since ABI v2 — §2.3)
- [x] Minimal frontend: `'Plugin'` union, `connectionRules`, "Plugins"
      category, `plugin_id` schema
- [x] 14 inline WAT tests (`plugin_tests.rs`): positions, trap→zero,
      fuel, `.ssx` roundtrip, validate+compile+sample integration —
      since grown to **31** (ABI v2 kinds, strict arity, security
      hardening: imports/memory caps, scan reconciliation/truncation,
      3 real `.ssx` fixtures)

### Phase 2 — Registry in the compiler — ✅ delivered

`LiveInputs.plugins: Option<Arc<Mutex<PluginRegistry>>>` (plain public
field, no builder — the `.with_plugin_registry()` sketched originally was
never added). Default `None` → `Plugin` nodes fail at compile with
`InvalidParameter` ("Plugin node requires a plugin registry…" / "unknown
plugin_id '…'"). src-tauri call sites updated in Phase 3. The current
`compile_node` `match` stays as-is — the unified `NodeImpl::{Native,Wasm}`
registry is an optional later refactoring; what shipped is the
`NodeType::Plugin` arm consulting the registry, dispatching by
`manifest.kind` (`compile_plugin` in `compiler/plugins.rs`).

### Phase 3 — Tauri (src-tauri) — ✅ `343b73d`

- [x] `AppState.plugin_registry: Option<Arc<Mutex<PluginRegistry>>>` +
      `plugins_dir` — built in `.manage` (no AppHandle →
      `dirs::data_dir()` + identifier `com.stagespace.studio`)
- [x] `Shared.plugin_registry` propagated to compile call sites
- [x] `compile_graph_live(graph, &Shared)` — audio + OSC + plugins, used
      by `activate_move`, `update_move_graph_merged`, cue respawn
- [x] Commands: `list_plugins` / `reload_plugins` → `PluginRegistryReport`
      (manifests + formatted errors + folder path); `import_plugin` ✅
      `d21601b` — validate-before-copy (invalid bundle or duplicate id
      refused **before** anything lands in the folder), bounded size,
      `file_name` only (no traversal), src == dest no-op, symlink dest
      refused, copy + rescan in `spawn_blocking`
- [x] ts-rs: `PluginManifest`/`PluginKind`/`PluginParamDef`/
      `PluginRegistryReport` exported → contracts regenerated

### Phase 4 — Frontend — ✅ delivered

- [x] `store/types/index.ts`: `'Plugin'` in the `NodeType` union (Phase 1)
- [x] `utils/connectionRules.ts`: `Plugin` rules — engine superset at
      Phase 1, kind-aware since ABI v2 (`effectiveInputPorts(type,
      pluginKind)` mirrors `NodeSpec::plugin_input_ports`)
- [x] `nodeParamSchema.ts`: "Plugins" category + `PARAM_SCHEMA['Plugin']`
      + helpers `pluginParamDefs`/`pluginNodeSchema`/`pluginDefaultParams`
      (manifest → `ParamDef`, defaults from `params[].default`)
- [x] `slices/pluginSlice.ts` in `useGraphStore`: `plugins`/`pluginErrors`/
      `pluginsDir`/`pluginsLoaded`, `fetchPlugins` (boot in App + lazy on
      NodeEditor mount), `reloadPlugins` (toasts + scan errors),
      `importPlugin` (`.ssx` dialog import → `import_plugin` command)
- [x] `NodeEditor.tsx`/`NodePalette.tsx`: dynamic "Plugins" category — one
      item per manifest (name + version + description/author tooltip),
      prefilled node creation (`plugin_id` + defaults), plugins folder hint
      when empty, scan errors displayed, ↻ Rescan button, "+ Import .ssx…"
      button (file dialog → copy + rescan); the generic `Plugin` item
      stays for manual `plugin_id` entry
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
- [x] `stagespace_plugin_modifier!` / `stagespace_plugin_composite!`
      macros (ABI v2) — same declarative style, generate the additional
      `plugin_inputs_ptr` export + read the upstream position(s)
- [x] `plugin-examples/lemniscate/` example (figure-∞, scale/aspect/
      speed params) compiled `wasm32-unknown-unknown`, packaged
      `lemniscate.ssx`, documented in `plugin-sdk/README.md` + dedicated README
- [x] `plugin-examples/wobble/` (modifier — circular oscillation around
      the upstream, amp/freq params) and `plugin-examples/morph/`
      (composite — `a·(1−w) + b·w` blend) — ABI v2 examples, compiled and
      packaged the same way
- [x] End-to-end pipeline proven: `real_ssx_fixture_executes` loads the
      committed `.ssx` (`rust-engines/tests/fixtures/`) via `PluginRegistry` →
      `compile_with_live_inputs` → correct positions, JSON params received —
      plus `real_ssx_modifier_fixture_executes` (wobble) and
      `real_ssx_composite_fixture_executes` (morph) for ABI v2

### Phase 6 — Tests

- [x] **rust-engines**: inline WAT modules (`wasmtime` `wat` feature) —
      no wasm32 toolchain needed in CI. Cases: correct position, JSON
      params read, trap → zero + no panic, fuel exhausted → zero,
      invalid manifest → clean error, incompatible `abi_version` →
      refused (Phase 1)
- [x] **Real `.ssx` fixtures** committed (`tests/fixtures/lemniscate.ssx`
      + `wobble.ssx` + `morph.ssx`) — SDK→wasm→registry→compile→sample
      pipeline tested in CI without toolchain
- [x] **compiler_tests**: `Objects→Plugin→Output` graph compiles and samples
      (`plugin_graph_compiles_and_samples` in `plugin_tests.rs`; strict
      modifier arity covered by `modifier_plugin_with_two_inputs_fails`)
- [x] **validator coverage**: kind-aware validation exercised in
      `plugin_tests.rs` (`plugin_graph_validates`,
      `modifier_plugin_without_upstream_fails` — Objects is not a valid
      trajectory upstream) rather than in `validator_tests.rs` itself
- [x] **generative_graph_tests**: `Plugin` in the `MATH` pool — the fuzz
      registry embeds the compiled lemniscate module, graphs containing a
      `NodeType::Plugin` are compiled/sampled automatically
- [x] **tauri**: `commands/plugins.rs` tests — fixture folder (1 valid +
      1 broken → error reported without global failure), same-file import
      no-op, symlink dest refused, missing source error, real copy
- [ ] **frontend**: palette shows the mocked plugin, `NodeParamsPanel`
      renders the dynamic schema — partially covered instead by
      `pluginSlice.test.ts` (fetch/reload/import toasts) and
      `pluginConnectionRules.test.ts` (kind-aware port rules); no
      component render test yet

### Phase 7 — CI / release

- [ ] `ci.yml`: no new job required for the host (wasmtime compiles
      natively). Building the example plugin (wasm32 target) = optional
      separate job or committed precompiled artifact for fixtures
      (current choice: committed precompiled fixtures)
- [x] Docs: "Developing a plugin" section in `CONTRIBUTING.md` +
      SDK README
- [ ] `AGENTS.md`: plugins section (folder, ABI, test commands) — the
      repo layout mentions `plugin-sdk/`/`plugin-examples/` but there is
      no dedicated section yet

## 4. Safety & real-time

| Risk | Mitigation |
|---|---|
| Infinite loop in the plugin | wasmtime `fuel` — 100k instr./call, set **before** `Instance::new` (`start` sections are bounded too), reset per call, fail-fast if the engine lacks `consume_fuel` |
| Plugin panic/crash | wasmtime traps — never host UB, zero position + logged once |
| Hostile `memory.grow` | `StoreLimits`: 32 MiB linear memory, 10k table elements, 1 memory per instance — fuel does NOT bound grow |
| Hostile memory declaration | Rejected at load: shared / memory64 / minimum > 512 pages (32 MiB) |
| Zip bomb | Decompression caps: `.ssx` file ≤ 64 MB, `manifest.json` ≤ 256 KB, `module.wasm` ≤ 16 MB — read via bounded `take()` |
| Destructive import | `import_plugin`: bundle validated + duplicate id refused **before copy** (no broken relic re-failing at every scan), src == dest detected by `canonicalize` (copy skipped, never truncated), symlink dest refused, bounded size, `file_name` only (no traversal) |
| Endless scan | `scan_dir` caps at **256 `.ssx` per scan** — extras reported in `errors()` (not silently ignored) |
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
