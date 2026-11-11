# GUI refactor plan — based on the complete audit (7 lots)

> **Status: superseded by `gui-refonte-v2.md`** — kept for traceability
> between audit findings (F1–F16, S1–S14) and their fixes.

Each action references bugs **F1-F16** and structural items **S1-S14** from
`docs/gui-audit.md` + the line-by-line detail of the `gui-audit/lot-*.md`
annexes.

Principle: **functional before cosmetic** — a reskin on top of
mode-exit or recall bugs is worthless. The domain logic is sound; we touch
neither `moveSlotsSlice`/`useCuelistStore`/`liveActions` semantics nor the
backend (except F9: `osc-armed-changed` event).

---

## P0 — Live safety (functional bugs)

*Criterion: no destructive action without a consistent guard, no mode
without a visible exit, no contradictory state on screen.*

| # | Action | Files | Bugs |
|---|---|---|---|
| P0.1 | **3D overlays no longer cover ModeButtons**: render buttons and banners **after** the `inset-0` layers in Scene3D's JSX (or `z-raised` + `pointer-events-auto`) | `Scene3D.tsx`, `ModeButtons.tsx` | F1 |
| P0.2 | **Exclusive `setDrawMode`**: purge assign/zonePlace/zoneEdit like the slice's other setters | `interactionModesSlice.ts` (or `drawModeSlice.ts:38`), `ModeButtons.tsx:57` | F2 |
| P0.3 | **Visible draw exit**: `ModeButtons` no longer returns `null` in drawMode — shows "Exit Draw"; manipulate banner adds "Esc to cancel" | `ModeButtons.tsx:33,66-70` | F15 |
| P0.4 | **Trajectory cleanup**: move the `pathLinesRef` purge **before** the early-return | `TrajectoryVisualization.tsx:64` | F3 |
| P0.5 | **Unified dispatch**: `goToNextCue`/`goToPreviousCue`/`goToNextMove` absorb the guards into the stores (`cancelPendingTimers` + `isRecalling` check) **or** all buttons go through `liveActions` — one path, not two | `useCuelistStore.ts`, `moveSlotsSlice.ts`, `PerformView.tsx:111/648/661`, `CuelistPanel.tsx:120/131/193`, `liveActions.ts:87` (`doSlotStop` + `recallBusy`) | F4, F5 |
| P0.6 | **RECALL header arm-guard**: `◀`/`RECALL ▶` go through the unified dispatch (P0.5) — arm-first stays on rows, header buttons inherit the recall guard | `CuelistPanel.tsx:119-137` | F4 |
| P0.7 | **Single OSC armed state**: backend `osc-armed-changed` event emitted by `set_osc_armed` + `doArm`; `OscArmToggle`/`DryRunChip` listen to the event instead of reading at mount; **merge the two components** (DryRunChip = chip variant of the toggle) | `commands/osc.rs:239`, `OscArmToggle.tsx`, `CuelistPanel.tsx:382-393`, `useGraphStore` listener | F9, F16 |
| P0.8 | **One timer per action**: `macroDebounce` becomes 3 refs (pushMacros / updateGraphLive / saveSpline) | `Inspector.tsx:104,135-147,402-403` | F6 |
| P0.9 | **ARM in StatusBar**: permanent LIVE/DRY-RUN indicator (next to the dot); merge/lock µs block behind `debugPerfVisible` | `StatusBar.tsx:51-85` | F16 |

**P0 deliverable**: mode exit always possible, recall protected
everywhere, armed state visible and consistent everywhere. ~1 commit per
line.

---

## P1 — Role tokens + deployed primitives

*Criterion: zero ad hoc colors in the top-5 color files; the ui/
primitives are the only way to make a button/slider/empty.*

### P1.1 — Role tokens (`tailwind.config.js`)
```js
stagespace: {
  bg, panel, border,               // existing
  accent,                          // existing #3b82f6 = single primary (IconButton moves to blue, no more indigo)
  live:    '#22c55e',  // playing, GO, armed
  conduite:'#f59e0b',  // cues, NOW/NEXT, pending (amber)
  osc:     '#22d3ee',  // OSC in/out, console link (cyan)
  warning: '#f97316',  // shared tracks, hot-swap, orphan (orange)
  danger:  '#ef4444',  // panic, delete, errors (red)
  tracking:'#a855f7',  // tracking cues, expert, plugins (purple)
  dim:     '#6b7280',  // secondary
}
```
Migration by file, order = ad hoc color volume:
`PerformView` (81) → `MovesTable` (46) → `Inspector` (36) → `CustomNode` (31)
→ `SpatialFxPanel` (26) → rest. The Three.js hex values (`0x22d3ee`…) get
constants bound to the same values (`utils/showColors.ts`).

### P1.2 — Z-index: numeric purge
`z-10` (Scene3D:418,490), `z-50` (PerformView:539), `z-[60]` → tokens
`z-overlay`/`z-raised`/`z-popover`/`z-menu`. Rule already in the config.

### P1.3 — New shared components (`components/show/`)
| Component | Replaces | Sources |
|---|---|---|
| `ShowTransport` | duplicated GO/Prev/Next/Panic ×3 | PerformView topbar/conduite/busking + ConduitePage — **single GO semantics** (resolves GO≠GO of ConduitePage:86) |
| `PadButton` | `renderPad` + `renderSlotRow` actions | PerformView:486-… — **one slot render** shared with MovesTable |
| `StatusChip` | PARKED/CONSOLE/TC/ARM/DRY-RUN chips | PerformView + ConduitePage + StatusBar |
| `ModeBanner` | 4 top-center copies | ModeButtons:66 + Scene3D:380/387/394 |
| `Badge` | cues micro-badges `text-[9px]` | CuelistPanel:204-229 — floor at `text-[10px]` min |
| `ui/Section` | Inspector.Section + SpatialFxPanel.Section | two semantics → one |

### P1.4 — Existing primitives deployed
- `IconButton` → the ~40 ad hoc buttons (PerformView scope buttons, chips,
  slot actions, NodeEditor rail). `primary` variant = `accent` token
  (**removes the indigo second primary**).
- `EmptyState` → PerformView ×4 (465-585), NodeEditor (923-941),
  SettingsModal (276-278).
- `Slider`: type `ACCENTS` (`Record<Accent,string>`), `decimals` prop on
  truncated cases, `aria-label` required in `bare`.

---

## P2 — Convergences (domain duplications)

*Criterion: one action = one implementation = one vocabulary.*

| # | Action | Files | Refs |
|---|---|---|---|
| P2.1 | **Single `MacrosSurface`**: one component (`scope: 'global'|'slot'` prop, one `tracking` accent, unified ranges ±5 shift / ±180 rotation, Speed included wherever global); unified pacing **inside** `pushMacrosToRuntime` (100ms debounce, no longer in the component); **delete `MacroControls.tsx` + its test**; MacrosPanel keeps the "manipulate" part (clear overrides) and delegates the sliders | `Inspector`, `MacrosPanel`, `PerformView:828-934`, `macrosSlice` | S3 |
| P2.2 | **One slot render**: shared `PadButton`/`SlotRow`; PerformView `renderSlotRow` and MovesTable rows converge (same action set, parameterizable density `compact|pad`); identical `#oscIndex` badges | `MovesTable`, `PerformView:486` | S2 |
| P2.3 | **`showStatusSlice`**: `parked`/`consoleAge`/`armed` — one poll in the store, subscribed by PerformView, ConduitePage (via broadcast), StatusBar; `armed` event-driven (P0.7) | new slice, `PerformView:73`, `ConduitePage:39`, `StatusBar` | S10, F9 |
| P2.4 | **NodeEditor split**: `NodePalette` (611-838), `GraphCanvas` (841-997), `useActiveGraphStore()` (sub/global/signal dispatch — kills the triplication 209-251/316-324/474-657); edge-id includes handles; `onPaneDoubleClick` on ReactFlow (not wrapper); palette hover in classes | `NodeEditor.tsx` | S1, F11, F12 |
| P2.5 | **CustomNode sections**: `NodeParamField` (existing, reused — removes `renderNodeParamInput` Inspector and the 7 duplicated classes), `LinkedTracksSection`, `TrackRangeSection` (tested util for the parser), shared expanded/collapsed (one threshold), `nodrag` on inputs | `CustomNode.tsx`, `Inspector.tsx:150-211`, `nodeParamSchema.ts` | S2, lot-2 P2 |
| P2.6 | **TabPanel without re-key**: content mounted, `hidden` when inactive — local state preserved, no refreshMovements on switch; ARIA tablist | `TabPanel.tsx:41` | S4 |
| P2.7 | **Unified track color**: `trackColor(oscId)` in `utils/` used by TrackGrid, TrajectoryVisualization, Scene3D chips, HolMarkers | `TrackGrid:26`, `TrajectoryViz:109` | S9 |
| P2.8 | **TrackGrid IPC batching**: patterns applied in one grouped `updateAssignment` (local set + one `updateLiveAnimation`); depth slider throttled 33ms | `TrackGrid:53-102,196-203` | S7 |
| P2.9 | **Vocabulary**: one term for the graph ("preset" recommended — covers template/animation/library), "Shift" everywhere (removes "Offset X" from audio targets → `shiftX`), single `one_shot`, English everywhere or glossary — decision to be made | repo-wide | S12, S13 |
| P2.10 | **Shared utils**: `cueLabel`/`tcStr` (PerformView:96-109 = useConduiteBroadcast:11-38), `DRAWABLE_NODE_TYPES` (ModeButtons:22-31 = objectsNodeSync:15), `drawZ` axes doc | new `utils/showFormat.ts` | duplications |

---

## P3 — Modes and surfaces

*Criterion: two clear modes, stable vocabulary, live targets ≥44px.*

- **P3.1 Two modes**: `EDIT` (columns) / `LIVE` (PerformView). Rename the
  toggle ("Édition" ⇄ "Live", button shows the **destination**, not the
  state); Simple/Expert remains an EDIT sub-state, deambiguated label.
- **P3.2 Unified live overlays**: touch/busking/conduite = **one zoned
  surface** (transport / pads / conduite / collapsed details) instead of 3
  `absolute inset-0` — P1's PadButton/ShowTransport form its skeleton.
- **P3.3 Sizes**: PerformView and live surfaces: actions ≥44px, conduite
  info ≥`text-sm`/`base`, badges ≥10px (absolute floor: remove
  `text-[8px]`/`[9px]` in live).
- **P3.4 CuelistPanel freed**: fixed `h-56` → flexible (`min-h`/`flex-1`);
  in EDIT, Moves+Cues stack co-visible instead of exclusive tabs
  (completes P2.6).
- **P3.5 Zoned toolbar**: file (import/save/load) / project (OSC chip,
  undo) / live-safety (arm, panic) — Import `.hol` loses prominence once
  a project is loaded; errors displayed in a single place (StatusBar).
- **P3.6 AudioPanel**: remove the internal collapse (App's is enough);
  `h-15`→`h-14`; mini-RMS in the App header for persistent collapsed level.

---

## P4 — Fallbacks and hygiene

- **P4.1** ErrorBoundary around `?view=conduite` + "waiting for main
  window" fallback when `st===null`; `safeListen`/`safeEmit` instead of
  raw API; panic → shared `PanicButton`. *(F10)*
- **P4.2** `Modal`: initial focus = `[autofocus]` or first focusable in
  the **content** (never the X); `aria-labelledby`; Esc in Modal itself
  (guard if no hook). *(F7)*
- **P4.3** ConfirmModal everywhere: `deleteAnimation`, `removeZone/
  Modulation/Channel`, `clear all` ×3; toast-undo as light alternative. *(F8)*
- **P4.4** `h-15`→`h-14` (AudioPanel:211); `catch(()=>{})` → "backend
  absent" indicator; bounded `sceneReady` re-check; `JSON.parse`
  default_json try/catch; `getValidTargetTypes` no longer excludes self.
  *(F14 + latents)*
- **P4.5** Dead state: `isPlaying`, `status`, `compileError`, `playError`,
  `currentTime`, `duration`, dead `oscSlice` API, `[DBG-playSlot]` —
  purge or deliberate reactivation. *(F13)*
- **P4.6** Zone/mode state: `zonePlaceMode`/`zoneEditMode` reset on tab
  unmount; `soloSavedIds` → slice. *(S11)*

---

## Dependencies and order

```
P0 (functional)  ──┐
                   ├─→ P1 (tokens+primitives) ─→ P2 (convergences) ─→ P3 (modes) ─→ P4
P0.7 (armed event)─┘         ↑ requires P0.5 for ShowTransport
                             ↑ requires P0.7 for StatusChip armed
```

- **P1 without P0**: risk of reskinning broken interactions.
- **P2.4/P2.5 (editor split) independent** of the rest — can run in parallel.
- **Vocabulary (P2.9) to be decided before P3** (mode renaming).
- Each step = isolated commit + green tests (383 vitest + Rust suites).

## Identified risks

- **60fps hot path**: any change to `useRenderLoop`/`movementPositions`
  stays out-of-store and out-of-render (do not reintroduce re-renders).
- **Persisted state**: slice/flag renaming → localStorage migration
  (`ss-*`, `stagespace-*` keys).
- **Shallow tests to backfill**: QuickAddModal tautological assertion;
  add tests on the guards (P0.5) and exclusive `setDrawMode` (P0.2).
- **ConduitePage**: validate in a real Tauri window — the browser covers
  neither `listen` nor `emit`.

## Glossary (P2.9) — frozen naming conventions

- **Two modes only**: `PERFORM` (live surface) ↔ `Edit` (atelier).
  "Atelier"/"Workshop" are no longer used in the UI.
- **Edit sub-modes**: `Simple` (move form) / `Expert` (node graph).
  Buttons show the TARGET, color signals the current state — same
  convention as the PERFORM/Edit toggle.
- **`move`** = a playable slot (show object) · **`slot`** = its place
  in the workspace (oscIndex, OSC command number) ·
  **`template`/`animation`** = the content edited in the left panel ·
  **`setlist`** = the ordered sequence of moves played by GO.
- **`cue`** = the conduite object (scope + fade + pre_wait/follow/
  timecode) · **`recall`** = the action of applying it · **`armed`** =
  the cue selected awaiting the next fire.
- **`GO`** = advances the SETLIST (crossfade) — everywhere, including
  the detached conduite window · **`Prev/Next`** = cue recall.
- **`parked`** = object frozen out of recalls · **`dry-run`** = OSC
  disarmed.
