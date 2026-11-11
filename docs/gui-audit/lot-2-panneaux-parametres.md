# Lot 2 — Parameter panels (full audit)

Context: `App.tsx:233` — Inspector exists only in Atelier mode;
`Scene3D.tsx:378` — MacrosPanel overlays the 3D canvas;
`PerformView.tsx:940/984` — NodeParamsPanel + AudioModList in drawers.
**`MacroControls` is imported NOWHERE in production** — confirmed dead code.

## 1. `components/Inspector.tsx` (680 lines)

### Role
Main right-column panel (`App.tsx:485`). **3-sub-mode god-panel** driven
by `editingSlotId` (Global vs slot) and `showExpert` (Simple vs Expert).

### Structure
`Section` accordion (10-28), `Inspector` (34-579), `InspectorSplineLibrary`
(584-680). Mid-file imports (30-32) — unusual style.

### Hierarchy
```
Header (216-247): name + LIVE/PREVIEW badge
Scrollable zone (250-510):
  [Global]  Moves · Macros 9 sliders WITHOUT Speed · Audio
  [Expert]  Node params · Macros 10 sliders with Speed
  [Simple]  Params = NodeParamsPanel + SplineLibrary · Perform duration/dir/loop/fades · mixed Macros
  [Common]  Audio · Tracks = TrackGrid + Spread + centroid
Fixed footer (513-576): active movements + STOP + STOP ALL + PLAY/STOP + PANIC
```

### Interactions
`useMoveEditorStore` (current, updateCurrent, assignment, centroid,
launchFlash) + `useGraphStore` (~25 selectors). No direct IPC.

### Precise problems

| # | Problem | Lines |
|---|---|---|
| P1 | **`performMode` dead code** — read at 36, used at 413/464, but never mounted in perform (App:233). `defaultOpen` always true, re-key never fired | 36, 413, 464 |
| P2 | **`renderNodeParamInput` duplicates `NodeParamField` in inferior form**: no bounded Slider in Expert, blue vs cyan accent, **no Plugin schema** (97 → "no parameters") | 97, 150-211 |
| P3 | **Double-write macros**: `handleUnified` writes `current.*` AND global `macros` — the slot/global layers overwrite each other; in Global mode, dead writes into `current` | 109-140 |
| P4 | **`macroDebounce` shared between 3 actions**: pushMacros 100ms, updateGraphLive 150ms, save spline 150ms — a drag cancels a pending hot-swap → param never pushed | 104, 135-147, 402-403 |
| P5 | Simple Macros section mixes `current.*` and `macros.*` without distinction | 436-447 |
| P6 | Global: no Speed slider although `macros.speed` is global | 291-308 |
| P7 | Audio in Global mode edits `current.audio_mods` → dead write | 313-315 |
| P8 | Targets <44px everywhere: headers ~32px, toggle 20px, buttons ~22px, Square size=10 | passim |
| P9 | `text-xs` ~100% of the content | passim |
| P10 | Bilingualism: "Sélectionnez un node" FR + EN subtitle; "Aucun slot" FR vs "No track available" EN | 261, 345-348, 490 |
| P11 | `updateCurrent({name, id: current.id})` — sends the id back to itself | 222 |
| P12 | Divergent ranges: shift ±5 here vs ±3 MacroControls vs ±10 PerformView; pitch ±90 vs ±180 | 293-298, 367, 443 |

**Verdict: 3-mode god-panel with dead code, inferior duplicated params
renderer in Expert, slot/global macro semantics overwriting each other.
High priority — main editing surface.**

## 2. `components/NodeParamsPanel.tsx` (305 lines)

### Role
**Shared** params editor: Inspector Simple (:386) + Perform drawer
(:940). Documented "pin to Perform" pattern (9-22).

### Problems
- Chips `px-2 py-1` ≈24px; pin toggle `Pin size=10` without padding ≈10px; `Pin size=8` (131).
- `text-[11px]` (138).
- `col-span-2` vec3/text overflows if container <22rem (272, 290).
- `sameLabel` recomputed per chip O(n²) + nested `plugins.find` (110-116).
- `live` only changes text color — weak affordance.
- The "good" renderer version, **not used in Expert** (see Inspector P2).

**Verdict: clean documented shared component; tiny hit targets +
fragile vec3 in narrow grid. Medium priority.**

## 3. `components/MacroControls.tsx` (213 lines) — DEAD CODE

**Not mounted.** No production import (only
`__tests__/MacroControls.test.tsx`, 24 references) — ancestor superseded
by Inspector/PerformView/MacrosPanel.

- Dead code **with a complete test suite** → false coverage.
- `pushMacrosToRuntime()` on every input without throttle (22-25).
- `setLoopMode`/`setDirection` = global blast on all movements.
- Divergent ranges: shift ±3, pitch ±180.
- Local state `loopMode`/`direction` never resynced from the store.

**Verdict: dead component kept alive by its tests. Priority: deletion.**

## 4. `components/MacrosPanel.tsx` (87 lines)

3D canvas overlay if `manipulateMode` (`Scene3D:378`). Title
"Manipulate", 8 sliders, Clear All Overrides
(`clear_all_manual_positions`), Reset.

- **Name/content mismatch**: "Manipulate" but content = global macros —
  real manipulate is only in the help text.
- **3rd accent color**: default `blue` (Slider:49). Inspector=purple,
  PerformView=orange, here=blue.
- Divergent ranges: scale 0.1-4, shift ±5, speed 0-4; ±180 rotations.
- **8 sliders only**: `radius_scale`/`height_offset` absent vs Inspector (10).
- "Yaw°" + `unit="°"` — double unit.
- **3 pacing strategies** for `set_global_macro`: throttleTrailing 40ms here
  vs debounce 100ms Inspector/PerformView vs none MacroControls.

**Verdict: redundant 3rd macros surface, badly named, divergent
accents/ranges, incomplete macros. Medium — merge into a shared
`MacrosSurface` or restrict to 3D overrides.**

## 5. `components/AudioModControls.tsx` (128 lines)

`current` audio-mods editor: `AudioModAdder` + `AudioModList`. Mounted
3× (Inspector Global 314, common 456, Perform drawer 984).

- **`spectrum_band` unreachable**: supported type + existing "Band n"
  label, but the select only offers the 5 string sources — dead
  capability in UI.
- Vocabulary: "Offset X/Y/Z" (audio target) vs "Shift X/Y/Z" (sliders) —
  same data `offset_x`↔`shiftX`, two names.
- "Lissage" FR in the middle of EN; FR quotes in an EN sentence.
- Hardcoded `base_value: 0` — overwrites the base value without
  exposing it (66).
- `key={i}` index; delete ~11px; `smoothing` max 0.95 arbitrary.
- In Global mode: dead write (Inspector P7).

**Verdict: divergent vocabulary + spectrum_band source not creatable in
UI. Medium-low.**

## Functional overlaps

### A. Macros have 4 active surfaces + 1 dead

| Surface | Real scope | Accent | File |
|---|---|---|---|
| Inspector Simple "Macros" | mixed current+macros | purple | Inspector:436-447 |
| Inspector Expert "Macros" | global macros | purple | Inspector:353-376 |
| Inspector Global "Macros" | global macros (no Speed) | purple | Inspector:289-310 |
| MacrosPanel "Manipulate" | global macros (8 sliders) | blue | MacrosPanel:43 |
| PerformView "Global" | global macros | orange | PerformView:828-848 |
| PerformView "Playback" | slot.macros | green/purple | PerformView:852-934 |
| ~~MacroControls~~ | dead | purple | MacroControls |

→ **3 semantic layers** (global merge / per-slot / current draft)
under the same "Macros" label, contradictory accents.

### B. Params renderer duplication
`renderNodeParamInput` (Inspector 150-211) vs `NodeParamField` (207-303):
same contract, divergences (no Slider, accent, no Plugin, no pin).
→ Delete `renderNodeParamInput`, reuse `NodeParamsPanel` in Expert.

### C. Section
`Inspector.Section` (accordion) vs `SpatialFxPanel.Section`
(static+count/clear) — same name, different semantics → unified
`ui/Section.tsx`.

### D. Inconsistent vocabulary
Shift vs Offset; `one_shot` vs `oneshot`; "→ Fwd/← Bwd/↔ Ping" vs
"forward/backward/pingpong"; "Lissage" vs EN.

### E. Divergent `set_global_macro` IPC pacing
Debounce 100ms · throttleTrailing 40ms · none — to unify inside
`pushMacrosToRuntime`.
