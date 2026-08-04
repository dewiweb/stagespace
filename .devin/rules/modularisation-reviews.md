# Reviews de modularisation — 4 fichiers > 500 lignes

Date : août 2025

## Synthèse

| Fichier | Lignes | Modules proposés | Lignes finales estimées | Difficulté |
|---------|--------|-----------------|------------------------|------------|
| `tauri-app/src-tauri/src/lib.rs` | 2178 | 21 modules | ~100 | ⭐⭐⭐⭐ |
| `tauri-app/frontend/src/store/useGraphStore.ts` | 1146 | 17 modules | ~50 | ⭐⭐⭐⭐ |
| `tauri-app/frontend/src/components/Scene3D.tsx` | 972 | 10 modules | ~150-200 | ⭐⭐⭐ |
| `rust-engines/src/runtime.rs` | 698 | 8 modules | ~150 | ⭐⭐⭐ |

**Total : 4994 lignes → ~400 lignes** (réduction de 92%)

---

## 1. lib.rs (2178 → ~100 lignes)

### Structure proposée

```
src-tauri/src/
├── lib.rs                    # run() + registration (~100 lignes)
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

### Plan par phases

| Phase | Modules | Lignes déplacées | Risque | lib.rs après |
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

### Risques clés
- **AppState partagé** : tous les modules accèdent à `State<'_, AppState>` → documenter l'ordre des locks
- **Callbacks position** : 4 modules créent des callbacks → extraire un helper `create_position_callback`
- **Struct Movement** : contient Runtime + JoinHandle → déclarer `pub` dans `movements.rs`
- **Tests** : utilisent `build_graph_from_shape` → mettre à jour les imports

---

## 2. useGraphStore.ts (1146 → ~50 lignes)

### Structure proposée

```
frontend/src/store/
├── useGraphStore.ts          # combine tous les slices (~50 lignes)
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

### Plan par phases

| Phase | Modules | Risque | Description |
|-------|---------|--------|-------------|
| 1 | perfSlice, audioSlice, oscSlice, persistenceSlice | ⭐ | Modules autonomes |
| 2 | geometryUtils, types/index | ⭐ | Fonctions pures + types |
| 3 | macrosSlice, holProjectSlice, drawModeSlice | ⭐⭐ | Dépendances unidirectionnelles |
| 4 | movementSlice, cueSlice, setlistSlice | ⭐⭐⭐ | Dépendances croisées |
| 5 | playbackSlice, graphCoreSlice, panicSlice | ⭐⭐⭐⭐ | Core + orchestration |
| 6 | hooks/useTauriListeners | ⭐⭐ | Finalisation |

### Risques clés
- **Dépendance circulaire** : `graphCoreSlice.syncObjectsNode` → `playbackSlice.updateGraphLive` → `graphCoreSlice.nodes/edges` → utiliser pattern thunk avec `get()`
- **Paramètres OSC manquants** : `oscAddress`, `oscPort`, `oscProfile` ne sont pas dans le store → créer un `settingsSlice`
- **Imports dynamiques** : `prepareGraphForSave` importé dynamiquement à 8 endroits → extraire en utilitaire statique
- **Maps non-sérialisables** : `oscMappings`, `oscValues` sont des Maps → middleware de sérialisation

---

## 3. Scene3D.tsx (972 → ~150-200 lignes)

### Structure proposée

```
frontend/src/
├── components/
│   ├── Scene3D.tsx              # orchestration (~150-200 lignes)
│   ├── MovementsIndicator.tsx   # UI overlay movements
│   ├── WebGLFallback.tsx        # UI erreur WebGL
│   └── (déjà extraits: TrajectoryVisualization, ModeButtons, MacrosPanel, DrawModeOverlay)
├── hooks/
│   ├── useThreeSceneSetup.ts    # scène, caméra, renderer, lumières, controls, resize, cleanup
│   ├── useObjects3D.ts          # sphères + labels CSS2D
│   ├── useHolMarkers.ts         # anneaux holophonix + labels
│   ├── useManipulateHandle.ts   # octahedron handle + trajectory line
│   ├── useRenderLoop.ts         # boucle 60fps + sync refs
│   ├── useManipulateMode.ts     # handlers drag (down/move/up/wheel)
│   ├── useDrawMode.ts           # handlers draw + screenToWorld
│   └── useInteractionModes.ts   # toggle OrbitControls selon mode
```

### Plan par phases

| Phase | Modules | Risque | Description |
|-------|---------|--------|-------------|
| 1 | useHolMarkers, useObjects3D, useManipulateHandle, useInteractionModes | ⭐ | Hooks indépendants |
| 2 | useDrawMode, useManipulateMode | ⭐⭐ | Handlers interaction |
| 3 | useRenderLoop | ⭐⭐⭐ | Render loop critique 60fps |
| 4 | useThreeSceneSetup | ⭐⭐ | Setup scène (stable) |
| 5 | MovementsIndicator, WebGLFallback | ⭐ | Composants UI |

### Risques clés
- **Refs Three.js partagées** : passer les refs en paramètres, ne jamais recréer dans les hooks
- **Render loop 60fps** : ne jamais inclure de dépendances React dans le useEffect du render loop — utiliser des refs internes
- **Lifecycle GPU** : chaque hook doit disposer ses objets Three.js dans son cleanup
- **Coordination entre hooks** : `useRenderLoop` dépend de toutes les refs → ordre d'appel stable

---

## 4. runtime.rs (698 → ~150 lignes)

### Structure proposée

```
rust-engines/src/
├── runtime.rs                  # facade Runtime + new() + stop() (~150 lignes)
├── runtime/
│   ├── mod.rs                  # re-exports
│   ├── types.rs                # LoopMode, PlayDirection, PerfStats, PositionFn, PositionCallback
│   ├── macros.rs               # MacroState (atomics lock-free)
│   ├── overrides.rs            # OverrideManager (HashMap<usize, Vector3>)
│   ├── perf.rs                 # PerfMonitor (4x AtomicU64)
│   ├── config.rs               # RuntimeConfig (loop_mode, direction, fade, preview)
│   ├── sample.rs               # sample_trajectory()
│   ├── cue.rs                  # CueManager + crossfade
│   └── playback.rs             # PlaybackLoop + sous-fonctions
```

### Sous-fonctions à extraire de `play_compiled()` (268 lignes)

```rust
fn compute_virtual_time(t_real, speed, duration, loop_mode, direction) -> f64;
fn compute_fade_factor(t, fade_in, fade_out, duration, loop_is_on) -> f64;
fn apply_macros_to_position(pos, scale, rotation, shift, origin) -> Vector3<f64>;
fn send_osc_positions(socket, sender, positions, osc_ids, scale, rotation, origin, shift);
```

### Plan par phases

| Phase | Modules | Risque | Description |
|-------|---------|--------|-------------|
| 1 | types.rs, macros.rs | ⭐ | Types purs, aucune dépendance |
| 2 | overrides.rs, perf.rs, config.rs | ⭐⭐ | Encapsulation simple de Arc/Mutex |
| 3 | sample.rs, cue.rs, playback.rs | ⭐⭐⭐ | Logique de playback complexe |
| 4 | Découpage play_compiled() en sous-fonctions | ⭐⭐⭐ | Refactor boucle |
| 5 | Tests par module | ⭐ | Qualité |

### Risques clés
- **Thread safety** : 14 Arc clonés au début de `play_compiled()` → préserver l'ordre des locks
- **Double lock origin** : lignes 426 et 471 lockent `origin_arc` deux fois par frame → optimiser en stockant `origin_local`
- **Hot-swap PositionFn** : `recall_cue()` utilise `std::mem::replace` → préserver dans CueManager
- **Timing précis** : `spin_sleep` ne doit pas être affecté par le refactor

---

## Recommandations transversales

1. **Commencer par les modules autonomes** (Phase 1 de chaque fichier) — risque minimal, valide l'approche
2. **Tester après chaque phase** — compiler + tests Playwright après chaque extraction
3. **Documenter les dépendances** entre modules (graphe de dépendances)
4. **Créer un `settingsSlice`** frontend pour `oscAddress`, `oscPort`, `oscProfile`
5. **Extraire `prepareGraphForSave`** en utilitaire statique (au lieu d'import dynamique)
6. **Extraire `create_position_callback`** en helper Rust partagé
7. **Profiter des sessions de modification** pour extraire au moins un module à chaque fois
