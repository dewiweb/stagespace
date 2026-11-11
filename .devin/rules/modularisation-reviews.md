# Modularization reviews — 4 files > 500 lines

Date: August 2025

## Summary

| File | Lines | Proposed modules | Estimated final lines | Difficulty |
|---------|--------|-----------------|------------------------|------------|
| `tauri-app/src-tauri/src/lib.rs` | 2178 | 21 modules | ~100 | ⭐⭐⭐⭐ |
| `tauri-app/frontend/src/store/useGraphStore.ts` | 1146 | 17 modules | ~50 | ⭐⭐⭐⭐ |
| `tauri-app/frontend/src/components/Scene3D.tsx` | 972 | 10 modules | ~150-200 | ⭐⭐⭐ |
| `rust-engines/src/runtime.rs` | 698 | 8 modules | ~150 | ⭐⭐⭐ |

**Total: 4994 lines → ~400 lines** (92% reduction)

---

## 1. lib.rs (2178 → ~100 lines)

### Proposed structure

```
src-tauri/src/
├── lib.rs                    # run() + registration (~100 lines)
├── state.rs                  # AppState struct
├── commands/
│   ├── mod.rs                # Re-exports
│   ├── file_io.rs            # import_hol, save/load_graph
│   ├── audio.rs              # audio state
│   ├── bpm.rs                # BPM tracking
│   ├── audio_reactor.rs      # audio bindings
│   ├── osc.rs                # OSC sender/receiver
│   ├── cuelist.rs            # cuelist CRUD
│   ├── presets.rs            # presets CRUD
│   ├── modulator.rs          # LFOs
│   ├── patch.rs              # patch objects/groups
│   ├── graph.rs              # legacy playback
│   ├── movements.rs          # multi-movement system
│   ├── performance.rs        # perf stats + sampling
│   ├── overrides.rs          # object overrides
│   ├── network.rs            # OSC discovery
│   ├── setlist.rs            # setlist + GO workflow
│   ├── animations.rs         # animation system (shapes)
│   └── legacy.rs             # play/stop (deprecated)
├── graph/
│   ├── mod.rs
│   ├── parser.rs             # build_graph_from_json
│   └── compilation.rs        # compile_graph
└── tests/
    └── animation_tests.rs
```

### Phased plan

| Phase | Modules | Lines moved | Risk | lib.rs after |
|-------|---------|-----------------|--------|-------------|
| 1 | file_io, network, bpm, audio | ~300 | ⭐ | ~1900 |
| 2 | audio_reactor, osc, cuelist, presets, modulator, patch | ~400 | ⭐⭐ | ~1500 |
| 3 | graph/parser, graph/compilation | ~120 | ⭐⭐ | ~1400 |
| 4 | performance, overrides | ~100 | ⭐⭐ | ~1300 |
| 5 | graph (legacy playback) | ~200 | ⭐⭐⭐ | ~1100 |
| 6 | movements | ~250 | ⭐⭐⭐ | ~850 |
| 7 | setlist | ~180 | ⭐⭐⭐⭐ | ~700 |
| 8 | animations | ~200 | ⭐⭐⭐⭐ | ~500 |
| 9 | legacy, state, tests | ~300 | ⭐ | ~100 |

### Key risks
- **Shared AppState**: all modules access `State<'_, AppState>` → document lock ordering
- **Position callbacks**: 4 modules create callbacks → extract a `create_position_callback` helper
- **Movement struct**: contains Runtime + JoinHandle → declare `pub` in `movements.rs`
- **Tests**: use `build_graph_from_shape` → update imports

---

## 2. useGraphStore.ts (1146 → ~50 lines)

### Proposed structure

```
frontend/src/store/
├── useGraphStore.ts          # combines all slices (~50 lines)
├── slices/
│   ├── graphCoreSlice.ts     # nodes/edges + undo/redo
│   ├── playbackSlice.ts      # compile, play/stop/preview, updateGraphLive
│   ├── persistenceSlice.ts   # localStorage + file save/load
│   ├── oscSlice.ts           # OSC mappings + values
│   ├── audioSlice.ts         # audio state
│   ├── holProjectSlice.ts    # .hol import + track selection + manualOscIds
│   ├── macrosSlice.ts        # macros + pushToRuntime + loopMode
│   ├── cueSlice.ts           # store/recall cue + cuelist
│   ├── setlistSlice.ts       # setlist + GO workflow
│   ├── movementSlice.ts      # multi-movement + stopWithFade
│   ├── drawModeSlice.ts      # draw mode + drawnPoints + finalize
│   ├── shapePresetsSlice.ts  # applyShapePreset
│   ├── panicSlice.ts         # panic()
│   └── perfSlice.ts          # perfStats
├── hooks/
│   └── useTauriListeners.ts  # usePositionListener, useOscValueListener, useMovementPositionsListener
├── utils/
│   └── geometryUtils.ts      # computeCentroid, douglasPeucker, simplifyPoints
└── types/
    └── index.ts              # NodeType, AudioState, AppStatus, MovementInfo, CueInfo, HolTrack, HolProject
```

### Phased plan

| Phase | Modules | Risk | Description |
|-------|---------|--------|-------------|
| 1 | perfSlice, audioSlice, oscSlice, persistenceSlice | ⭐ | Self-contained modules |
| 2 | geometryUtils, types/index | ⭐ | Pure functions + types |
| 3 | macrosSlice, holProjectSlice, drawModeSlice | ⭐⭐ | Unidirectional dependencies |
| 4 | movementSlice, cueSlice, setlistSlice | ⭐⭐⭐ | Cross dependencies |
| 5 | playbackSlice, graphCoreSlice, panicSlice | ⭐⭐⭐⭐ | Core + orchestration |
| 6 | hooks/useTauriListeners | ⭐⭐ | Finalization |

### Key risks
- **Circular dependency**: `graphCoreSlice.syncObjectsNode` → `playbackSlice.updateGraphLive` → `graphCoreSlice.nodes/edges` → use thunk pattern with `get()`
- **Missing OSC params**: `oscAddress`, `oscPort`, `oscProfile` aren't in the store → create a `settingsSlice`
- **Dynamic imports**: `prepareGraphForSave` dynamically imported in 8 places → extract as a static utility
- **Non-serializable Maps**: `oscMappings`, `oscValues` are Maps → serialization middleware

---

## 3. Scene3D.tsx (972 → ~150-200 lines)

### Proposed structure

```
frontend/src/
├── components/
│   ├── Scene3D.tsx              # orchestration (~150-200 lines)
│   ├── MovementsIndicator.tsx   # movements UI overlay
│   ├── WebGLFallback.tsx        # WebGL error UI
│   └── (already extracted: TrajectoryVisualization, ModeButtons, MacrosPanel, DrawModeOverlay)
├── hooks/
│   ├── useThreeSceneSetup.ts    # scene, camera, renderer, lights, controls, resize, cleanup
│   ├── useObjects3D.ts          # spheres + CSS2D labels
│   ├── useHolMarkers.ts         # holophonix rings + labels
│   ├── useManipulateHandle.ts   # octahedron handle + trajectory line
│   ├── useRenderLoop.ts         # 60fps loop + ref sync
│   ├── useManipulateMode.ts     # drag handlers (down/move/up/wheel)
│   ├── useDrawMode.ts           # draw handlers + screenToWorld
│   └── useInteractionModes.ts   # toggle OrbitControls per mode
```

### Phased plan

| Phase | Modules | Risk | Description |
|-------|---------|--------|-------------|
| 1 | useHolMarkers, useObjects3D, useManipulateHandle, useInteractionModes | ⭐ | Independent hooks |
| 2 | useDrawMode, useManipulateMode | ⭐⭐ | Interaction handlers |
| 3 | useRenderLoop | ⭐⭐⭐ | Critical 60fps render loop |
| 4 | useThreeSceneSetup | ⭐⭐ | Scene setup (stable) |
| 5 | MovementsIndicator, WebGLFallback | ⭐ | UI components |

### Key risks
- **Shared Three.js refs**: pass refs as parameters, never recreate in hooks
- **60fps render loop**: never include React dependencies in the render loop useEffect — use internal refs
- **GPU lifecycle**: each hook must dispose its Three.js objects in its cleanup
- **Hook coordination**: `useRenderLoop` depends on all refs → stable call order

---

## 4. runtime.rs (698 → ~150 lines)

### Proposed structure

```
rust-engines/src/
├── runtime.rs                  # Runtime facade + new() + stop() (~150 lines)
├── runtime/
│   ├── mod.rs                  # re-exports
│   ├── types.rs                # LoopMode, PlayDirection, PerfStats, PositionFn, PositionCallback
│   ├── macros.rs               # MacroState (lock-free atomics)
│   ├── overrides.rs            # OverrideManager (HashMap<usize, Vector3>)
│   ├── perf.rs                 # PerfMonitor (4x AtomicU64)
│   ├── config.rs               # RuntimeConfig (loop_mode, direction, fade, preview)
│   ├── sample.rs               # sample_trajectory()
│   ├── cue.rs                  # CueManager + crossfade
│   └── playback.rs             # PlaybackLoop + sub-functions
```

### Sub-functions to extract from `play_compiled()` (268 lines)

```rust
fn compute_virtual_time(t_real, speed, duration, loop_mode, direction) -> f64;
fn compute_fade_factor(t, fade_in, fade_out, duration, loop_is_on) -> f64;
fn apply_macros_to_position(pos, scale, rotation, shift, origin) -> Vector3<f64>;
fn send_osc_positions(socket, sender, positions, osc_ids, scale, rotation, origin, shift);
```

### Phased plan

| Phase | Modules | Risk | Description |
|-------|---------|--------|-------------|
| 1 | types.rs, macros.rs | ⭐ | Pure types, no dependencies |
| 2 | overrides.rs, perf.rs, config.rs | ⭐⭐ | Simple Arc/Mutex encapsulation |
| 3 | sample.rs, cue.rs, playback.rs | ⭐⭐⭐ | Complex playback logic |
| 4 | Split play_compiled() into sub-functions | ⭐⭐⭐ | Loop refactor |
| 5 | Per-module tests | ⭐ | Quality |

### Key risks
- **Thread safety**: 14 Arcs cloned at the start of `play_compiled()` → preserve lock ordering
- **Double origin lock**: lines 426 and 471 lock `origin_arc` twice per frame → optimize by storing `origin_local`
- **PositionFn hot-swap**: `recall_cue()` uses `std::mem::replace` → preserve in CueManager
- **Precise timing**: `spin_sleep` must not be affected by the refactor

---

## Cross-cutting recommendations

1. **Start with self-contained modules** (Phase 1 of each file) — minimal risk, validates the approach
2. **Test after each phase** — compile + Playwright tests after each extraction
3. **Document dependencies** between modules (dependency graph)
4. **Create a `settingsSlice`** frontend for `oscAddress`, `oscPort`, `oscProfile`
5. **Extract `prepareGraphForSave`** as a static utility (instead of dynamic import)
6. **Extract `create_position_callback`** as a shared Rust helper
7. **Take advantage of modification sessions** to extract at least one module each time
