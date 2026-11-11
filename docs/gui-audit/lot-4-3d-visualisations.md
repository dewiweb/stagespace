# Lot 4 — 3D and visualizations (full audit)

`tailwind.config.js:16-22` mandates z-index tokens (overlay:20,
raised:30, popover:50, menu:70, toast:9999) — `z-10` (Scene3D:418,490)
and `z-50` (PerformView:539) remain violations.

## 1. `components/Scene3D.tsx` (505 lines)

### Role + mounting
Central 3D preview. **Mounted 2×** (two WebGL contexts): `App.tsx:429`
(Edit, never unmounted — `hidden` in focus) and `PerformView.tsx:530`
(full frame).

### The 7 `absolute inset-0` overlays — exact inventory

| # | Layer | Lines | z | When |
|---|---|---|---|---|
| 0a | `renderer.domElement` WebGL | useRenderLoop:157-162 | `'1'` inline | always |
| 0b | `labelRenderer.domElement` CSS2D | useRenderLoop:166-171 | auto, pointerEvents:none | always |
| 1 | `<canvas>` 2D draw | 416-429 | ad hoc `z-10` | always mounted, events only drawMode |
| 2 | "No move running" empty state | 489-498 | `z-10`, pointer-events-none | asymmetric conditions |
| 3 | Zone-edit | 431-441 | `z-overlay` | zoneEditMode |
| 4 | Zone-place | 442-448 | `z-overlay` | zonePlaceMode |
| 5 | Assign | 449-455 | `z-overlay` | assignMode |
| 6 | Manipulate | 456-468 | `z-overlay` | manipulateMode |
| 7 | WebGL fallback | 356-376 | `z-raised` | webglFailed |

Layers 3-6 mutually exclusive via `interactionModesSlice:42-58` → max
one interactive layer. + non-fullscreen overlays: `top-2 left-1/2`
banners, ModeButtons `bottom-2 left-2`, MacrosPanel `top-2 left-2`,
DrawModeOverlay two corners, movements indicator `bottom-2 right-2`,
DebugPerfOverlay `top-2 left-2 z-raised`.

### Precise problems
- **F1 — ModeButtons covered**: rendered at line 400, `inset-0
  z-overlay` layers 431-468 — same z=20, later in the DOM → the layers
  intercept clicks on the visible bottom-left Manipulate/Assign
  buttons. In active mode, the buttons look clickable but are dead —
  only exit: Esc.
- **F2 — drawMode not exclusive on entry**: `setDrawMode` only purges
  drawMode; `ModeButtons:57` does `setDrawMode(true);
  setManipulateMode(false)` but not `setAssignMode(false)` nor zones →
  Draw + Assign active: the assign layer (z=20) covers the draw canvas
  (z=10) → **drawing impossible**.
- **Non-exclusive DebugPerfOverlay**: z=30 `top-2 left-2` covers
  MacrosPanel and DrawModeOverlay Z (all `top-2 left-2` z=20) → sliders
  unreachable.
- **Empty state: asymmetric conditions** (489) — hidden for
  manipulate/draw but NOT for assign/zonePlace/zoneEdit → coexists with
  a banner.
- Numeric `z-10` (418, 490) — off-token.
- `(window as any).__debugPerf` global at import (13).
- **Fragile `sceneReady`** (331-342): effect with dep `[sceneReady]`
  alone — if `sceneRef.current` is null after the single
  `setTimeout(0)`, no re-check → `useObjects3D` never creates the
  meshes. Works by accident.
- `nObjects` reads `getState()` in useMemo (83) — non-reactive.
- Hardcodes: 800×600 init (40), `Math.max(rect,100)` (288), 33ms
  throttle (254), resize steps 0.25/0.05 (274-275), color chips +
  emojis (476-482).

**Verdict: massive but well-refactored-into-hooks orchestrator; the 7
layers coexist through the slice's mutual exclusion — except
non-exclusive drawMode and genuinely covered ModeButtons (functional
bug).**

## 2. `components/TrackGrid.tsx` (254 lines)

### Role
Track selection/assignment grid + depth. `Inspector:466-486` (×2,
`manualOscIds` fallback with inline-rebuilt HSL colors —
`colorForIndex` duplication) and `PerformView:954-972` (compact).

### Precise problems
- **S7 — IPC burst per pattern** (53-102): `even/odd/half/all` do
  `deselectAllTracks()` then N×`toggleTrackSelection` + N×
  `updateAssignment` = N×`updateLiveAnimation` IPC in the same tick.
- **Unthrottled depth slider** (196-203) — IPC per drag tick.
- **`inverse` doesn't touch depths** (97-100) — inconsistent with the
  other patterns that force `depth:1.0`.
- **S9 — `colorForIndex` diverges**: HSL `i/total` array index (26-29)
  vs 3D `track_index/nObjs` — non-contiguous IDs → grid dot ≠ 3D line
  for the same track.
- Labels `'1 of 2'` vs `'Odd'`, `'1st half'`/`'2nd half'` (34-42); `Σ=`
  jargon (138).
- `grid-cols-4`/`max-h-40` vs `auto-fill`/`max-h-44` — two layouts
  (152-154).
- `compact` + depth = `col-span-2` — halved density without indication
  (166).

**Verdict: clean but costly utility — unbatched IPC bursts,
unthrottled depth, HSL color divergent from 3D for the same track.**

## 3. `components/ZoneVisualization.tsx` (162 lines)

Injects zone volumes (sphere/box + falloff) into the Three scene —
`Scene3D:415` (renders null on the DOM side).

- **S8 — Total rebuild on every change** (113-147): `zonesKey =
  JSON.stringify([zones, graphZones])` as dep → any edit (30Hz drag via
  `updateZone`, Scene3D:254) destroys and recreates all meshes.
  `eslint-disable exhaustive-deps` (146). `JSON.stringify` in the
  render body.
- Ad hoc hex colors `0x22d3ee`/`0x8b5cf6` (9-10) — off-theme.
- Manual axis permutation for box extents (76-79) — asymmetric with
  `toThree`.
- **Box vs sphere falloff inconsistent**: sphere `radius+falloff`, box
  `falloff*2` per dimension — same param, different semantics.
- Disabled zones rendered as ghosts (34-49) — no hide option.

**Verdict: effective visualization but rebuild-all on every delta
including during 30Hz drag — fine under 10 zones, costly and fragile
beyond.**

## 4. `components/TrajectoryVisualization.tsx` (159 lines)

Samples the runtime and draws `THREE.Line` paths — `Scene3D:407-413`.

- **F3 — Ghost lines**: `if (!(isPlaying || hasMovements) || …) return;`
  line 64 — **early-return without clearing `pathLinesRef`** → on
  stop-all, the last paths stay in the scene indefinitely. The return
  cleanup (136-142) only cancels the timer.
- `animKey` = `JSON.stringify(graph_json)` on every render (50-59).
- Color `track_index/max(nObjs,1)` (109-111) — diverges from TrackGrid.
- `duration` guessed from a "Duration" node, default 4.0 (85-86) —
  truncated sampling if the duration differs.
- Sequential invoke per movement — N round-trips (92-121).
- Silent catch (118-129) — not even `console.error`.
- Hardcoded opacities 0.2/0.35 — poorly legible on dark background.

**Verdict: clean sampling but a visible bug — trajectories are never
cleared when the last move stops.**

## 5. `components/DrawModeOverlay.tsx` (50 lines)

Draw mode UI: Z slider + Done/Cancel (`top-2 left-2`), label (`top-2
right-2`). `Scene3D:377` if drawMode.

- **Covered by DebugPerfOverlay** — same corner, z 20 vs 30.
- **Unprotected Done**: if `finalizeDrawing` throws, `setDrawMode(false)`
  never reached → user trapped (only exit: Esc) (30).
- `drawZ` range `-3..3` hardcoded, Three Y-up vs backend Z-up —
  implicit semantics (23).
- Ad hoc orange palette; 3D line `0xff8800`/`0xffaa00` — a 3rd hue.
- Two independent overlays, no managed collision.

**Verdict: small targeted overlay; fragilities: corner shared with 2
other panels, unprotected Done, incomplete entry mode (assign stays
active).**

## 6. `components/DebugPerfOverlay.tsx` (58 lines)

Dev HUD: render/IPC fps, stutter, timings. `Scene3D:500` if
`debugPerfVisible` (DEV-only). Reads the mutable `debugPerf` singleton,
forces re-render ~5Hz.

- **Corner collision**: `top-2 left-2` z=30 → MacrosPanel + Draw Z
  hidden and unclickable.
- Hardcoded non-configurable thresholds (25/15/10/15).
- **rAF runs even when `show===false`** — 5 renders/s for nothing.
- Mutable global read outside React (documented).

**Verdict: well-isolated dev tool; defect: squats the top-left corner
at the highest z.**

## Lot 4 synthesis

| Problem | Files |
|---|---|
| Layers cover ModeButtons | Scene3D:400 vs 431-468 |
| Non-exclusive drawMode | drawModeSlice:38, ModeButtons:57 |
| Ghost lines after stop-all | TrajectoryVisualization:64 |
| Top-left corner collision ×3 | MacrosPanel:43, DrawMode:20, DebugPerf:29 |
| Numeric z vs tokens | Scene3D:418,490; PerformView:539 |
| Divergent track color | TrackGrid:26 vs TrajectoryViz:109 |
| Unbatched IPC bursts | TrackGrid:53-102 |
| Rebuild-all stringify deps | ZoneVisualization:113-147 |
| Window globals | Scene3D:13, useRenderLoop:525 |

Recommendations: (1) hoist ModeButtons/banners after the interaction
layers or z-raised + clean pointer-events; (2) exclusive `setDrawMode`
setter; (3) lines cleanup before early-return; (4) unified track color
function; (5) batch TrackGrid patterns into one `updateLiveAnimation`.
