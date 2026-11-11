# Contributing to STAGESPACE

Thanks for your interest in contributing to STAGESPACE!
See also [AGENTS.md](AGENTS.md) for the detailed conventions.

## Development

### Prerequisites

- Rust 1.88+ (stable)
- Node.js 20+
- System deps (Linux): `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf`

### Setup

```bash
# Clone the repository
git clone https://github.com/dewiweb/stagespace.git
cd stagespace

# Build the Rust engines
cd rust-engines
cargo build

# Install the frontend (required by beforeBuildCommand)
cd ../tauri-app/frontend
npm install

# Run the Tauri application
cd ..
npm install
npm run tauri dev
```

### Project structure

```
stagespace/
├── rust-engines/          # Pure Rust engines
│   ├── src/
│   │   ├── engines/       # Trajectory engines
│   │   ├── runtime/       # Real-time runtime + MergeRuntime
│   │   ├── compiler.rs    # Graph compiler
│   │   ├── validator.rs   # Graph validation
│   │   ├── osc_sender.rs  # OSC out (+ extended spatial channels)
│   │   ├── osc_receiver.rs # OSC in (mappings, transforms, anti-loop)
│   │   ├── zones.rs       # Spatial effect zones
│   │   ├── kinematics.rs  # Kinematic modulations
│   │   ├── audio.rs       # Audio IN (cpal + realfft)
│   │   ├── logging.rs     # Structured logging
│   │   └── error.rs       # Error handling
│   └── Cargo.toml
├── tauri-app/
│   ├── src-tauri/         # Tauri shell (Rust)
│   │   ├── src/           # Tauri commands, AppState, CLI
│   │   └── tests/         # CLI E2E tests (e2e_cli_test.sh)
│   └── frontend/          # React + TypeScript UI
│       ├── src/
│       │   ├── components/ # React components
│       │   └── store/      # Zustand store
│       └── package.json
├── _archive/              # Old prototypes (OSCAI, POC) — reference only
└── README.md
```

## Tests

### Rust tests

```bash
cd rust-engines
cargo test --lib
cd ../tauri-app/src-tauri
cargo test --lib
bash tests/e2e_cli_test.sh   # CLI workflow E2E tests
```

### TypeScript tests

```bash
cd tauri-app/frontend
npm test           # vitest
npx tsc --noEmit   # type check
npm run lint       # eslint
```

## Code style

### Rust

- Use `cargo fmt` for formatting (checked in CI)
- Use `cargo clippy --all-targets` for warnings (checked in CI, `-D warnings`)
- Follow standard Rust conventions
- No `unwrap()` in production (test modules only)

### TypeScript

- Use ESLint (checked in CI)
- Follow standard TypeScript conventions
- Use strict types
- Tauri IPC via `safeInvoke` (`utils/tauri.ts`), not raw `invoke`

## Adding a new engine

1. Create a file in `rust-engines/src/engines/`
2. Implement the `Engine` trait
3. Add unit tests
4. Register the module in `rust-engines/src/engines/mod.rs`
5. Add the type to the graph parser (`tauri-app/src-tauri/src/graph/`)
6. Add the node in the frontend (`nodeParamSchema.ts`, `NodeType` in `store/types/`)

## Adding a node without modifying the app — WASM plugins (`.ssx`)

Third-party developers can create WASM nodes packaged as a `.ssx` bundle
(zip: `manifest.json` + `module.wasm`) — loaded at runtime, sandboxed
(wasmtime fuel, traps → zero position, no host imports), without
recompiling STAGESPACE. See `docs/PLUGINS_WASM.md` for the architecture
and `plugin-sdk/README.md` for the full author guide. In short:

```bash
# 1. cdylib crate, wasm32-unknown-unknown target, stagespace-plugin-sdk dep
# 2. fn position(t, i, n, d, params) -> (x, y, z) + stagespace_plugin!(position);
# 3. manifest.json (id, abi_version: 1, kind: "engine", params[])
cargo build --release --target wasm32-unknown-unknown
stagespace-pack manifest.json target/wasm32-unknown-unknown/release/my.wasm -o my.ssx
# 4. Install via the "Plugins" palette → "+ Import .ssx…" in the app,
#    or copy into <data_dir>/com.stagespace.studio/plugins/ then Rescan
```

Complete example: `plugin-examples/lemniscate/`. ABI v1 = engines
only (modifiers/composites → future ABI v2).

## Adding a new feature

1. Open an issue to discuss the feature
2. Fork the repository
3. Create a branch for your feature
4. Implement the feature with tests
5. Submit a pull request

## Logging

STAGESPACE uses `tracing` for logging. See `rust-engines/LOGGING.md` for details.

## Error handling

STAGESPACE uses `thiserror` for error handling. See `rust-engines/ERROR_HANDLING.md` for details.

## Questions

For any question, open an issue on GitHub.
