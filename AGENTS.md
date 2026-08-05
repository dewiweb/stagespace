# AGENTS.md — Stagespace

## Project Overview

Stagespace is a real-time spatial trajectory engine for OSC-controlled audio sources.
Architecture: Rust engines + Tauri shell + React/TypeScript frontend.

## Repository Layout

```
stagespace/
├── rust-engines/          # Core Rust library (engines, runtime, compiler, merge)
├── tauri-app/
│   ├── src-tauri/         # Tauri backend (Rust commands, AppState, IPC)
│   └── frontend/          # React + TypeScript + Vite frontend
├── .github/workflows/     # CI pipeline
└── AGENTS.md              # This file
```

## Prerequisites

- **Rust**: stable toolchain (1.88+)
- **Node.js**: 20+
- **System deps (Linux)**: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

## Build Commands

### Rust engines (core library)

```bash
cd rust-engines
cargo build              # Build
cargo test --lib         # Run tests (191 tests)
cargo clippy --lib --all-targets -- -D warnings  # Lint
cargo fmt -- --check     # Format check
```

### Tauri backend

```bash
cd tauri-app/src-tauri
cargo build              # Build
cargo test --lib         # Run tests (27 tests)
cargo clippy --lib -- -D warnings  # Lint
```

### CLI (workflow testing tool)

```bash
cd tauri-app/src-tauri
cargo build --bin stagespace-cli                    # Build CLI
cargo clippy --bin stagespace-cli -- -D warnings    # Lint CLI
bash tests/e2e_cli_test.sh                          # Run E2E workflow tests (34 tests)

# Usage
./target/debug/stagespace-cli "templates"                                          # List templates
./target/debug/stagespace-cli "activate-move circle --tracks 1-5; sample --move circle-1 --obj 0; stop-all"
./target/debug/stagespace-cli --file script.txt                                    # Run from file
./target/debug/stagespace-cli                                                       # Interactive REPL
```

### Frontend

```bash
cd tauri-app/frontend
npm install              # Install deps
npm run dev              # Dev server (Vite)
npm run build            # Production build (tsc + vite build)
npm test                 # Run tests (113 tests, vitest)
npm run test:watch       # Watch mode
npx tsc --noEmit         # Type check only
```

### Full verification (run before committing)

```bash
# Rust
cd rust-engines && cargo test --lib && cargo clippy --lib -- -D warnings && cargo fmt -- --check
# Tauri
cd ../tauri-app/src-tauri && cargo test --lib && cargo clippy --lib -- -D warnings
# Frontend
cd ../frontend && npm test && npx tsc --noEmit && npm run build
```

## CI

GitHub Actions runs three jobs on push/PR to main:
1. **Rust Engines** — fmt check, clippy (deny warnings), tests
2. **Tauri Backend** — clippy (deny warnings), tests, CLI clippy, E2E CLI workflow tests
3. **Frontend** — tsc, vitest, vite build

See `.github/workflows/ci.yml`.

## Code Conventions

### Rust
- Lock poisoning: use `unwrap_or_else(|e| e.into_inner())` for all Mutex/RwLock accesses
- No `unwrap()` in production code (test modules only)
- Error handling: `crate::error::StagespaceError` enum with `Result<T, StagespaceError>`
- Logging: `crate::logging::log_osc_error()` for OSC errors

### Frontend (TypeScript/React)
- State management: Zustand with slice pattern (`src/store/slices/`)
- Tests: vitest + jsdom, mocks in `src/test/setup.ts`, helpers in `src/store/__tests__/testHelpers.ts`
- Tauri IPC: use `safeInvoke` from `utils/tauri.ts` (not raw `invoke`)
- No `console.log` in production code (use `console.error` for error paths only)

## Test Counts

| Suite | Count |
|-------|-------|
| Rust engines | 191 |
| Tauri backend | 27 |
| Frontend (vitest) | 113 |
| **Total** | **331** |
