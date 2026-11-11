# Lot 5 — Store, IPC, wiring (full audit)

> **Audit annex** — snapshot; parent doc and status:
> `../gui-audit.md`.

## 1. Stores and slices map

### Root stores

| Store | Size | Role |
|---|---|---|
| `useGraphStore` | 719 l. | **Megastore**: 14 slices + React Flow graph, undo/redo, panic, `updateGraphLive`, 5 Tauri listener hooks (519-718) |
| `useMoveEditorStore` | 488 l. | `animations[]` library, `current` projection (write-through), UI flags, legacy `launchAnimation` |
| `useCuelistStore` | 267 l. | Cues (frontend-owned), `isRecalling`, pre_wait/follow timers, TC chase, OSC feedback |
| `useGlobalGraphStore` | 191 l. | Global post-process graph, persisted |
| `useSignalGraphStore` | 216 l. | Modulation graph (`'global'` or slotId) |
| `useToastStore` | 65 l. | Deduplicated toasts, capped sticky |

### `useGraphStore` slices

| Slice | Size | Responsibility | Notes |
|---|---|---|---|
| `perfSlice` | 17 | `get_perf_stats` mirror | runtime → display |
| `audioSlice` | 66 | Audio capture + persisted device | backend bridge |
| `oscSlice` | 172 | Mappings CRUD + parsers | **`oscValues`/`setOscValues`/`getOscValue`/`setOscInEnabled`/`suppressOscIn` = dead API** |
| `persistenceSlice` | 555 | `.hfg` v2 save/load | file GUI |
| `macrosSlice` | 104 | Global macros → `set_global_macro` | runtime |
| `holProjectSlice` | 206 | `.hol` import, tracks, `manualOscIds` | show data |
| `drawModeSlice` | 171 | Free drawing → DrawSpline | edit GUI |
| `movementSlice` | 219 | Moves mirror, out-of-store mutable `movementPositions` 60fps | runtime |
| `moveSlotsSlice` | **1065** | **Show core**: slots, setlist, GO, optimistic play/stop, hot-swap | show domain |
| `oscConfigSlice` | 137 | Persisted OSC config, playback lock | config |
| `splineLibrarySlice` | 59 | Spline library | GUI |
| `spatialFxSlice` | 255 | Zones/modulations/channels | backend bridge |
| `interactionModesSlice` | 65 | Exclusive 3D modes | GUI |
| `pluginSlice` | 99 | WASM plugin registry | backend bridge |
| `objectsNodeSync` | 64 | Shared node sync helper | internal |

## 2. liveActions flow — complete chain

```
Keyboard (useLiveShortcuts:87-113)
   Enter → doGo() / Shift+Enter → doCueNext() / Backspace → doCuePrev()
   Esc → panic() / Space → playSlot|stopSlot / ? → shortcutsOpen

OSC /stagespace/* (backend → 'show-control' event)
   useShowControl:21 → ShowCommand → doGo/doCueNext/doCueRecall/doSlot/
   doSlotStop/doSolo/doUnsolo/doArm/doStatus/doPark/doUnpark/doPanic/
   doStop/handleTimecode → NACK via send_show_nack

Conduite window (ConduitePage → emit 'conduite:cmd')
   useConduiteBroadcast:42-54 → doCueNext/doCuePrev/doPanic

liveActions.ts (common dispatch)
   → cancelPendingTimers() + recallBusy() [isRecalling → NACK]
   → useCuelistStore: recallCue/goToNextCue/goToPreviousCue/sendStatusNow
   → useGraphStore: goToNextMove/playSlot/stopSlotWithFade/stopAllMovements/panic
   → IPC: set_osc_armed, park_object, unpark_object
```

**The flow is well factored** — keyboard, OSC, conduite converge on the
same `doX`. Two holes in the net (§5).

## 3. Persistence (localStorage)

| Key | State |
|---|---|
| `stagespace-animations` (v2) | `Move[]` library |
| `stagespace-move-slots` | `moveSlots` + `movementId` (stale cleaned by `syncSlotMovements`) |
| `stagespace-move-setlist` | `setlistOrder` |
| `stagespace-cuelist` + `-tc-chase` | `cues`, `tcChaseEnabled` |
| `stagespace-osc-config` | osc + timecodeFps |
| `stagespace-global-graph-v4` | global graph |
| `stagespace-signal-graph-v1` | signal graph **global context only** (per-slot → `slot.signalGraph`) |
| `stagespace-spline-library` | splines |
| `stagespace-audio-device` | deviceId |
| `stagespace_graph_<name>` | legacy named graphs |
| `stagespace-welcomed`, `portLegend.collapsed`, `ss-layout-*` (8 keys) | flags/layout |

**Not persisted**: `editingSlotId`, `pendingPlays`, `movements`,
`perfStats`, `audioState`, `macros` (outside .hfg),
`performMode`/`showExpert`, interaction modes, `parked`/`armed`
(backend-only), `soloSavedIds` (module-level).

## 4. Active polling & listeners — complete inventory

### setInterval / poll loops
| Where | Interval | What |
|---|---|---|
| `useLiveShortcuts:162` (usePerfStatsPolling) | 500ms if `movements>0` | `get_perf_stats` + toasts |
| `useConduiteBroadcast:16` | 500ms | `emit('conduite:state')` |
| `PerformView:73` | 1500ms | `get_parked_objects` + `get_last_show_cmd_age` |
| `ConduitePage:39` | 1500ms | same + `get_osc_armed` |
| `PerformView:1012` (OscMappingsPanel) | 500ms | `osc_get_all_values` (**bypasses the slice**) |
| `CuelistPanel:368` | 200ms | countdown tick |
| `CuelistPanel:405` | 500ms | TC lost tick |
| `oscLearn:18` | 120ms × 10s | `get_last_osc_message` |

### Debounces/throttles
`update_animation_state` 33ms; `set_move_speed` 33ms keyed; slot
auto-save 400ms; hot-swap 200ms; `set_osc_output`/`set_global_osc_ids`
300ms; localStorage slots 250ms; macros debounce 100ms **at component
level** (Inspector:135, LiveDrawer:709); `markFading` fade+1500ms.

### Tauri listeners (mounted `App.tsx:72-90`, survive Perform mode)
`audio-error`/`audio-recovered` (524), `audio-state-update` (551),
`cue-recalled` (566), `move-stale-killed`/`merge-restarted`/
`merge-restart-failed` (588), `active-moves-update` → `refreshMovements` +
`syncSlotMovements` (620), `global-positions` → `setMovementPositions` (688),
`show-control` (useShowControl:21), `conduite:cmd`/`conduite:state`.

## 5. Precise problems

### Dead state in `useGraphStore`
`isPlaying` (310) **never `true` in prod** — read by Scene3D:44,
MacroControls:11, useManipulateMode:40, all compensated by `|| movements>0`.
Same for `status`, `compileError`/`playError` (never set — the
Toolbar:166 error strip and StatusBar:89 = **dead code**),
`currentTime`/`duration`. Residue of the pre-multi-moves pipeline.

### F5 — Inconsistent dispatch: liveActions bypassed by the UI
- `PerformView:648,661`: conduite Prev/Next call `goToPreviousCue()`/
  `goToNextCue()` **directly** → no `cancelPendingTimers()`, no
  `recallBusy` guard → a pending timer can fire **during** a recall.
- `PerformView:111` (`handleGO`): direct `goToNextMove()` → no guard →
  GO can interleave stop/play with an in-flight `recall_cue`.
- `CuelistPanel:120,131,193`: same bypass (buttons + dbl-click).
- `liveActions:87`: `doSlotStop` **without** `recallBusy` → a stop can
  kill a move the recall just respawned.

### State duplications
- **`parked`/`consoleAge`/`armed`**: duplicated PerformView↔ConduitePage
  poll; `OscArmToggle` (12-14) and `DryRunChip` (383) only read
  `get_osc_armed` **at mount** → stale as soon as `/stagespace/arm` is
  called elsewhere; no backend invalidation event.
- **`current` vs slot**: documented intentional duplication; but
  `Inspector:122-137` maintains TWO manual `SIMPLE_TO_MACRO`/
  `MACRO_TO_SIMPLE` mappings and writes into `updateCurrent` AND
  `setMacros`.
- `activeMovementIds`: copy of `movements` via subscribe (482-487) —
  duplicated inherited from the legacy path.
- **Duplicated TC/cueLabel formatting**: `useConduiteBroadcast:11-38`
  copies `PerformView:96-109` verbatim.
- `osc_get_all_values`: `OscMappingsPanel` invokes the IPC directly
  instead of the slice's `getAllOscValues` — `oscValues` never fed.

### Misc
`soloSavedIds` non-reactive module-level (liveActions:102); `[DBG-playSlot]`
debug `feLog` in prod (moveSlotsSlice:616-804); circular dependencies
managed by dynamic imports everywhere — fragile.

## 6. Domain/rendering separation

Show logic lives **in the stores + liveActions**: recall/GO/fades/TC
semantics → cuelist+moveSlots+liveActions; optimistic UI +
reconciliation → `playSlot`/`syncSlotMovements`; config-lock →
oscConfigSlice. Components = granular selectors + rendering (good,
commented discipline).

Exceptions: `OscMappingsPanel` direct IPC, `ParkedChip`,
`handleAssignDown` (acceptable), `useMovementPositionsListener` which
**also pushes the OSC config** (misnamed).

## Verdict

**Yes — the wiring supports a design refactor without a domain
rewrite.** Show core = `moveSlotsSlice` + `useCuelistStore` +
`liveActions`; PerformView/ConduitePage reskin = same `doX` + selectors.

To harden: (1) all UI buttons through `liveActions` or absorb the
guards into `goToNextCue`/`recallCue`; (2) `showStatusSlice` for
`parked`/`consoleAge`/`armed` — one shared poll or event-driven; (3)
clean dead state; (4) share `cueLabel`/`tcStr`; (5) document/resolve
the cyclic imports.
