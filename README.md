# STAGESPACE — Spatial Trajectory Engine

A **renderer-agnostic** real-time spatial trajectory engine: a node graph
compiled into continuous `f(t)` functions orchestrates the movement **and**
the spatial effects (gain, spread, zones, kinematic modulations) of
OSC-controlled audio sources — Holophonix, SPAT Revolution, IEM, ADM-OSC or
any generic OSC receiver.
**100% Rust + Tauri + React.** Real-time performance, 60 FPS.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Node Editor  (React Flow)              │
│  Objects → Motion Node → Duration → Output        │
│  + Global FX tab (post-merge chain)               │
│  + Modulation tab (signal graph → node params)    │
└───────────────────┬──────────────────────────────┘
                    │ Tauri IPC
          ┌─────────▼──────────┐
          │ Graph + Signal     │   ← Rust: nodes → composite function
          │ Compilers          │
          └────┬──────────┬────┘
               │          │
    ┌──────────▼───┐  ┌───▼──────────┐
    │ Math Engine  │  │Physics Engine│
    │ circular     │  │ bouncing     │
    │ elliptical   │  │ swarm (boids)│
    │ lissajous    │  │ spring       │
    │ spiral       │  │ follow       │ ← pursue/evade/orbit/arrive
    │ perlin_noise │  │ avoidance    │
    │ pendulum     │  │ vectorfield  │ ← procedural + drawn fields
    │ formation    │  └─────────────┘
    │ converge     │
    │ figure8      │  Splines: DrawSpline / EvaluateSpline /
    │ rose_curve   │             TrimSpline / OffsetSpline
    │ helix · wave │  Plugins: .ssx WASM engines (wasmtime)
    │ linear       │
    │ oscillation  │  Audio IN (cpal + FFT): BPM /
    │ custom_traj  │    AudioAmplitude / AudioSpectrum
    └──────────────┘  Falloffs: Time / PointDistance /
                      Directional / AudioAmplitude
                    │
         ┌──────────▼──────────┐
         │  MergeRuntime 60 FPS │   ← parallel workers → merge → OSC
         │  Post-process graph  │   ← Scale/Rotate/Shift/Zone/Velocity…
         │  OSC Out (rosc)      │   → 6 profiles (Holophonix, IEM, IRCAM,
         │                      │      ADM, Generic XYZ/AED) + extended
         │                      │      channels (gain, spread, distance…)
         │  OSC IN              │   ← /stagespace/* show control +
         │                      │      user mappings (learn)
         └──────────┬───────────┘
                    │ positions-update event
         ┌──────────▼──────────┐
         │ 3D Preview (Three.js)│  ← real-time + zone viz
         └─────────────────────┘
```

---

## Available engines

### Math Engine
| Engine | Description |
|--------|-------------|
| `circular` | Uniform circular orbit |
| `spiral` | Rising/falling helix |
| `lissajous` | 3D Lissajous curves |
| `figure8` | Bernoulli lemniscate |
| `linear` | Linear A→B pan |
| `oscillation` | Sinusoidal oscillation |
| `perlin_noise` | Organic movement |
| `formation` | Geometric formation |
| `converge` | Convergence/divergence |
| `pendulum` | Pendulum simulation |

### Physics Engine
| Engine | Description |
|--------|-------------|
| `bouncing` | Bounces inside a container |
| `avoidance` | Mutual repulsion |
| `spring` | Attraction toward a target |
| `follow` | Single file — `pursue`/`evade`/`orbit`/`arrive` modes |
| `swarm` | Boids flock |
| `vectorfield` | Advection by velocity field (vortex/sink/flow/noise/**drawn**) |

### Splines & drawn trajectories
| Node | Description |
|------|-------------|
| `DrawSpline` | Freehand drawing → spline |
| `EvaluateSpline` | Spline sampling |
| `TrimSpline` / `OffsetSpline` | Spline editing |

### Modifiers & post-process (global graph)
| Node | Description |
|------|-------------|
| `Scale` / `Rotate` / `Offset` | Spatial transforms |
| `RadiusScale` / `HeightOffset` / `PerTrackDepth` | Spatial macros |
| `Barycenter` / `ManualPosition` | Origin / manual override |
| `AudioFalloff` | Audio modulation of params |
| `Zone` | Region of space → spatial channels (sphere/box, falloff) |
| `Velocity` | Kinematic modulation (speed/accel/jerk/**angvel**) → channels |
| `MoveRef` / `Merge` | Sub-graph reference / merge strategies |

### Audio Sources
| Engine | Description |
|--------|-------------|
| `BPM` | Sync to audio BPM |
| `AudioAmplitude` | Modulation by audio amplitude |

### Falloffs
| Engine | Description |
|--------|-------------|
| `TimeFalloff` | Temporal influence with easing |
| `PointDistanceFalloff` | Spatial influence by distance |

---

## Installation

```bash
# Rust engines
cd rust-engines
cargo build --release

# Frontend deps (required — beforeBuildCommand builds the frontend)
cd ../tauri-app/frontend
npm install

# Tauri app (Tauri CLI)
cd ..
npm install
```

---

## Getting started

```bash
cd tauri-app
npm run tauri dev     # or: npx tauri dev
```

The application opens in a native window.

### CLI (UI-free workflow testing)

```bash
cd tauri-app/src-tauri
cargo build --bin stagespace-cli
./target/debug/stagespace-cli "templates"
./target/debug/stagespace-cli "activate-move circle --tracks 1-5; sample --move circle-1 --obj 0; stop-all"
bash tests/e2e_cli_test.sh    # full E2E suite
```

---

## Features

- **Node Editor**: React Flow graph editor with editable custom nodes,
  two tabs (per-move sub-graph + post-merge **global graph**)
- **Compilation**: validation and compilation into composite functions
- **Playback**: real-time 60 FPS playback, parallel workers + MergeRuntime
- **Merge strategies**: override / crossfade / blend / priority
- **3D Preview**: Three.js visualization connected to the runtime,
  **3D zone visualization** for effects
- **Spatial channels**: gain, spread, distance, presence, yaw, aperture, lfe
  per object and per OSC profile
- **Kinematic modulations**: speed/accel/jerk/**angvel** (angular velocity
  around a configurable listener) → spatial channels
- **Zones**: sphere/box + smoothstep falloff → drive the channels of objects
  inside; declarable in the FX panel or as a `Zone` node in the global graph
- **OSC IN mappings**: any OSC address → macro / channel / position
  (wildcards, scale/offset/clamp/smooth transforms, anti-loop)
- **Audio IN**: native microphone capture (cpal) with BPM and amplitude
- **Cue System**: full snapshots (graphs, active moves, runtime effects)
  with atomic recall
- **Save/Load**: localStorage persistence of graphs

---

## OSC profiles

| Profile | Position address | Args |
|--------|------------------|------|
| **Holophonix** | `/track/{id}/xyz` | x, y, z (single message) |
| **IEM MultiEncoder** | `/MultiEncoder/{id}/aed` | azimuth°, elevation°, distance (single message) |
| **IRCAM Spat** | `/source/{id}/xyz` | x, y, z (single message) |
| **ADM-OSC** | `/adm/source/{id}/aed` | azimuth°, elevation°, distance |
| **Generic Cartesian** | `/object/{id}/xyz` | x, y, z (single message) |
| **Generic Polar** | `/object/{id}` | azimuth°, elevation°, distance |

Extended channels (gain, spread, distance, presence, yaw, aperture, lfe) are
sent as separate messages per the profile's capability matrix
(e.g. IRCAM `/source/{id}/spread`, Holophonix `/track/{id}/gain`).

---

## Tech stack

- **Shell**: Tauri (Rust)
- **UI**: React 18 + TypeScript
- **Node editor**: React Flow
- **3D Preview**: Three.js
- **State**: Zustand
- **Styles**: TailwindCSS
- **OSC**: `rosc` (Rust)
- **Audio IN**: `cpal` + `realfft` (native capture + FFT, Rust)
- **Engines**: pure Rust (real-time performance)

---

## Documentation

- **[docs/README.md](docs/README.md) — full documentation index by profile, with per-doc status**
- [AGENTS.md](AGENTS.md) — conventions, build commands, CI
- [docs/user-manual.md](docs/user-manual.md) — operator manual (views, OSC show-control, OSC-IN + learn, live safety, troubleshooting)
- [docs/console-integration.md](docs/console-integration.md) — driving STAGESPACE from a console/QLab/Companion
- [docs/use-cases.md](docs/use-cases.md) — field use cases and open limits
- [MANUAL_TESTING.md](MANUAL_TESTING.md) - Manual testing checklist
- [LOGGING.md](rust-engines/LOGGING.md) - Logging system guide
- [ERROR_HANDLING.md](rust-engines/ERROR_HANDLING.md) - Error handling guide
- [CONFIG.md](rust-engines/CONFIG.md) - Configuration guide
- [TESTING.md](rust-engines/TESTING.md) - Testing guide
- [BENCHMARKS.md](rust-engines/BENCHMARKS.md) - Benchmarks guide
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guide
- [ROADMAP_GRAPH_GLOBAL.md](docs/ROADMAP_GRAPH_GLOBAL.md) - Global graph architecture roadmap
- [ARCHITECTURE_FUTURE.md](docs/ARCHITECTURE_FUTURE.md) - Design document (implemented — kept as rationale)

## Tests

```bash
cd rust-engines
cargo test --lib
```

519 tests pass on the engine side (full suites: see the "Test
Counts" table in [AGENTS.md](AGENTS.md)).

---

## License

MIT
