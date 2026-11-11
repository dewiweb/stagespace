# Future Architecture: Hybrid Global Graph

> **Status: implemented.** The hybrid architecture described here shipped
> (MergeRuntime, parallel workers, global post-process graph, MoveRef) —
> see `ROADMAP_GRAPH_GLOBAL.md` phases 1–4. Kept as design rationale.

## Context

Stagespace compiles node graphs into continuous functions `f(t, i) → Vec3` for real-time spatial control. The current system has a fundamental tension: macros and audio mods are layers **external** to the graph, hardcoded in the runtime, while the `Scale`, `Rotate`, `Offset`, `AudioAmplitudeFalloff` nodes already exist in the compiler.

This document describes the evolution toward a **global graph** encompassing all moves, with macros and audio mods as graph nodes. Inspired by Max/PureData but with engine compilation for performance.

The chosen architecture is **hybrid multi-threaded**: engines (complex math) run in parallel worker threads, merge + post-processing run in a single thread. Compilation for engines, interpretation for post-processing, atomic fast path for live control.

**Design goals**: flexibility (per-move or global, your choice) and intuitiveness (the musician doesn't manipulate nodes in concert — they have sliders).

---

## Current state — identified tensions

### Tension 1: Two parallel transformation systems

```
GRAPH LAYER (compiled)          RUNTIME LAYER (hardcoded)
─────────────────────           ──────────────────────────
Circular → Scale → Rotate       radius_scale → height_offset
  → Output → PositionFn         → depth → scale → rotation
                                → origin + shift → OSC
```

The graph compiles `f(t, i) → Vec3`. The runtime **then** applies 6 hardcoded transformations (runtime.rs lines 341-399): `radius_scale → height_offset → depth → scale → rotation → origin + shift`. Not visible in the graph, not composable, not reorderable.

If you put a `Scale(2.0)` node in the graph AND a macro scale at 1.5 → position scaled twice. Confusing.

### Tension 2: Movement isolation → unresolved conflicts

```
Movement A (tracks 1-5) → OSC socket A → /track/3/xyz
Movement B (tracks 3-9) → OSC socket B → /track/3/xyz
                                                    ↑
                                        Last one speaking wins.
                                        No blend, no priority.
```

Each movement is an independent `Runtime` with its own thread + socket. Two moves on the same track → contradictory positions at 60fps → jitter.

### Tension 3: Global macros applied per-movement

```typescript
// macrosSlice.ts — pushMacrosToRuntime
await Promise.all(movements.map((mv) =>
  invoke('set_movement_macro', { movementId: mv.id, request: macroReq })
));
```

Same macros pushed to all movements. Neither truly global (applied N times) nor truly per-move (same value). Implementation accident.

### Tension 4: Audio mods = external layer while the nodes exist

The compiler has `AudioAmplitudeFalloff`, `AudioSpectrum`, `BPM`. But the Inspector's "audio mods" are a separate system (`AnimationState.audio_mods`) computing deltas outside the graph. Two systems for the same thing.

### Tension 5: Objects node = vestige

The `Objects` node exists to provide `n_objects` to the compiler. But the real count is `osc_ids.len()`. The compiler resolves `n_objects` from the Objects node, then the runtime ignores it and uses `osc_ids.len()`.

### Tension 6: Origin computed outside the graph

```typescript
const origin = computeCentroid(holProject, trackIndices, manualOscIds);
// → passed as a parameter to the runtime
```

The centroid is computed in TypeScript. A spatial concept that should be a node.

### Tension 7: Per-track parameters not represented in the graph

`AnimationState` has `track_depths: Vec<f64>` and `track_phase_offsets: Vec<f64>` — **per-track arrays**, not global values. Depth and phase_offset differ per object. These parameters are applied in the runtime (lines 247-257), not in the graph. A global-graph node must be able to return values **indexed by object_index**.

### Tension 8: Speed is per-move, not global

Speed is in `MacroState` and affects `t` (time scaling). Each runtime applies its own speed. If macros become global, speed becomes global — all moves at the same speed. That's a regression: two moves may want different speeds. **Speed must remain per-move.**

### Tension 9: Incomplete cue system

A cue snapshot contains: `graph + macros + track_indices + fade_duration`. But **audio mods aren't in cues**. With a global graph, a cue must also snapshot which moves are active and the global graph state.

### Tension 10: ManualPositions not represented

Dragging individual objects in the 3D view modifies `manualPositions` (per-object manual positions). That doesn't map to a Transform node — it's a **position override**. We need a `ManualPosition` node that overrides the computed position for certain objects.

---

## Proposed architecture — Hybrid Sweet Spot

```
ALL COMPILED                    ALL INTERPRETED
(f(t,i) monolithic)             (Max/PureData)
     │                               │
     │  ┌──────────────────────────┐ │
     │  │ HYBRID SWEET SPOT        │ │
     │  │ Compiled engines         │ │
     │  │ Interpreted post-process │ │
     │  │ Fast path for live       │ │
     │  │ Parallel worker threads  │ │
     │  │ Single merge thread      │ │
     │  └──────────────────────────┘ │
     │                               │
     ←── Current Stagespace          ←── Proposed Stagespace
```

### Principle: 3 layers, 2 threading levels

**Layer 1 — Engine (compiled, parallel worker threads)**
```
Move sub-graph → compile → f(t, i) → Vec3
Evaluated in parallel in worker threads (1 per active move)
Result written to a shared buffer
Does NOT send OSC
Applies speed (per-move), loop_mode, direction, phase_offset (per-move)
Does NOT apply scale/rotation/shift/depth (those transforms move up to the global graph)
```

**Layer 2 — Merge + Post-processing (compiled closure, single merge thread)**
```
Read all buffers (latest frame)
  → Merge (resolve per-track conflicts)
  → Post-processing (compiled closure, atomic params):
    Scale → Rotate → Shift → AudioMod → Depth → ManualPosition
  → Single OSC socket
  → Single callback for the visualizer
```

**Layer 3 — Output (OSC routing, merge thread)**
```
Output → OSC format (Holophonix/IEM/Spat) → UDP (single socket)
```

### Multi-threaded architecture

```
┌─────────────────────────────────────────────────────────────┐
│ WORKER THREADS (one per active move)                        │
│                                                              │
│  Thread A: f_a(t,i) ──→ [buffer A]                          │
│  Thread B: f_b(t,i) ──→ [buffer B]                          │
│  Thread C: f_c(t,i) ──→ [buffer C]                          │
│                                                              │
│  Each thread:                                                │
│  - Evaluates its compiled sub-graph (engine math)            │
│  - Applies speed (per-move), loop_mode, direction            │
│  - Applies phase_offset (per-track, in the sub-graph)        │
│  - Writes positions to its buffer                            │
│  - Does NOT send OSC                                         │
│  - Does NOT apply scale/rotation/shift/depth (global graph)  │
│  - Has access to AudioState (for audio engines)              │
└────────────────────────┬────────────────────────────────────┘
                         │  (Mutex<Vec>, simple lock, ~200 bytes)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ MERGE + POST-PROCESS THREAD (single)                        │
│                                                              │
│  1. Read all buffers (latest frame)                          │
│  2. Merge: resolve conflicts per track                       │
│  3. Post-process (compiled closure, atomic params):          │
│     Scale → Rotate → Shift → AudioMod → Depth → ManualPos    │
│  4. OSC output (single socket)                               │
│  5. Callback (single Tauri event)                            │
│  - Has access to AudioState (for AudioFalloff nodes)         │
│  - Has access to track positions (for Barycenter node)       │
└─────────────────────────────────────────────────────────────┘
```

### Why hybrid rather than single-thread

| Aspect | Single-thread global | Hybrid multi-thread |
|---|---|---|
| Engine evaluation | Sequential (6.7ms for 3 moves) | **Parallel** (3ms max, the slowest) |
| Crash isolation | Everything stops | **Worker crash → merge skips its buffer, others continue** |
| Refactor | Massive (rewrite everything) | **Minimal** (keep existing Runtime, add merge) |
| OSC conflicts | Solved (1 socket) | Solved (1 socket) |
| Latency | 0 frames | **0-1 frame** (buffer, acceptable at 60fps) |
| Complexity | Medium | **Medium** (simple Mutex, not critical) |
| Scalability | Limited (1 core) | **Multi-core** (Rayon for per-object post-processing) |

### Compilation vs interpretation — the boundary

```
LAYERS           EXECUTION MODE         THREADS
─────────        ───────────────        ───────
Sub-graphs       Compiled (f(t,i))      Worker threads (1 per move)
  ↓              + speed, loop, dir, phase (per-move, in the worker)
Merge            Interpreted            Merge thread
  ↓                (dynamic structure:
Post-processing    N variable moves)
                  Compiled for          Merge thread
                  transforms (closures   (optional: Rayon
                  with atomic params)    per object)
  ↓
OSC output       Direct                 Merge thread
```

**Sub-graphs**: compiled into `f(t, i) → Vec3`. Structure frozen during playback. Hot-swappable with crossfade. Evaluated in parallel in worker threads. **Speed, loop_mode, direction, phase_offset stay per-move in the worker** — they're time and phase transformations, not space.

**Merge**: interpreted. The number of active moves changes in real time (play/stop). The merge can't be compiled because its inputs are dynamic. But it's trivial: for each track, take the position of the move with the highest weight.

**Post-processing**: **hybrid compilation/interpretation**.
- The **structure** (which nodes, which order) is compiled into a closure → no interpretation overhead
- The **parameters** (scale value, rotation angle, audio amount) are `Arc<AtomicU64>` → modifiable without recompilation
- The **audio data** is read live via `Arc<Mutex<AudioState>>` → no recompilation when audio changes
- Hot-swap of the closure when the global graph changes (rare, ~1ms)

### Conceptual Global Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│ GLOBAL GRAPH                                                        │
│                                                                      │
│  [MoveRef A] ──→ f_a(t,i) ──┐                                       │
│                              ├── [Merge] ── [Scale] ── [Rotate]     │
│  [MoveRef B] ──→ f_b(t,i) ──┘         │              │              │
│                                       │              ↓              │
│                                  [AudioFalloff]  [Shift]            │
│                                       │              │              │
│                                       ↓              ↓              │
│                                  [PerTrackDepth] [ManualPos]        │
│                                       │              │              │
│                                       ↓              ↓              │
│                                    [Barycenter] ──→ [Output] ──→ OSC│
│                                                                      │
│  Sub-graph A: [Circular] → [PhaseShift(per-track)] → [Output]       │
│  Sub-graph B: [Spiral] → [Jitter] → [Output]                        │
│                                                                      │
│  Global inputs: AudioState, TrackPositions (.hol), ManualPositions  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Sub-graphs** (moves): compiled to `f(t, i) → Vec3`, evaluated in worker threads. Speed, loop, direction, phase_offset per-move.
- **Global graph** (post-processing): compiled closure, atomic params, evaluated in the merge thread.
- **MoveRef nodes**: references to sub-graphs (abstractions).
- **PerTrack nodes**: return values indexed by object_index (depth, phase_offset).
- **ManualPosition node**: overrides the position for certain objects (manual drag).

---

## Speed vs transforms separation — the critical point

### What stays per-move (in the workers)

| Parameter | Why | Where |
|---|---|---|
| `speed` | Affects `t` (time scaling). Two moves at different speeds. | Worker |
| `loop_mode` | Loop vs OneShot. Per-move. | Worker |
| `direction` | Forward/Backward/PingPong. Per-move. | Worker |
| `phase_offset` | Per-track, temporal offset. Already in the sub-graph. | Worker (sub-graph) |
| `fade_in/out` | Per-move, move lifecycle. | Worker |

### What moves up to the global graph (merge thread)

| Parameter | Why | Where |
|---|---|---|
| `scale` | Global spatial transformation. | Global graph (Transform node) |
| `rotation` (yaw/pitch/roll) | Global spatial transformation. | Global graph (Transform node) |
| `shift` (x/y/z) | Global spatial transformation. | Global graph (Transform node) |
| `radius_scale` | Global spatial transformation. | Global graph (Transform node) |
| `height_offset` | Global spatial transformation. | Global graph (Transform node) |
| `depth` | Per-track, but spatial. | Global graph (PerTrack node) |
| `audio mods` | Global modulation. | Global graph (AudioFalloff node) |
| `origin` | Global spatial computation. | Global graph (Barycenter node) |

### Flexibility: per-move OR global

The user chooses the application level:
- **Transform in the sub-graph**: applies per-move (the worker applies it before writing to the buffer)
- **Transform in the global graph**: applies globally (the merge thread applies it after the merge)

Example: a `Scale` node in Move A's sub-graph scales only A. A `Scale` node in the global graph scales all merged moves. **Same nodes, two application levels.**

---

## Per-track parameters — modeling

### The problem

`depth` and `phase_offset` are per-track arrays:
```
Object 0 → depth 0.3
Object 1 → depth 1.0
Object 2 → depth 0.7
```

A standard Transform node returns a global value. We need a node that **indexes by object_index**.

### Solution: PerTrackParameter node

```rust
NodeType::PerTrackDepth => {
    // Takes an array of per-track values
    // Returns values[object_index]
    let depths = node.params.get("depths").as_array();
    Box::new(move |t, i, merged, macros, audio| {
        let depth = depths.get(i).unwrap_or(1.0);
        origin + (merged[i] - origin) * depth * fade
    })
}
```

**Phase_offset** stays in the sub-graph (per-move, temporal). **Depth** moves up to the global graph (spatial, post-merge).

### UI: per-track depth

In the Perform Panel, one slider per track for depth. Not a node you connect — a **projected view** of the PerTrackDepth node.

---

## ManualPositions — position override

### The problem

Dragging individual objects in the 3D view modifies `manualPositions`. It's an override: the manual position replaces the computed position, for certain objects only.

### Solution: ManualPosition node

```rust
NodeType::ManualPosition => {
    // For each object, if manual_position[i] exists, use it
    // Otherwise, keep the computed position
    let manual = manual_positions_ref.lock();  // Arc<Mutex<HashMap<usize, Vec3>>>
    Box::new(move |t, i, merged, macros, audio| {
        if let Some(manual_pos) = manual.get(&i) {
            *manual_pos  // override
        } else {
            merged[i]  // computed position
        }
    })
}
```

Placed **after** the merge, **before** the output. The user can bypass it by disconnecting it.

### Interaction with the 3D view

When the user drags an object in the 3D view:
1. The position is written to `manual_positions_ref` (atomic, fast path)
2. The ManualPosition node reads it at the next frame
3. The object jumps to the manual position
4. To "release" the object: remove the HashMap entry → the object returns to the computed position

---

## AudioState — shared between workers and merge thread

### The problem

The audio engines (BPM, AudioAmplitude, AudioSpectrum) use closures capturing `Arc<Mutex<AudioState>>`. Workers need AudioState for these engines. The merge thread needs AudioState for the global graph's AudioFalloff nodes.

### Solution: one shared AudioState

```rust
// AppState
audio_state: Arc<Mutex<AudioState>>,  // one, shared

// Each worker receives a clone of the Arc
worker_runtime.set_audio_state(audio_state.clone());

// The merge thread also receives a clone
merge_runtime.set_audio_state(audio_state.clone());
```

Already the case today (each runtime has a clone of the Arc). **No change needed.**

---

## Cue system — adaptation

### Extended cue snapshot

```rust
pub struct Cue {
    // Current
    pub graph: GraphJson,           // move sub-graph
    pub macros: MacroSnapshot,      // macros (scale, rotation, shift)
    pub track_indices: Vec<usize>,
    pub fade_duration: f64,
    pub cue_number: String,
    
    // New (Phase 2+)
    pub global_graph: Option<GraphJson>,     // global graph (Transform nodes)
    pub active_move_ids: Vec<String>,        // which moves are active
    pub audio_mods: Option<AudioModSnapshot>, // audio mods (now nodes)
    pub per_track_depths: Vec<f64>,          // per-track depth
    pub manual_positions: HashMap<usize, [f64; 3]>, // manual overrides
}
```

### Recall

1. Deactivate moves not in `active_move_ids`
2. Activate moves that are (with fade)
3. Hot-swap the global graph if `global_graph` is present
4. Restore macros (atomic fast path)
5. Restore per-track depths
6. Restore manual positions

---

## Backend Implications

### Compiler

**Current**:
```rust
compile_graph(graph, audio) → PositionFn  // fn(t, i) → Vec3
```

**Proposed**:
```rust
// Phase 1: compile each sub-graph independently (unchanged)
compile_sub_graph(move_graph_a, audio) → PositionFn  // f_a
compile_sub_graph(move_graph_b, audio) → PositionFn  // f_b

// Phase 2: compile the global graph (post-processing)
compile_post_process(global_graph, audio, track_positions) → PostProcessFn
// PostProcessFn: fn(t, merged_positions, &macros, &audio, &track_positions) → transformed_positions
```

### Merge Node (new)

Merge strategies:
- `Override`: last active move wins
- `Crossfade`: blend with fade duration
- `Blend`: weighted average
- `Priority`: highest-priority move wins
- `Spatial`: position closest to origin wins

The compiler already has Mix (blend), Group (split), Sequence (temporal), Crossfade (fade). The Merge node generalizes: instead of mixing 2 branches of the same graph, it merges N independent sub-graphs.

### Runtime — Hybrid architecture

**Current**: N independent `Runtime`s with separate threads + sockets.

**Proposed**: N `Runtime` workers (no OSC, no spatial post-processing) + 1 `MergeRuntime`.

```rust
// Existing workers — minimally modified
// The existing Runtime keeps evaluating f(t,i) with speed, loop, direction, phase_offset
// But instead of sending OSC + spatial post-process:
// → writes to a buffer
struct PositionBuffer {
    positions: Mutex<Vec<(usize, Vector3<f64>)>>,
}

// New: MergeRuntime
struct MergeRuntime {
    thread: Option<JoinHandle<()>>,
    running: Arc<AtomicBool>,
    socket: UdpSocket,
    osc_sender: Arc<Mutex<OscSender>>,
    // Per-move buffers (simple lock, ~200 bytes per buffer)
    move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
    // Active moves with fade state
    active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
    // Post-processing (compiled closure, atomic params)
    post_process_fn: Arc<Mutex<PostProcessFn>>,
    // Macros = fast path (atomic, no recompilation)
    // Only scale, rotation, shift, radius_scale, height_offset
    // NOT speed (speed stays per-move in workers)
    macros: Arc<MacroState>,
    // Shared audio state (workers + merge thread)
    audio_state: Arc<Mutex<AudioState>>,
    // Track positions from .hol (for Barycenter node)
    track_positions: Arc<RwLock<HashMap<u32, [f64; 3]>>>,
    // Manual positions (for ManualPosition node)
    manual_positions: Arc<Mutex<HashMap<usize, [f64; 3]>>>,
    // Global origin
    origin: Arc<Mutex<Vector3<f64>>>,
    // OSC ids (selected tracks)
    osc_ids: Arc<RwLock<Vec<u32>>>,
    // Merge strategy
    merge_strategy: Arc<RwLock<MergeStrategy>>,
    // Global performance monitor
    perf: Arc<PerfMonitor>,
    // Position callback (single Tauri event)
    position_callback: Arc<Mutex<Option<Box<dyn Fn(f64, &[(usize, Vector3<f64>)]) + Send + Sync>>>>,
}

struct MoveState {
    osc_ids: Vec<u32>,
    track_indices: Vec<usize>,
    fade_in_remaining: f64,
    fade_out_remaining: f64,
    fade_in_duration: f64,
    fade_out_duration: f64,
    weight: f64,
    is_active: bool,
    is_preview: bool,
}
```

**MergeRuntime loop**:
```rust
loop {
    // 1. Read all buffers (latest frame)
    let all_positions: HashMap<String, Vec<(usize, Vec3)>> = 
        move_buffers.iter().map(|(id, buf)| (id.clone(), buf.read())).collect();
    
    // 2. Merge by track (resolve conflicts)
    let merged = merge_strategy.resolve(&all_positions, &active_moves);
    
    // 3. Post-process (compiled closure, atomic params)
    //    Scale → Rotate → Shift → AudioMod → PerTrackDepth → ManualPos → Barycenter
    let transformed = post_process_fn(t, merged, &macros, &audio_state, &track_positions);
    
    // 4. Separate display vs OSC (preview mode)
    let display_positions = transformed.clone();  // 3D sees everything
    let osc_positions: Vec<_> = transformed.iter()
        .filter(|(i, _)| !is_preview(i))
        .collect();  // OSC excludes previewing moves
    
    // 5. OSC output (single socket)
    for (i, pos) in &osc_positions {
        let osc_id = osc_ids[i];
        sender.send(osc_id, pos);
    }
    
    // 6. Callback (single Tauri event)
    emit("global-positions", display_positions);
    
    // 7. Perf monitor
    perf.record_frame();
    
    sleep(frame_duration);  // 60fps
}
```

**Advantages**:
- Workers in parallel → complex engines (Swarm O(n²)) don't block other moves
- Crash isolation → one worker crashes, the merge skips its buffer, others continue
- Single socket → no more OSC conflicts
- Spatial macros applied **once** on the merged output
- Speed stays per-move (in workers)
- Single position callback → simplified frontend
- Minimal refactor → existing `Runtime`s stay quasi-intact

### Buffer — simple lock, no double buffer

```rust
struct PositionBuffer {
    positions: Mutex<Vec<(usize, Vector3<f64>)>>,
}

impl PositionBuffer {
    fn write(&self, positions: Vec<(usize, Vector3<f64>)>) {
        *self.positions.lock().unwrap() = positions;
    }
    
    fn read(&self) -> Vec<(usize, Vector3<f64>)> {
        self.positions.lock().unwrap().clone()
    }
}
```

For 9 objects (~200 bytes), the copy takes nanoseconds. No measurable contention. The front/back double buffer + swap is overkill for this data volume. **Simple Mutex is enough.**

### Fast path for live control

The params of the global graph's Transform nodes are stored in `Arc<AtomicU64>` (like the current MacroState). The compiler binds these refs into the compiled closure. Changing a slider = atomic update, no recompilation.

```
Slider "Scale" → set_atomic(scale_ref, 1.5) → read by the closure each frame
```

**Speed** is **not** a global AtomicU64 — it stays per-move in the worker's `RuntimeConfig`.

### Optional parallel post-processing

Post-processing is **per-object independent**: Scale, Rotate, Shift applied to object 0 don't depend on object 1. So:

```rust
let transformed: Vec<(usize, Vector3<f64>)> = merged
    .par_iter()  // Rayon: automatic parallel
    .map(|(i, pos)| {
        let scaled = pos * scale_atomic.load();
        let rotated = rot_matrix * scaled;
        let shifted = rotated + shift_atomic.load();
        let with_audio = apply_audio_falloff(shifted, i, &audio_state);
        let with_depth = origin + (with_audio - origin) * depth[i];
        let with_manual = manual_positions.get(&i).unwrap_or(with_depth);
        (*i, with_manual)
    })
    .collect();
```

For 9 objects, Rayon can parallelize across available cores. But honestly, post-processing is so light (mult/add) that parallelization brings almost nothing. **The real parallelization gain is on the worker threads** (complex engines).

### IPC Commands

| Current | Proposed | Change |
|---|---|---|
| `play_movement` | `activate_move` | Starts worker + registers buffer |
| `stop_movement` | `deactivate_move` | Fade out, removes buffer when done |
| `stop_all_movements` | `deactivate_all_moves` | Fade out all |
| `set_macro` | `set_macro` (fast path) | Atomic, once (scale/rot/shift only) |
| `set_movement_macro` | `set_move_speed` | Speed stays per-move |
| `update_movement_graph` | `update_move_graph` | Hot-swap sub-graph (worker) |
| — | `update_global_graph` | Hot-swap post-processing (merge) |
| `set_audio_state` | `set_audio_state` | Unchanged (shared workers + merge) |
| — | `set_manual_position` | Override an object's position (3D drag) |
| — | `clear_manual_position` | Release an object from override |
| — | `set_track_positions` | Update .hol positions (for Barycenter) |

### Events

| Current | Proposed |
|---|---|
| `movement-positions-{id}` (N events) | `global-positions` (1 event) |
| `movements-update` | `active-moves-update` |

---

## Frontend Implications

### Node Editor

Two levels:
- **Global view**: global graph with MoveRef, Merge, Transform, AudioMod, PerTrackDepth, ManualPos, Barycenter, Output
- **Sub-graph view**: double-click a MoveRef → opens the move's sub-graph

React Flow: tabs (global view / per-move sub-graph view).

**Flexibility**: a `Scale` node can be placed in the sub-graph (per-move) OR in the global graph (post-merge). Same node, two application levels.

### Inspector

- **Node section**: selected node's params
- **Perform section**: duration, direction, loop, fade, **speed** (per-move, stays here)
- **Tracks section**: selection + per-track depth
- **No global Macros section**: spatial macros = Transform node params of the global graph
- **No Audio section**: audio mods = AudioFalloff nodes

### Perform Panel (new)

Slider view of the global graph node params. For live — no node manipulation in concert.

```
Node Editor (design time)          Perform Panel (live time)
┌──────────────────────┐          ┌─────────────────────┐
│ [Scale node]         │ ←same──→ │ Scale: ────●── 1.5  │
│ [Rotate node]        │ ←data──→ │ Yaw:    ──●──── 45° │
│ [AudioFalloff node]  │ ←same──→ │ Amount: ──●──── 0.7 │
│ [PerTrackDepth node] │ ←data──→ │ Depth:   ──●──── 0.8 │
└──────────────────────┘          └─────────────────────┘
```

**Intuitiveness**: the musician sees sliders, not nodes. But underneath, they're the params of the global graph nodes. Two views, same data.

### State Management

```
useGlobalGraphStore: globalNodes, globalEdges (global graph)
useMoveGraphStore: { [moveId]: { nodes, edges } } (sub-graphs)
useMacroStore: macroValues (projected view from the global graph's Transform nodes)
useSpeedStore: { [moveId]: speed } (per-move, stays separate)
useManualPositionsStore: { [objIdx]: [x, y, z] } (manual overrides)
// useAnimationStore → removed (audio mods = nodes, depth = PerTrack node)
```

### Visualizer

A single callback with already-merged and transformed positions. Simplified render loop — no more frontend-side merging.

**ManualPositions**: the drag in the 3D view writes to `useManualPositionsStore` → invoke `set_manual_position` → the ManualPosition node applies it. The object stays at its manual position until "released" (clear_manual_position).

### MovesTable

Simpler: just template + tracks + play/stop + **speed** (per-move). Spatial macros and audio mods move up to the global graph.

---

## What breaks / what's hard

### What breaks

1. **Movement independence**: partially resolved. A worker crash → merge skips it, others continue. But if the merge thread crashes → everything stops. Mitigation: watchdog + restart of the merge thread only.

2. **Per-movement spatial macros**: spatial macros (scale, rotation, shift) become global (applied by the merge thread). But: per-move transforms can be nodes in the sub-graph (compiled, evaluated by the worker). **Flexibility preserved.**

3. **Per-movement preview mode**: handled at the merge thread level. The worker writes to the buffer regardless. The merge thread separates display positions (everything) from OSC positions (excludes preview). The 3D sees the previewing move, OSC doesn't send it.

4. **Setlist workflow**: the setlist triggers MoveRef activations in sequence. A cue recall can activate/deactivate moves + swap the global graph.

5. **Buffer latency**: 0-1 frame of added latency (16ms max). Acceptable for spatial, but to document.

6. **Globalized OSC profile**: currently per-movement (host/port/profile). In global, a single receiver. In practice, we always send to the same receiver (Holophonix). If we want multiple receivers, we'd need a routing node in the global graph (Phase 3+).

### What's hard

1. **Real-time global graph compilation**: simple post-processing (mult/add), fast compilation (<1ms). Hot-swap with crossfade.

2. **Nested graphs UI**: React Flow doesn't natively support nesting. Tabs or sub-patches with double-click.

3. **Existing data migration**: current moveSlots have macros + audio mods. Migration script → create Transform nodes in the global graph with the slot's values. Speed stays in the slot.

4. **Fast path for live control**: Transform node params in `Arc<AtomicU64>`. Compiler binds the refs. Slider = atomic update.

5. **Worker management**: clean start/stop, crash handling, timeout if a worker is too slow.

6. **Per-track parameters in the graph**: PerTrackDepth node must index by object_index. The UI exposes one slider per track in the Perform Panel.

7. **ManualPositions sync**: the 3D drag writes to the store → invoke → atomic update → the node reads at the next frame. No recompilation. But: if the global graph has no ManualPosition node, the drag does nothing. Either always include a ManualPosition node (default), or auto-create it.

---

## Implementation phases

### Phase 1: Merge Node + MergeRuntime (short term)

**Goal**: resolve OSC conflicts, parallelize engines, lay foundations.

**Changes**:
- Existing workers modified: remove OSC + spatial post-processing, write to buffer
- New `MergeRuntime`: reads buffers, merges, applies spatial macros (still external), sends OSC
- Single socket, single position event
- Speed, loop, direction, phase_offset stay in workers
- Spatial macros stay external (for now)

**Unchanged**:
- UI (MovesTable, Inspector, Node Editor)
- Sub-graphs compiled independently
- Spatial macros = sliders (atomic fast path in MergeRuntime)

**Benefit**: no more OSC conflicts, parallel engines, crash isolation.

### Phase 2: Post-processing graph (medium term)

**Goal**: unify spatial macros + audio mods + depth + origin + manual positions in the graph.

**Changes**:
- Spatial macros → Transform nodes in a global graph
- Audio mods → AudioFalloff nodes in the global graph
- Depth → PerTrackDepth node in the global graph
- Origin → Barycenter node in the global graph
- ManualPositions → ManualPosition node in the global graph
- The MergeRuntime no longer has a hardcoded chain — everything is in PostProcessFn
- Speed stays per-move (in workers, not in the global graph)

**Unchanged**:
- Sub-graphs (moves) compiled independently by workers
- Fast path (AtomicU64) for live params
- Speed, loop, direction, phase_offset in workers

**Benefit**: configurable order, composable transformations, unified audio mods, per-track or global at choice.

### Phase 3: Unified graph (long term)

**Goal**: everything is graph, nested editor, MoveRef nodes.

**Changes**:
- MoveRef nodes in the global graph
- Nested graph editor (sub-patches)
- Perform Panel (slider view of nodes)
- Removal of the move graph / global graph distinction
- Extended cue system (global graph snapshot + active moves)

**Benefit**: unified system, everything is graph, like Max/PureData but compiled for engines.

---

## Reference: Hybrid Sweet Spot

```
ALL COMPILED ←─────────────────────────────→ ALL INTERPRETED
                                                        (Max/PD)
     │                                        │
     │    ┌───────────────────────────────┐   │
     │    │ HYBRID SWEET SPOT             │   │
     │    │ • Compiled engines (f(t,i))   │   │
     │    │ • Parallel workers            │   │
     │    │ • Speed/loop/dir per-move     │   │
     │    │ • Interpreted post-processing │   │
     │    │ • Fast path for live (atomic) │   │
     │    │ • Explicit merge (1 thread)   │   │
     │    │ • Crash isolation             │   │
     │    │ • Per-track or global, choice │   │
     │    └───────────────────────────────┘   │
     │                                        │
  Current Stagespace                     Proposed Stagespace
  (too compiled, external macros)        (hybrid sweet spot)
```
