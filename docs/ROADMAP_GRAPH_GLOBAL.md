# Action Plan: Hybrid Global Graph

Architectural reference: `ARCHITECTURE_FUTURE.md`

> ## ⚑ Global status — September 2025
>
> **Phases 1, 2, 3 and 4 (P1–P5): implemented.** This document remains the
> design reference; remaining work is listed in the "Reste" callouts
> and in section P6+.
>
> Not implemented (consciously deferred): `PositionBuffer::read_stale`
> (the buffer keeps the last frame by construction) and the worker-crash
> watchdog (§1.3) — the crash isolation strategy is documented in
> "Technical notes".

Chosen architecture: **hybrid multi-threaded** — engines compiled in parallel worker threads, merge + post-processing in a single thread, atomic fast path for live control.

**Guiding principles**: flexibility (per-move or global, your choice) and intuitiveness (sliders for live, nodes for design).

---

## Phase 1: Merge Node + MergeRuntime ✅ DONE

**Goal**: Parallel workers + single merge thread + a single OSC socket.
**Estimated duration**: 3-5 work sessions.
**Risk**: medium (minimal refactor of existing runtime, new MergeRuntime).

### Step 1.1: PositionBuffer struct (Rust) ✅

**Files**:
- `rust-engines/src/position_buffer.rs` (new)
- `rust-engines/src/lib.rs` (export)

**Tasks**:
- [x] Create `PositionBuffer` struct (simple lock, no double buffer):
  ```rust
  pub struct PositionBuffer {
      positions: Mutex<Vec<(usize, Vector3<f64>)>>,
  }
  ```
- [x] `write(positions)`: worker writes under the lock
- [x] `read() -> Vec<(usize, Vector3<f64>)>`: merge reads under the lock (clone ~200 bytes)
- [ ] `read_stale() -> Vec<(usize, Vector3<f64>)>`: returns the last frame if the worker isn't ready (no blocking) — *not implemented: the buffer keeps the last frame, stale read is implicit*
- [x] Unit tests: concurrent write/read, no deadlock

**Note**: Simple Mutex is enough for 9 objects (~200 bytes). No front/back double buffer.

### Step 1.2: Modify existing Runtime workers ✅

**Files**:
- `rust-engines/src/runtime.rs` (modify playback loop) — *implemented in `rust-engines/src/runtime/mod.rs`*

**Tasks**:
- [x] Add `position_buffer: Option<Arc<PositionBuffer>>` field to `Runtime`
  - `None` = legacy mode (direct OSC, compatibility)
  - `Some(buf)` = worker mode (writes to buffer, no OSC)
- [x] In the playback loop (lines 202-467):
  - If `position_buffer` is `Some`:
    - Compute `raw_pos = fn_ref(t, i)` (compiled sub-graph)
    - Apply **speed** (per-move, stays in the worker)
    - Apply **loop_mode** and **direction** (per-move, stays in the worker)
    - Apply **phase_offset** (per-track, stays in the worker)
    - Write `[(i, pos), ...]` to the buffer
    - **Do not** apply scale, rotation, shift, radius_scale, height_offset, depth (moved up to the merge thread)
    - **Do not** send OSC
    - **Do not** emit a Tauri event
  - If `position_buffer` is `None`:
    - Current behavior (legacy, compatibility)
- [x] Add `set_position_buffer(&mut self, buffer: Arc<PositionBuffer>)`
- [x] Add `unset_position_buffer(&mut self)` (return to legacy mode)
- [x] Keep `set_speed()` per-move (atomic fast path in RuntimeConfig)
- [x] Tests: worker in buffer mode doesn't do OSC, doesn't apply spatial macros

### Step 1.3: MergeRuntime struct (Rust) ✅

**Files**:
- `rust-engines/src/merge_runtime.rs` (new) — *implemented in `rust-engines/src/merge_runtime/`*
- `rust-engines/src/lib.rs` (export)

**Tasks**:
- [x] Create `MergeRuntime` struct:
  ```rust
  pub struct MergeRuntime {
      thread: Option<JoinHandle<()>>,
      running: Arc<AtomicBool>,
      socket: UdpSocket,
      osc_sender: Arc<Mutex<OscSender>>,
      move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
      active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
      // Spatial macros only (scale, rotation, shift, radius_scale, height_offset)
      // NOT speed (speed stays per-move in workers)
      macros: Arc<MacroState>,
      audio_state: Arc<Mutex<AudioState>>,  // shared with workers
      origin: Arc<Mutex<Vector3<f64>>>,
      osc_ids: Arc<RwLock<Vec<u32>>>,
      merge_strategy: Arc<RwLock<MergeStrategy>>,
      perf: Arc<PerfMonitor>,
      position_callback: Arc<Mutex<Option<Box<dyn Fn(f64, &[(usize, Vector3<f64>)]) + Send + Sync>>>>,
  }
  ```
- [x] Create `MoveState` struct:
  ```rust
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
- [x] Create `MergeStrategy` enum:
  ```rust
  enum MergeStrategy {
      Override,      // last active move wins
      Crossfade,     // fade-weighted blend
      Blend,         // weighted average
      Priority,      // highest-priority move
  }
  ```
- [x] Implement `MergeRuntime::start()`: starts the merge thread
- [x] Implement `MergeRuntime::stop()`: stops the thread cleanly
- [x] Implement the merge thread loop:
  ```
  1. Read all buffers (simple lock, latest frame)
  2. For each track_id, resolve multiple positions per MergeStrategy
  3. Apply fade (fade_in/fade_out) per move
  4. Apply spatial macros (scale, rotation, shift, radius_scale, height_offset)
     — existing code moved from runtime.rs
  5. Apply depth + origin — existing code moved
  6. Separate display positions (everything) from OSC positions (excludes preview)
  7. Send OSC (single socket, osc_positions only)
  8. Position callback (single event, display_positions)
  9. Perf monitor
  ```
- [x] Implement `resolve_merge()` for each strategy:
  - `Override`: for each track, take the position of the move with the highest weight
  - `Crossfade`: linear blend between active moves weighted by weight * fade
  - `Blend`: weighted average of all positions
  - `Priority`: highest-priority move wins
- [x] Implement `register_move(move_id, buffer, osc_ids, track_indices, is_preview)`
- [x] Implement `unregister_move(move_id)`
- [x] Implement `set_merge_strategy(strategy)`
- [x] Implement `set_macros(request)` (atomic fast path, spatial only)
- [x] Implement `set_origin(origin)`
- [x] Implement `set_osc_ids(osc_ids)` (when track selection changes)
- [x] Implement preview separation: display_positions = everything, osc_positions = excludes preview
- [ ] Crash handling: watchdog detects a worker that hasn't written for > 2 frames → unregister — *not implemented (see "Technical notes")*

**Tests**:
- [x] Unit test: 2 moves on the same track → merge override
- [x] Unit test: 2 moves on the same track → merge crossfade
- [x] Unit test: move fade in/out
- [ ] Unit test: a worker crashes → merge skips it, others continue — *depends on the watchdog (not implemented)*
- [x] Unit test: spatial macros applied only once
- [x] Unit test: preview mode → display but no OSC
- [x] Unit test: speed stays per-move (verify the merge thread doesn't touch speed)

### Step 1.4: Tauri Commands (Rust) ✅

**Files**:
- `tauri-app/src-tauri/src/commands/merge_commands/` (move_management, graph_updates, macros, channels, zones, modulations, manual_positions)
- `tauri-app/src-tauri/src/commands/playback.rs` (refactor)
- `tauri-app/src-tauri/src/lib.rs` (register commands)
- `tauri-app/src-tauri/src/state.rs` (AppState with MergeRuntime)

**Tasks**:
- [x] Add `MergeRuntime` to `AppState`:
  ```rust
  pub struct AppState {
      merge_runtime: Mutex<MergeRuntime>,
      movements: Mutex<HashMap<String, Movement>>,  // existing workers
      audio_state: Arc<Mutex<AudioState>>,  // shared workers + merge
      // ... rest unchanged
  }
  ```
- [x] `activate_move(move_id, graph_json, osc_ids, track_indices, is_preview, origin)`:
  1. Compile the sub-graph
  2. Create a `Runtime` worker with the sub-graph
  3. Share `audio_state` with the worker (already the case)
  4. Create a `PositionBuffer` and attach it to the worker
  5. Start the worker thread
  6. `merge_runtime.register_move(move_id, buffer, osc_ids, track_indices, is_preview)`
  7. Start the merge runtime if not already running
  8. Emit `active-moves-update`
- [ ] `deactivate_move(move_id, fade_duration)`:
  1. `merge_runtime.start_fade_out(move_id, fade_duration)`
  2. When fade completes: `merge_runtime.unregister_move(move_id)`
  3. Stop the worker thread
  4. Emit `active-moves-update`
- [ ] `deactivate_all_moves(fade_duration)`:
  1. Fade out all active moves
  2. When all fades complete: stop all workers
- [ ] `update_move_graph(move_id, graph_json, fade_duration)`:
  1. Recompile the sub-graph
  2. Hot-swap in the worker (existing recall_cue)
- [ ] `set_merge_strategy(strategy)`:
  1. `merge_runtime.set_merge_strategy(strategy)`
- [ ] `set_macro(request)` (fast path, spatial only):
  1. `merge_runtime.set_macros(request)` (once, not per movement)
- [ ] `set_move_speed(move_id, speed)` (new, per-move):
  1. `movements[move_id].runtime.set_speed(speed)` (atomic fast path in the worker)
- [ ] `set_audio_state(state)` (unchanged):
  1. Update `audio_state` (shared with workers + merge thread)
- [ ] **Remove** `set_movement_macro` (no more per-movement spatial macros)
- [ ] `global-positions` event (single, replaces `movement-positions-{id}`)
- [ ] `active-moves-update` event (replaces `movements-update`)

**Tests**:
- [ ] Integration test: activate → deactivate → verify no leak
- [ ] Integration test: 2 active moves → single OSC stream
- [ ] Integration test: hot-swap graph during playback
- [ ] Integration test: merge strategy change live
- [ ] Integration test: per-move speed (2 moves at different speeds)
- [ ] Integration test: preview mode → 3D sees it, OSC doesn't send

### Step 1.5: Frontend — adapt IPC calls

**Files**:
- `tauri-app/frontend/src/store/slices/moveSlotsSlice.ts` (playSlot, stopSlot)
- `tauri-app/frontend/src/store/slices/macrosSlice.ts` (pushMacrosToRuntime)
- `tauri-app/frontend/src/store/useGraphStore.ts` (listeners)

**Tasks**:
- [ ] `playSlot`: call `activate_move` instead of `play_movement`
  - Pass `osc_ids`, `track_indices`, `is_preview`, `origin`
- [ ] `stopSlot`: call `deactivate_move` instead of `stop_movement`
- [ ] `stopAllSlots`: call `deactivate_all_moves` instead of `stop_all_movements`
- [ ] `pushMacrosToRuntime`: call `set_macro` **once** (not per movement)
  - Spatial macros only (scale, rotation, shift, radius_scale, height_offset)
- [ ] `pushSpeedToRuntime`: call `set_move_speed` per move (per-move)
- [ ] `usePositionListener`: listen to `global-positions` instead of `movement-positions-{id}`
- [ ] `useMovementPositionsListener`: simplify — single event
- [ ] `syncSlotMovements`: adapt for `active-moves-update`
- [ ] Add UI for merge strategy (dropdown in Inspector or toolbar)

**Tests**:
- [ ] E2E test: play a move → positions arrive via `global-positions`
- [ ] E2E test: play 2 moves → single positions stream
- [ ] E2E test: stop a move → fade out → positions stop
- [ ] E2E test: change merge strategy live
- [ ] E2E test: per-move speed (2 moves at different speeds)

### Step 1.6: Frontend — simplified render loop

**Files**:
- `tauri-app/frontend/src/hooks/useRenderLoop.ts`

**Tasks**:
- [ ] Remove frontend-side merging (lines 226-265) — merging is done Rust-side
- [ ] Read positions from the global callback (single `positions` array)
- [ ] Map `positions[i]` → `objectsRef.current[i]` (direct 0-based)
- [ ] Remove multi-movement logic (`mvPosMaps`, etc.)

**Tests**:
- [ ] E2E test: 2 moves → objects displayed correctly
- [ ] E2E test: objects no longer jitter when 2 moves target the same track

### Step 1.7: Migration and cleanup

**Tasks**:
- [ ] Migration: existing moveSlots keep working (same graph_json)
- [ ] Speed stays in moveSlots (per-move)
- [ ] Spatial macros pushed to the merge runtime (once)
- [ ] Full tests: Rust, TS 0 errors, Playwright 51+

---

## Phase 2: Post-processing graph

**Goal**: Spatial macros + audio mods + depth + origin + manual positions → global graph nodes.
**Estimated duration**: 5-8 sessions.
**Risk**: high (compiler + UI refactor).

### Step 2.1: PostProcessFn type and compiler (Rust)

**Files**:
- `rust-engines/src/engines/mod.rs` (PostProcessFn type)
- `rust-engines/src/compiler.rs` (new compile_post_process)

**Tasks**:
- [ ] Define `PostProcessFn`:
  ```rust
  type PostProcessFn = Box<dyn Fn(
      f64,                                    // t
      Vec<(usize, Vector3<f64>)>,            // merged positions
      &MacroState,                            // fast path spatial macros
      &AudioState,                            // audio state (for AudioFalloff)
      &HashMap<u32, [f64; 3]>,               // track positions (for Barycenter)
      &HashMap<usize, [f64; 3]>,             // manual positions (for ManualPos)
  ) -> Vec<(usize, Vector3<f64>)> + Send + Sync>;
  ```
- [ ] Implement `compile_post_process(global_graph, audio, track_positions)`:
  - Traverses the global graph nodes
  - Compiles each Transform node (Scale, Rotate, Offset) into a closure
  - Compiles AudioFalloff nodes (AudioState read)
  - Compiles the PerTrackDepth node (indexed by object_index)
  - Compiles the Barycenter node (origin computation from track_positions)
  - Compiles the ManualPosition node (override from manual_positions)
  - Chains the closures along the graph edges
- [ ] Transform node params are bound to `Arc<AtomicU64>` (fast path)
- [ ] Hot-swap: `merge_runtime.swap_post_process_fn(new_fn)` with crossfade

### Step 2.2: Transform nodes in the global graph (Rust)

**Files**:
- `rust-engines/src/engines/transform.rs` (new)

**Tasks**:
- [ ] `ScaleNode`: `pos * scale_ref.load()` (atomic fast path)
- [ ] `RotateNode`: rotation matrix from yaw/pitch/roll refs
- [ ] `ShiftNode`: `pos + shift_ref.load()`
- [ ] `RadiusScaleNode`: `origin + (pos - origin) * radius_ref.load()`
- [ ] `HeightOffsetNode`: `pos.y + height_ref.load()`
- [ ] `PerTrackDepthNode`: `origin + (pos - origin) * depths[i] * fade`
  - Takes an array of depths, indexes by object_index
- [ ] `BarycenterNode`: computes origin from track_positions (.hol positions)
- [ ] `AudioFalloffNode`: reads AudioState, produces [0,1], modifies a parameter
- [ ] `ManualPositionNode`: overrides the position for certain objects
  - Reads the manual_positions HashMap
  - If an entry exists for this object → override
  - Otherwise → keeps the computed position

### Step 2.3: MergeRuntime — remove the hardcoded chain

**Files**:
- `rust-engines/src/merge_runtime.rs`

**Tasks**:
- [ ] Replace the hardcoded post-processing lines with:
  ```rust
  let transformed = post_process_fn(
      t, merged, &macros, &audio_state, &track_positions, &manual_positions
  );
  ```
- [ ] The MergeRuntime now only does: read buffers → merge → post_process_fn → OSC
- [ ] Add `swap_post_process_fn(new_fn, fade_duration)` for hot-swap
- [ ] Speed stays per-move (in workers, unchanged)

### Step 2.4: Frontend — global graph editor

**Files**:
- `tauri-app/frontend/src/components/NodeEditor.tsx`
- `tauri-app/frontend/src/store/useGlobalGraphStore.ts` (new)
- `tauri-app/frontend/src/components/nodeParamSchema.ts` (add global nodes)

**Tasks**:
- [ ] Create `useGlobalGraphStore` (global graph nodes + edges)
- [ ] Add "Global" tab in the NodeEditor
- [ ] MoveRef nodes: references to the moves' sub-graphs
- [ ] Transform nodes: Scale, Rotate, Shift, RadiusScale, HeightOffset
- [ ] AudioFalloff nodes: source + target + amount
- [ ] PerTrackDepth node: depths array (one slider per track in the Inspector)
- [ ] Barycenter node: origin computation (reads track positions)
- [ ] ManualPosition node: position override (connected to 3D drag)
- [ ] Output node: terminal
- [ ] Compile the global graph → `update_global_graph` command
- [ ] **Flexibility**: a Scale node can be placed in the sub-graph (per-move) OR in the global graph (post-merge)

### Step 2.5: Perform Panel

**Files**:
- `tauri-app/frontend/src/components/PerformPanel.tsx` (new)

**Tasks**:
- [ ] Slider view of the global graph node params
- [ ] Scale, Rotate, Shift, Radius, Height → sliders (atomic fast path)
- [ ] AudioFalloff amount → slider
- [ ] PerTrackDepth → one slider per track
- [ ] Bidirectional sync: slider ↔ node param (same data)
- [ ] **Intuitiveness**: the musician sees sliders, not nodes. Two views, same data.

### Step 2.6: ManualPositions sync (3D drag)

**Files**:
- `tauri-app/frontend/src/hooks/useManipulateMode.ts`
- `tauri-app/frontend/src/store/slices/holProjectSlice.ts`

**Tasks**:
- [ ] Drag an object in the 3D view → invoke `set_manual_position(obj_idx, [x,y,z])`
- [ ] The object stays at its manual position (ManualPosition node applies it)
- [ ] Double-click or "release" button → invoke `clear_manual_position(obj_idx)`
- [ ] The object returns to the graph-computed position
- [ ] If the global graph has no ManualPosition node → create it automatically (default)

### Step 2.7: Track positions sync (for Barycenter)

**Files**:
- `tauri-app/frontend/src/store/slices/holProjectSlice.ts`

**Tasks**:
- [ ] On .hol load → invoke `set_track_positions(positions_map)`
- [ ] The Barycenter node reads these positions to compute the origin
- [ ] If no .hol → empty track_positions → origin = [0,0,0]

### Step 2.8: Migration

**Tasks**:
- [ ] Migration script: for each existing moveSlot
  - Spatial macros (scale, rotation, shift, radius_scale, height_offset) → Transform nodes in the global graph
  - Speed stays in the slot (per-move)
  - Audio mods → AudioFalloff nodes in the global graph
  - Per-track depths → PerTrackDepth node in the global graph
- [ ] Remove `useAnimationStore.audio_mods` (replaced by nodes)
- [ ] Remove spatial `MacrosState` (replaced by node params, exposed via the Perform Panel)
- [ ] Keep `speed` in `MacroState` per-move (in workers)

---

## Phase 3: Unified graph ✅ DONE

**Goal**: Everything is graph, nested editor, MoveRef nodes, extended cue system.
**Estimated duration**: 8-12 sessions.
**Risk**: high (major UI, data migration).

### Step 3.1: MoveRef nodes ✅

**Tasks**:
- [x] `MoveRef` node in the global graph: references a sub-graph by ID
- [x] Double-click → opens the sub-graph (selects the slot + switches tab)
- [x] The sub-graph is stored in `moveSlots[slotId].graphJson`
- [x] The MergeRuntime handles merging — the `Input` node represents the merged positions
- [x] Active MoveRefs highlighted (green boxShadow)

### Step 3.2: Nested graph editor ✅

**Tasks**:
- [x] Tabs: "Sub-graph" + "Global"
- [x] Breadcrumb: `Sub-graph › Move A` (name of the slot being edited)
- [x] React Flow: one instance per tab (switch via `activeTab`)
- [x] Drag & drop: MoveRef from the "Global (Post-process)" palette

### Step 3.3: Extended cue system ✅

**Files**:
- `rust-engines/src/cuelist.rs` (extended Cue struct)
- `tauri-app/src-tauri/src/commands/cue_commands.rs` (store_cue, recall_cue, list_cues, delete_cue)

**Tasks**:
- [x] Extend `Cue` struct:
  ```rust
  pub struct Cue {
      // ... existing fields ...
      // Phase 3:
      pub global_graph: Option<GraphJson>,
      pub active_move_ids: Vec<String>,
      pub per_track_depths: Vec<f64>,
      pub manual_positions: HashMap<usize, [f64; 3]>,
      pub spatial_macros: Option<SpatialMacroSnapshot>,
  }
  ```
- [x] Recall (7 steps):
  1. Deactivate moves not listed in `active_move_ids`
  2. Hot-swap the global graph if `global_graph` is present
  3. Restore macros (speed, scale, shift, rotation)
  4. Restore spatial macros (radius_scale, height_offset)
  5. Restore per-track depths
  6. Restore manual positions
  7. Emit `cue-recalled` (frontend activates the moves)
- [x] Frontend: `useCuelistStore` + `CuelistPanel` + "Cues" tab
- [x] Tests: extended serialization + backward compatibility

### Step 3.4: Remove vestiges ✅ (partial — hybrid)

**Removed**:
- [x] `play_movement`/`stop_movement`/`stop_all_movements`/`stop_movement_with_fade` (Tauri commands)
- [x] `list_movements`/`set_movement_macro`/`update_movement_graph` (Tauri commands)
- [x] `movements.rs` file removed
- [x] `test_playwright.cjs` mocks cleaned up
- [x] Unused `playMovement` import in `Toolbar.tsx`

**Kept (hybrid architecture — still active)**:
- [ ] `Runtime` legacy mode — used by `play_graph`/`preview_graph`/`launch_animation`
- [ ] `useAnimationStore` — used by 9 frontend files
- [ ] `AnimationState` Rust — used by the animation system
- [ ] `compute_audio_modulated_params` — called in the runtime loop
- [ ] `Objects` node — required by the validator, used by the frontend
- [ ] `playback.rs` commands — used by `useGraphStore`

> **Note**: These elements will be removed once the hybrid system is
> fully migrated to the MergeRuntime (Phase 4 — future).

### Step 3.5: Merge node UI ✅

**Tasks**:
- [x] `Merge` node in the global graph palette
- [x] Visual source (no input — merging is handled by the MergeRuntime)
- [x] Params: strategy (override/crossfade/blend/priority), fade_duration
- [x] Functional equivalent of `Input` (produces the merged positions)

---

## Priority order

```
Phase 1 (short term) ──── Merge + MergeRuntime (hybrid)
  │
  ├── 1.1 PositionBuffer struct
  ├── 1.2 Modify Runtime workers (buffer mode, keep speed/loop/dir)
  ├── 1.3 MergeRuntime struct + merge thread
  ├── 1.4 Tauri commands (activate/deactivate/set_move_speed)
  ├── 1.5 Frontend IPC
  ├── 1.6 Simplified render loop
  └── 1.7 Migration + cleanup
        │
Phase 2 (medium term) ──── Post-processing graph
  │
  ├── 2.1 PostProcessFn + compiler
  ├── 2.2 Transform nodes (Scale, Rotate, Shift, PerTrackDepth, Barycenter, ManualPos)
  ├── 2.3 MergeRuntime cleanup (remove hardcoded)
  ├── 2.4 Global graph editor (frontend)
  ├── 2.5 Perform Panel
  ├── 2.6 ManualPositions sync (3D drag)
  ├── 2.7 Track positions sync (for Barycenter)
  └── 2.8 Migration
        │
Phase 3 (long term) ──── Unified graph
  │
  ├── 3.1 MoveRef nodes
  ├── 3.2 Nested editor
  ├── 3.3 Extended cue system
  ├── 3.4 Vestiges cleanup
  └── 3.5 Merge node UI
```

## Validation criteria per phase

### Phase 1
- [ ] 2 moves on the same track → no jitter
- [ ] 1 single UDP socket → 1 single OSC stream
- [ ] Fade in/out works
- [ ] Sub-graph hot-swap during playback
- [ ] Workers in parallel (check CPU usage with complex engines)
- [ ] Crash isolation: one worker crashes → others continue
- [ ] Per-move speed: 2 moves at different speeds
- [ ] Preview mode: 3D sees the move, OSC doesn't send it
- [ ] UI unchanged (no regression)
- [ ] Latency < 1 added frame (16ms max, acceptable)

### Phase 2
- [ ] Spatial macros = Transform nodes in the global graph
- [ ] Audio mods = AudioFalloff nodes
- [ ] Depth = PerTrackDepth node (indexed by object_index)
- [ ] Origin = Barycenter node (reads .hol track positions)
- [ ] ManualPositions = ManualPosition node (3D drag → override)
- [ ] Configurable transformation order
- [ ] Perform Panel for live control (sliders)
- [ ] No more hardcoded chain in the MergeRuntime
- [ ] Atomic fast path for all live params
- [ ] Speed stays per-move (in workers)
- [ ] Flexibility: per-move Transform (sub-graph) OR global (global graph)

### Phase 3 ✅
- [x] MoveRef nodes in the global graph
- [x] Nested editor (tabs + double-click)
- [x] Extended cue system (global graph snapshot + active moves + depths + manual positions)
- [x] Legacy commands removed (play_movement, stop_movement, etc.)
- [ ] Simplified MovesTable (kept — too many useful features: setlist, macros, track picker)
- [ ] No more AnimationState or Objects node (kept — hybrid architecture)
- [x] Merge node UI (strategy + fade_duration)

## Technical notes

### Buffer — acceptable latency

The buffer (simple Mutex) adds 0-1 frame of latency (16ms max at 60fps). That's acceptable for spatial audio:
- The human ear doesn't detect latency < 30ms
- Holophonix already has ~5-10ms network latency
- The total stays well below the perceptible threshold

### Crash isolation — strategy

If a worker crashes (Rust panic):
1. The `PositionBuffer` keeps the last valid frame
2. The merge thread reads the stale frame (1 frame behind, invisible)
3. A watchdog detects the worker crash (no write for > 2 frames)
4. The merge thread unregisters the crashed move
5. Other moves continue normally
6. `active-moves-update` event emitted to notify the frontend

If the merge thread crashes:
1. The watchdog restarts it automatically
2. Workers keep writing to their buffers
3. The merge thread resumes reading the buffers
4. Latency: ~1s (restart time), acceptable for a rare case

### Speed vs spatial macros — the separation

| Parameter | Level | Why |
|---|---|---|
| `speed` | Per-move (worker) | Affects `t`. Two moves at different speeds. |
| `loop_mode` | Per-move (worker) | Loop vs OneShot. Per-move. |
| `direction` | Per-move (worker) | Forward/Backward/PingPong. Per-move. |
| `phase_offset` | Per-move (worker, sub-graph) | Per-track, temporal offset. |
| `scale` | Global (global graph) | Spatial transformation. |
| `rotation` | Global (global graph) | Spatial transformation. |
| `shift` | Global (global graph) | Spatial transformation. |
| `radius_scale` | Global (global graph) | Spatial transformation. |
| `height_offset` | Global (global graph) | Spatial transformation. |
| `depth` | Global (global graph, PerTrack) | Spatial, but per-track. |

**Flexibility**: a `Scale` node can also be placed in the sub-graph (per-move) for a move-local scale. Same node, two application levels.

### Per-track parameters — modeling

`PerTrackDepthNode` indexes by `object_index`:
```rust
let depth = depths.get(object_index).unwrap_or(1.0);
origin + (pos - origin) * depth * fade
```

In the Perform Panel: one slider per track for depth. Not a node you connect — a projected view of the PerTrackDepth node.

### ManualPositions — 3D interaction

Dragging an object in the 3D view:
1. Writes to `manual_positions_ref` (atomic, fast path)
2. The ManualPosition node reads it at the next frame
3. The object jumps to the manual position
4. To "release" the object: `clear_manual_position` → the object returns to the computed position

If the global graph has no ManualPosition node, the drag does nothing. Solution: always include a ManualPosition node by default (auto-created).

### AudioState — shared

A single `Arc<Mutex<AudioState>>` shared between:
- The workers (for audio engines: BPM, AudioAmplitude, AudioSpectrum)
- The merge thread (for the global graph's AudioFalloff nodes)

Already the case today. **No change needed.**

### OSC profile — globalized

In Phase 1, the OSC profile becomes global (single socket, single receiver). In practice, we always send to the same receiver (Holophonix). If we want multiple receivers eventually, we'd need a routing node in the global graph (Phase 3+).

---

## Phase 4 — Extended spatial channels (research-informed)

Reference: `RESEARCH_STATE_OF_ART.md` — synthesis of research implications.

### Rationale

Research (ToscA/IRCAM, SPAT Revolution, ADM-OSC, movement psychoacoustics)
shows that position is only **1 parameter out of ~10** accepted by
renderers: gain, spread/width, distance, presence, yaw/orientation,
aperture, lfe. STAGESPACE today only exploits `aed`/`xyz`.

The second identified value layer — **spatial effects orchestrator** — is
blocked by this format. Phase 4 unblocks it.

### P1: `SpatialChannels` + multi-message sending ✅ in progress

**Model**: extended spatial state per object, each channel `Option<f64>` —
`None` = not sent (no unnecessary traffic).

```rust
pub struct SpatialChannels {
    pub gain: Option<f64>,      // dB or normalized depending on profile
    pub spread: Option<f64>,    // 0-1 normalized (converted by profile)
    pub distance: Option<f64>,  // explicit override
    pub presence: Option<f64>,  // IRCAM Spat
    pub yaw: Option<f64>,       // source orientation (degrees)
    pub aperture: Option<f64>,  // IRCAM Spat (degrees)
    pub lfe: Option<f64>,       // dB
}
```

**Capability matrix per profile** (`channel_address`):

| Channel | IRCAMSpat | Holophonix | ADM-OSC | Generic* | IEM |
|---------|-----------|------------|---------|----------|-----|
| gain | `/source/N/gain` | `/track/N/gain` | `/adm/obj/N/gain` | `/object/N/gain` | — |
| spread | `/source/N/spread` (×100) | — | `/adm/obj/N/width` | `/object/N/spread` | — |
| distance | `/source/N/distance` | — | `/adm/obj/N/dist` | `/object/N/distance` | — |
| presence | `/source/N/presence` | — | — | — | — |
| yaw | `/source/N/yaw` | — | — | `/object/N/yaw` | — |
| aperture | `/source/N/aperture` | — | — | — | — |
| lfe | `/source/N/lfe` | — | — | — | — |

Conservative matrix — only send what's confirmed supported. Extensible.

**Tasks**:
- [x] `SpatialChannel` enum + `SpatialChannels` struct in `osc_sender.rs`
- [x] `OscProfile::channel_address()` — capability matrix
- [x] `OscSender::format_state()` → `Vec<(addr, values)>` (position + channels)
- [x] `MergeRuntime::object_channels` map + `set_object_channel`/`clear_*`
- [x] Extended send loop (position + channel messages, preview filtered)
- [x] Tauri commands `set_spatial_channel`/`clear_spatial_channel`/`clear_all`
- [x] CLI `set-channel`/`clear-channel` (e2e test)

### P2: Kinematic modulation → channels ✅ in progress

`Speed`/`Acceleration`/`Jerk` measured on **final** positions
(post-merge + post-process — what the renderer receives) → modulation
rules that write to spatial channels, taking precedence over static
values (`SpatialChannels::overlay`).

**Chosen implementation**: modulation rules at the MergeRuntime level
(`channel_modulations`), no `PostProcessFn` modification — kinematics
is measured at the output, so it also captures the effects of macros,
merges and post-process. Thread-local in the merge thread (no lock),
anti-spike warmup (speed ≥2 samples, accel ≥3, jerk ≥4), configurable
one-pole smoothing.

**Tasks**:
- [x] `kinematics.rs`: `KinematicSource` (speed/accel/jerk),
      `KinematicState` (derivatives + warmup + smoothing), `ChannelModulation`
      (source→channel, scale/offset/clamp, optional object filter),
      `apply_modulations`
- [x] `SpatialChannels::overlay` (modulation takes precedence)
- [x] MergeRuntime: `add/remove/clear_modulations`, `modulations`,
      `set_kinematic_smoothing` — computed in the loop, real dt
- [x] Tauri commands: `add_channel_modulation` (params struct),
      `remove_channel_modulation`, `clear_channel_modulations`,
      `set_kinematic_smoothing`
- [x] CLI: `mod-add`/`mod-list`/`mod-clear`/`kin-smoothing`

- [x] `PerceptualVelocity`: `angvel` (AngularSpeed) source — angular
      velocity °/s around the `listener` (parameterizable listening
      point, MAMA bound) — `KinematicState` stores the smoothed velocity
      vector, `ChannelModulation.listener`, CLI `mod-add angvel ... [listener x,y,z]`,
      FX panel (AngularSpeed option + listener inputs)

*(Graph `Velocity` node + cue persistence: done — see §Graph-native
effects below.)*

### P3: libmapper-style OSC IN mapping ✅

The cockpit becomes bidirectional: any OSC controller (SpaceMouse, X-Touch,
StreamDeck via Companion, Chataigne, TUIO…) can drive internal parameters,
with a composable transform per mapping.

**Architecture** (`osc_receiver.rs`):

- `OscMapping { address, destination, transform, enabled }` — the address
  accepts `*` wildcards per segment (`/track/*/gain` captures the index).
- `MappingDestination`:
  - `handler:name` — passive storage (frontend polling / graph injection)
  - `macro:name` — MergeRuntime spatial macros (scale, shift_x/y/z,
    yaw, pitch, roll, radius_scale, height_offset — `speed` excluded, per-move)
  - `channel:ch:obj` — extended spatial channel of an object (same channels as P1)
  - `position:obj` — manual position (3 values) → `manual_positions`
  - `obj` = fixed index or wildcard `"*"`/`"*N"` (captured segment → usize)
- `Transform`: deadzone → `v*scale+offset` → clamp [min,max] → per-mapping
  one-pole smoothing (`smooth` [0,1)). Replaces the old inert string field.
- `OscInTargets`: shared Arcs of the MergeRuntime (`macros`, `object_channels`,
  `manual_positions`) — the receiver thread writes directly, **no lock
  added to the real-time path** of the merge.
- Hot-reloadable mappings (`Arc<RwLock>`) — modifiable while the
  receiver is running (before: frozen at `start()`).
- Anti-loop (Holophonix-chataigne pattern): `suppress_ms()` — ignore
  window after recall (500ms) and panic (200ms); `set_in_enabled` master
  switch; `OscInStats` (received/matched/routed/dropped).
- `handle_message()` public — testable pipeline without UDP (`osc-inject` CLI).

**Tasks**:
- [x] `Transform`, `ObjectRef`, `MacroTarget`, `MappingDestination`,
      `OscMapping`, `OscInTargets`, `OscInStats` in `osc_receiver.rs`
- [x] `MergeRuntime::osc_in_targets()`
- [x] Tauri commands: `osc_add_mapping` (full payload), `osc_set_in_enabled`,
      `osc_suppress_in`, `osc_in_stats`; `set_osc_receiver_port` preserves
      mappings/targets/state; auto-suppression on `recall_cue` (500ms) and
      `send_osc_position`/panic (200ms)
- [x] CLI: `osc-map`, `osc-unmap`, `osc-maps`, `osc-inject`, `osc-values`,
      `osc-in on|off|start|stop|stats`, `osc-suppress`
- [x] Frontend: `oscSlice` (destination + transform `key=value`),
      `OscPanel` updated

**Remaining**: `modparam:` destination (drive P2 rules via OSC),
multi-segment `#` matching, derived values (input delta/velocity),
learn-by-demonstration (Wekinator). *(Cue persistence: done — see §Persistence.)*

### P4: Spatial effect zones ✅

Control-side SFFX: a [`Zone`] is a region of space (sphere or box)
that pulls the spatial channels of objects inside it toward target
values, proportional to the influence (smoothstep over `falloff` beyond
the edge).

**Architecture** (`zones.rs`):

- `ZoneShape::Sphere { center, radius }` | `Box { min, max }` — signed
  distance to the edge (SDF), `influence = 1 − smoothstep(d/falloff)`.
- `Zone { shape, falloff, channels, objects, enabled }` — `channels` =
  `SpatialChannels` target at full influence; `objects` optional filter.
- Blend: `effective[ch] = lerp(base_or_neutral, zone[ch], influence)` where
  `base` = static or kinematically modulated value (neutral: gain=1,
  others=0). Composable zones — applied in order.
- Evaluated in the merge thread on **final** positions after kinematic
  modulation — zones see the actually emitted movement.

**Tasks**:
- [x] `zones.rs`: `ZoneShape` (sphere/box SDF), `Zone`, `influence`,
      `apply_zones`, `any_zone_applies`
- [x] `SpatialChannels::get` / `iter`
- [x] MergeRuntime: `add/remove/clear/list` zones, zones pass in the
      loop after kinematic modulation
- [x] Tauri commands: `add_zone` (params struct), `remove_zone`,
      `clear_zones`, `list_zones`
- [x] CLI: `zone-add sphere|box … --channels ch=v,… [--falloff] [--objs]`,
      `zone-list`, `zone-clear`

**Remaining**: additional shapes (cylinder, half-space plane), temporal
zones, 3D zone visualization in the canvas. *(Graph `Zone` node + cue
persistence: done — see §Graph-native effects.)*

### Runtime state persistence in cues ✅

`store_cue` captures the real backend state at store time (the engine
holds the truth, not the frontend): `object_channels` (P1),
`channel_modulations` (P2), `osc_mappings` (P3), `zones` (P4) — all
`Option` + `#[serde(default)]`: old cues (`None`) don't touch the
current state, new ones restore exactly (clear + re-set).

The frontend persists the full `Cue` received from `store_cue` — the new
fields flow through automatically, no field to fill in the UI.

**Latent fix**: `ChannelModulation.min/max` (±∞ by default) weren't
JSON-serializable (inf → null → read error). Serde helpers
`non-finite f64 ↔ null` added.

### `Zone` / `Velocity` graph nodes — graph-native effects ✅

P2/P4 effects are now **declarable in the global graph** via
two nodes, persistent by construction (graph JSON → localStorage → cues).

**Architecture** — pass-through declarations:

- The `Zone`/`Velocity` nodes live in the global graph's linear chain
  (`Input → … → Zone → … → Output`) as single-`input`-port
  nodes — but they don't transform **positions** (pass-through in
  `compile_transform_node`). Their role is declarative.
- On each `update_global_graph` (and at `recall_cue`), `extract_graph_effects`
  walks the nodes, parses their params → `graph_zones` / `graph_modulations`
  of the MergeRuntime (`set_graph_effects` — block replacement, never
  duplicates on re-compilation).
- Evaluated every frame **with** manual effects: graph rules/zones
  are applied first, manual ones after — live adjustment keeps the
  last word.
- Tolerant params (`node_params.rs`): the editor's `text` fields arrive
  as strings — `channels` accepts `{"gain":0}` or `"gain=0,spread=1"`,
  `objects` accepts `[0,2]` or `"0,2"`, vec3 accepts array or `"x,y,z"`,
  empty `min`/`max` → ±∞. Invalid zone (no channel, unknown shape)
  → explicit compilation error rather than a silently lost effect.
- Validator: `Zone`/`Velocity` are global-only (`ContextIncompatible`
  in sub-graph), one `input` port, connectable from/to
  post-process nodes.
- Frontend: `PARAM_SCHEMA` entries + Global category (global tab
  palette), `GLOBAL_ONLY_NODES`, descriptions; the FX panel displays
  graph-declared effects read-only (`list_graph_effects`).
- Fix in passing: param edits of global-tab nodes went to the
  sub-graph store (no-op) — `CustomNode` now routes to
  `useGlobalGraphStore.updateNodeData` when the node lives there.

**Remaining**: manual effects (FX panel) stay runtime-only, persisted
by cues.

### P5 — `VectorField` node (steering, Carpentier/Gerzso) — DONE

- New physical engine `VectorField` (sub-graph, same category as
  `Bouncing`/`Swarm`): objects are **advected** by a velocity field
  `v(p)` on the (x,y) plane instead of following a curve `f(t)`.
- Procedural fields: `vortex` (rigid body inside, 1/r outside),
  `sink`/`source` (radial, `swirl` → spiral), `flow` (uniform),
  `noise` (smooth vector value noise, seeded).
- Steering: `responsiveness` inertia, `wander` jitter (per-object
  seeded RNG → deterministic), soft `bounds`/`containment` confinement,
  `max_speed` clamp. Initial layouts: circle/line/grid/random/point.
  `z` in closed form (`z_init + z_drift·t`).
- Pure `f(t)` via deterministic re-simulation from t=0 (`swarm` pattern)
  — O(t·fps) cost per object, no shared state.
- Validator: `input`+`duration` ports, Objects/Duration targets,
  Output/composites only (no modifiers — same restriction as
  the physics engines), sub-graph only (`ContextIncompatible` in global).
- Frontend: `NodeType`, `connectionRules`, `PARAM_SCHEMA` (17 params),
  Physics category, defaults, descriptions, "Vector Field" preset
  in the template library.
- 12 tests (9 engine + 3 validator): bounded advection, sink
  convergence, flow translation, source ejection, determinism, per-object
  divergence, closed-form z, allowed/forbidden connections.

- [x] **Drawn** field (`field:"drawn"`): a stroke drawn in Draw mode
      (enabled as soon as a `VectorField` node is in the graph — spline not
      required) is converted into tangent vectors interpolated by IDW
      (`drawn_points`/`drawn_vectors` in the node params, hot-swap
      during playback). Draw mode keeps the spline behavior
      when a spline node is present.
- [x] `PerceptualVelocity`: `angvel` kinematic source (angular
      velocity °/s around the listener) — `Velocity` node,
      `ChannelModulation` rules (FX panel + `listener`), CLI `mod-add`.

- [x] `follow` extensions (Reynolds steering): `mode` =
      follow/pursue/evade/orbit/arrive — interception at the predicted
      point (`lookahead`), confined evasion (`bounds`/`containment`), phased-slots
      carousel (`orbit_speed`/`orbit_dir`), damped arrival
      (`arrive_radius`). Configurable target (`target_radius/speed/z`),
      smoothed velocity (`responsiveness`), per-object scattered init.
      CLI: `pursue`/`evade`/`orbit`/`arrive` are template aliases
      of `follow`. P5 complete.

### P6+: see `RESEARCH_STATE_OF_ART.md` §4.2

SMS + rate limiting, sync (timetags/Link), VirtualMic (ViMiC), TUIO IN,
MSC/MTC.
