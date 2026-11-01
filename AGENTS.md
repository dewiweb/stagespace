# AGENTS.md — Stagespace

## Project Overview

Stagespace is a real-time spatial trajectory engine for OSC-controlled audio sources.
Architecture: Rust engines + Tauri shell + React/TypeScript frontend.

## Repository Layout

```
stagespace/
├── rust-engines/          # Core Rust library (engines, runtime, compiler, merge)
│   └── src/plugins/       # WASM plugin host (.ssx bundles, wasmtime, registry)
├── plugin-sdk/            # Guest SDK + stagespace-pack CLI (.ssx packer)
├── plugin-examples/       # Example plugins (lemniscate — wasm32-unknown-unknown)
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
cargo test --lib         # Run tests (519 tests, incl. ts-rs export tests)
cargo clippy --all-targets -- -D warnings  # Lint (CI: --all-targets inclut tests/benches)
cargo fmt -- --check     # Format check
```

### Tauri backend

```bash
cd tauri-app/src-tauri
cargo build              # Build
cargo test --lib         # Run tests (72 tests)
cargo clippy --all-targets -- -D warnings  # Lint (CI: --all-targets inclut tests)
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
npm test                 # Run tests (383 tests, vitest)
npm run contracts        # Regenerate TS types from Rust (ts-rs → src/types/generated/)
npm run test:watch       # Watch mode
npx tsc -b               # Type check (build mode — `tsc --noEmit` is vacuous on the solution-style root tsconfig)
```

### Full verification (run before committing)

```bash
# Rust
cd rust-engines && cargo test --lib && cargo clippy --all-targets -- -D warnings && cargo fmt -- --check
# Tauri
cd ../tauri-app/src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings && cargo fmt -- --check
# Frontend
cd ../frontend && npm run lint && npm test && npx tsc -b && npm run build
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
- Async Tauri command tests: use `tauri::async_runtime::block_on` inside ordinary `#[test]` functions; no direct Tokio dependency is needed.

### Frontend (TypeScript/React)
- **Namespace boundary** — `obj_index` (0-based position dans `osc_ids`) vs `track_id` (le N de `/track/N`) sont DEUX espaces distincts. Wire/backend parle `obj_index` partout (`manual_positions`, `objectStates`, `emittedPositions`, `anchor_target`, `psn tracker_map`, `/stagespace/position <obj>`) ; les UIs opérateur parlent `track_id` (`slot.trackIds`, `manualOscIds`, `trackpos`). Conversion obligatoire à la frontière : `objIdx = manualOscIds.indexOf(trackId)` — jamais `objectStates[trackId]` (off-by-one pour tracks 1-based).
- State management: Zustand with slice pattern (`src/store/slices/`)
- Tests: vitest + jsdom, mocks in `src/test/setup.ts`, helpers in `src/store/__tests__/testHelpers.ts`
- Tauri IPC: use `safeInvoke` from `utils/tauri.ts` (not raw `invoke`)
- No `console.log` in production code (use `console.error` for error paths only)

### Generated contracts (ts-rs)

Wire types shared between Rust and the frontend are generated, not mirrored
by hand. `#[derive(TS)] + #[ts(export)]` on the Rust type emits a `.ts` file
into `tauri-app/frontend/src/types/generated/` (committed). Regenerate after
editing a contract: `npm run contracts` (or `bash scripts/gen_contracts.sh`).
CI fails if the committed files drift from the Rust sources.

## Test Counts

| Suite | Count |
|-------|-------|
| Rust engines | 519 |
| Tauri backend | 72 |
| Frontend (vitest) | 383 |
| E2E CLI | 125 |
| **Total** | **1099** |

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
- `Enter` — GO : advance setlist (crossfade to next move)
- `Shift+Enter` — RECALL next cue (kills all moves + respawns snapshot)
- `Backspace` — previous cue (recall)
- `Esc` — Panic (stop all + send origin positions)
- `Ctrl+Z` / `Ctrl+Y` — Undo/Redo
- Cue list: click = arm, double-click = recall (no single-click scene kill)
- Shortcuts disabled when typing in input fields

## OSC Show Control (`/stagespace/*`)

Reserved OSC-IN prefix, intercepted in `osc_receiver::handle_packet` BEFORE
user mappings (these messages never reach mappings or `last_by_address`).
Backend only routes: parsed command → `show-control` event → frontend
dispatches to the same functions as the keyboard shortcuts (`liveActions.ts`).

| Address | Action | Shortcut |
|---------|--------|----------|
| `/stagespace/go` | setlist GO | Enter |
| `/stagespace/cue/next` | recall next cue | Shift+Enter |
| `/stagespace/cue/prev` | recall previous cue | Backspace |
| `/stagespace/cue/recall <n> [fade]` | recall cue by `cue_number` (string/num, fallback 1-based index); `fade` overrides the stored fade | — |
| `/stagespace/panic` | panic (stop all + origins) | Esc |
| `/stagespace/stop` | stop all moves | — |
| `/stagespace/timecode <s|"HH:MM:SS:FF">` | TC chase (fps 24/25/30, default 25, `set_timecode_fps`) | — |
| `/stagespace/timecode/chase <0|1>` | chase TC on/off | — |
| `/stagespace/timecode/fps <n>` | fps du format TC string | — |
| `/stagespace/cue/arm <n>` | arme une cue sans la tirer (modèle console) | — |
| `/stagespace/cue/go` | tire la cue armée (ou la suivante si rien d'armé) | — |
| `/stagespace/macro <name> <v>` | macro globale : speed, scale, shift_x/y/z, yaw, pitch, roll, radius_scale, height_offset | — |
| `/stagespace/positions` | dump positions émises → `/stagespace/pos/state <obj> <x> <y> <z>` par objet (backend-direct, pas de webview) | — |
| `/stagespace/arm` | re-arm OSC output (quitte le dry-run) | — |
| `/stagespace/disarm` | dry-run — tout tourne, rien ne part au renderer | — |
| `/stagespace/status` | force le renvoi du feedback cue au contrôleur | — |
| `/stagespace/park <obj>` | geler un objet (survit aux recalls Full/Tracking, panic, arm) | — |
| `/stagespace/unpark <obj>` | dégeler l'objet | — |
| `/stagespace/slot <n>` | jouer le slot d'`oscIndex` n (busking, fade_in du slot) | — |
| `/stagespace/slot/stop <n>` | stopper le slot n (fade_out du slot) | — |
| `/stagespace/solo <n>` | fade-out tous les autres slots puis jouer n | — |
| `/stagespace/unsolo` | rejoue les slots stoppés par le dernier solo (restore) | — |
| `/stagespace/position <obj> <x> <y> <z>` | position manuelle d'un objet (reprise opérateur) | — |
| `/stagespace/position/clear <obj>` | retire la position manuelle | — |
| `/stagespace/position/clearall` | toutes les positions manuelles | — |
| `/stagespace/trackpos <track> <x> <y> <z>` | position d'origine d'une track (là où panic la renvoie) | — |

### Sémantique « continue » (per-move)

Chaque move/slot porte deux flags (Playback tab : `End`, `Anchor`) :

- **`End: hold`** — à la fin d'un one-shot, les dernières positions sont
  écrites en positions manuelles : l'objet reste où le move l'a laissé
  (au lieu de revenir à la base — `revert` par défaut).
- **`Anchor: current`** — au spawn, chaque objet capture sa dernière
  position émise comme ancre (`delta = capturée − traj(0)`) : le move
  part de là où l'objet est, sans saut — chaînage move→move.

Combinés : `hold` fige l'objet à `f(T)`, `current` sur le move suivant
continue depuis ce point — sémantique « release/peg-out » des consoles.
| `/stagespace/position <obj> <x> <y> <z>` | position manuelle (reprise opérateur — prioritaire) | — |
| `/stagespace/position/clear <obj>` | retire la position manuelle de l'objet | — |
| `/stagespace/position/clearall` | retire toutes les positions manuelles | — |
| `/stagespace/trackpos <track> <x> <y> <z>` | position d'origine d'une track (où panic renvoie) | — |

Rejection & feedback: commands refused while `isRecalling` or on unknown
cue/slot get `/stagespace/nack <reason>` back to the sender (`busy:…`,
`not-found:…`) — slot commands during a recall are nacked rather than
orphaned. Every accepted command gets `/stagespace/ack <addr>`; the 4 most
recent controllers also receive `/stagespace/cue/current <n> <name>` and
`/stagespace/cue/next <n> <name>` after each cue change
(`send_show_feedback`).

Cue fields (`Cue`): `mode` (Full|Tracking), `scope` (8 category flags),
`pre_wait`, `follow`, `timecode`. Tracking cues merge channels/positions
(never clear-all), never stop unlisted moves; TC-fired recalls skip pre_wait.
