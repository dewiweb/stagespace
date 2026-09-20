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
- **System deps (Linux)**: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf` (`libasound2-dev` requis par `cpal`/`alsa-sys` pour la capture audio native)

## Build Commands

### Rust engines (core library)

```bash
cd rust-engines
cargo build              # Build
cargo test --lib         # Run tests (358 tests)
cargo clippy --lib --all-targets -- -D warnings  # Lint
cargo fmt -- --check     # Format check
```

### Tauri backend

```bash
cd tauri-app/src-tauri
cargo build              # Build
cargo test --lib         # Run tests (29 tests)
cargo clippy --lib -- -D warnings  # Lint
```

### CLI (workflow testing tool)

```bash
cd tauri-app/src-tauri
cargo build --bin stagespace-cli                    # Build CLI
cargo clippy --bin stagespace-cli -- -D warnings    # Lint CLI
bash tests/e2e_cli_test.sh                          # Run E2E workflow tests (122 tests)

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
npm test                 # Run tests (173 tests, vitest)
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
| Rust engines | 358 |
| Tauri backend | 29 |
| Frontend (vitest) | 173 |
| E2E CLI | 122 |
| **Total** | **682** |

## Live Show Safety Features

### Toast Notification System
- All backend command failures surface as toast notifications (bottom-right)
- `toast.error/warning/info/success` helpers in `utils/toast-helpers.ts`
- Sticky toasts (timeout=0) for critical issues like storage full

### OSC Error Monitoring
- `PerfStats.osc_error_rate` tracked in MergeRuntime (packet failures / total)
- Frontend polls `get_perf_stats` every 500ms during playback
- Toast alert when error rate > 5% (shown once per playback session)

### Cue Recall Atomicity
- `recall_in_progress: AtomicBool` in AppState prevents concurrent recalls
- RAII `RecallGuard` ensures flag is cleared even on panic
- Frontend `isRecalling` state also blocks double-clicks in UI

### OSC Config Lock
- `setOscAddress/Port/Profile/InPort` check `movements.length > 0` before applying
- Warning toast shown if user tries to change config during playback

### Storage Safety
- `safeSetItem` in `utils/safeStorage.ts` wraps localStorage with quota error detection
- Sticky toast on `QuotaExceededError` — warns user to export immediately

### Keyboard Shortcuts (Live)
- `Space` — play/stop selected move
- `Enter` — GO to next cue
- `Backspace` — Go to previous cue
- `Esc` — Panic (stop all + send origin positions)
- `Ctrl+Z` / `Ctrl+Y` — Undo/Redo
- Shortcuts disabled when typing in input fields
