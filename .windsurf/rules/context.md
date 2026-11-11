# STAGESPACE project context

## Summary

**STAGESPACE** is a real-time spatial trajectory engine, driven by a node graph,
compiled into continuous functions `f(t)` — for OSC control of spatialized audio
sources (Holophonix, SPAT Revolution, IEM, any OSC receiver).

---

## Inspiration corpus — earlier projects

### `holophonix-animator` (`C:\Users\Administrateur\Documents\GitHub\holophonix-animator`)
- **Stack**: Electron + React + TypeScript + Three.js + Zustand
- **Retained contributions**:
  - Multi-track mode Barycentric (iso/centered/custom/shared)
  - Phase offset between tracks of a group
  - Automatic formations (line, arc, circle, grid)
  - Fade-in/out as a subanimation (→ replaced by TimeFalloff)
  - Cue system (→ simplified in V1: graph snapshot + per-track interpolation)
  - Bidirectional OSC, batching, XYZ and AED systems
  - Unthrottled engine (60 FPS)
- **Mistakes not to repeat**:
  - Document/architect before implementing (39 docs, empty .ts files)
  - Premature overcomplexity (DAW timeline, 8×8 cues in V1)
  - Cascading restructurings without a working deliverable
  - **Electron shell too heavy** → replaced by Tauri

### `nodes-trajectories` / OSCAI (`C:\Users\Administrateur\Documents\GitHub\nodes-trajectories`)
- **Stack**: Python FastAPI + React Flow + Three.js + NumPy
- **Retained contributions**:
  - Clean graph compiler architecture with a 7-step validation pipeline
  - Cycle detection (DFS GRAY/BLACK), static counting compatibility
  - Mix / Group / Sequence nodes
  - Math engines (circular, spiral, lissajous, figure8, linear, oscillation, perlin_noise, formation, converge, pendulum)
  - Physics engines (bouncing, spring, follow, swarm/Boids, avoidance)
  - Real-time macro controls: TSpeed, Scale, Shift
  - 5 OSC profiles: IEM, Holophonix, IRCAM Spat, Generic
- **Mistake not to repeat**:
  - Generating static frame arrays instead of continuous f(t) functions
  - No real real-time runtime
  - **Hybrid Python backend** → replaced by pure Rust

### `trajectoires-modern` (https://github.com/dewiweb/trajectoires-modern)
- **Stack**: Node.js + React + WebSocket
- **Retained contributions**:
  - Freehand drawing → trajectory (→ DrawSpline node in STAGESPACE)
  - Immediate OSC streaming
  - Minimalist deployment as a simplicity reference
- **Limitation**: 8 fixed sources, not extensible

### `holophonix-blender-addon` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\holophonix_blender_addon`)
- **Stack**: Python + Blender
- **Retained contributions**:
  - Native Holophonix project import (.zip → manifest.json → .hol)
  - Real Amadeus 3D models (speakers/tracks)
  - XYZ ↔ AED conversion
  - Per-track OSC handlers (input/output/bidirectional)
  - Automatic holophonix.local resolution
- **Limitation**: total coupling to Blender, unusable standalone

### `Holophonix-chataigne-module` (https://github.com/dewiweb/Holophonix-chataigne-module)
- **Stack**: JSON/Chataigne
- **Retained contributions**:
  - Per-curve interpolation per individual track during cue transitions
  - OSC anti-loop (OSC-in disabled during recall)
  - Exclusive XYZ vs AED choice (not both simultaneously)
  - Flexible Track ID management (number, range, list)
- **Limitation**: locked inside the Chataigne ecosystem

### `animation_nodes` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\animation_nodes`)
- **Stack**: Python + Cython + Blender
- **Retained contributions**:
  - **Graph compilation to native code** (no node-by-node interpretation every frame) → founding principle of the STAGESPACE runtime
  - **Falloffs**: spatial/temporal/audio influence envelopes applicable to any parameter
  - Splines as trajectories (SplineFromPoints, EvaluateSpline, uniform advancement)
  - Loop nodes: parametric iterators in the graph
  - Script node: custom inline Python with live reload
  - SoundFalloff / SoundSpectrum: audio → animation parameter
  - DistributeMatrices: object distribution on path/surface
  - Execution modes: DEFAULT / MONITOR / MEASURE / BAKE
- **Limitation**: total coupling to Blender

### `NodeOSC` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\NodeOSC`)
- **Stack**: Python + Blender
- **Retained contributions**:
  - OSC → any parameter mapping (model for OSC IN in STAGESPACE)
  - Address + argument filtering
  - Multiple protocols (oscpy + python-osc)

---

## Founding principles of STAGESPACE

### 1. f(t) instead of frames[]
Each engine exposes a pure function:
```rust
fn position(t: f64, object_index: usize, params: &EngineParams) -> Vec3
```
No precomputed array. The runtime calls it every tick. Parameters
modifiable in real time without trajectory recompilation.

### 2. The graph compiles once, runs continuously
On every graph modification (connection/disconnection/parameter change):
recompilation into a composite function. Between compilations: the
runtime runs without touching the graph.

### 3. Falloffs as universal expression layer
A Falloff is a function `influence(t, position, context) → [0,1]` that
modulates any parameter of any engine. Replaces static subanimations
with a generic system.

### 4. DrawSpline as a first-class node
Freehand drawing becomes a `DrawSpline` node whose output (spline)
connects to `EvaluateSpline` — compatible with the rest of the graph.
Not a separate mode.

### 5. .hol import as source of truth
The app reads Holophonix project files (.hol) to discover tracks:
IDs, names, initial positions, colors. Displayed directly in the 3D
preview.

### 6. Audio IN only
- Audio input: BPM detection, per-band amplitude, FFT spectrum
- No audio output, no audio processing
- Usable as a graph source (→ driving Falloffs or params)

### 7. OSC only (no MIDI)
- OSC out: sending computed positions
- OSC in: receiving cue triggers, parameter overrides, macro controls

---

## V1 node catalog

### Structural
`Objects` · `Duration` · `Output` · `Group` · `Mix` · `Sequence`

### Math engines
`circular` · `elliptical` · `spiral` · `lissajous` · `figure8` · `linear` · `oscillation` · `perlin_noise` · `formation` · `converge` · `pendulum` · `rose_curve` · `helix`

### Physics engines
`bouncing` · `spring` · `follow` · `swarm` · `avoidance`

### Splines
`DrawSpline` · `EvaluateSpline` · `TrimSpline` · `OffsetSpline`

### Falloffs
`TimeFalloff` · `PointDistanceFalloff` · `DirectionalFalloff` · `AudioAmplitudeFalloff`

### Modifiers
`Scale` · `Rotate` · `Offset` · `PhaseShift` · `BarycentricGroup`

### Sources
`BPM` · `AudioAmplitude` · `AudioSpectrum` · `OSCInput`

---

## Technical stack

| Layer | Choice |
|--------|-------|
| Shell | Tauri (Rust) |
| UI | React 18 + TypeScript |
| Node editor | React Flow |
| 3D Preview | Three.js |
| State | Zustand |
| Styles | TailwindCSS |
| OSC | `rosc` (Rust) |
| Audio IN | Web Audio API (via Tauri IPC) |
| Engines | Pure Rust (real-time performance) |
| Communication | Tauri IPC (native) |

---

## V1 scope — explicit out-of-scope

- ❌ MIDI (permanently dropped)
- ❌ LLM / AI generation (permanently dropped)
- ❌ DAW timeline → V2
- ❌ 8×8 cue grid → V2 (linear cue list in V1)
- ❌ Multi-platform packaging → V2
- ❌ Blender integration (the addon stays separate, reads the OSC out)
- ❌ Python backend (replaced by pure Rust)
- ❌ Electron (replaced by Tauri)

---

## Build order — absolute rule: engine first, UI second

```
S1  → Pure Rust f(t) engines + unit tests
S2  → Rust runtime (clock + OSC out via rosc)
S3  → Rust graph compiler (nodes → composite function)
S4  → Tauri setup (IPC Rust ↔ React)
S5  → Minimal React Flow node editor UI
S6  → Three.js 3D Preview + .hol import
S7  → Falloffs (Time + PointDistance)
S8  → Audio IN (BPM + Amplitude via IPC)
S9  → OSC IN + minimal Cue system + polish
```

**Nothing is documented until it runs.**
