# Lot 3 — Lists and cues (full audit)

Confirmed measure: `PerformView.tsx:459` column `w-72` = 288px; `:523`
`h-56` = 224px fixed → header ~30px + store-row ~34px → **~160px of
usable list ≈ 4 visible cues**. In Edit, the Moves/Cues/FX tabs are
mutually exclusive.

## 1. `components/MovesTable.tsx` (617 lines)

### Role + mounting
**Move slots** table (template + tracks + macros). `moves` tab
(defaultTab) of `TabPanel` (`App.tsx:186,272-286`). **Absent from
PerformView** — which reimplements `renderSlotRow` (~486): **two
divergent implementations**.

### Structure
- Header (162-175): "MV" badge w-6, `text-sm` title, `text-xs` counters.
- Toolbar (178-206): `+ Move`, `▶ GO All`, `■ Stop All` — `px-2 py-1
  text-xs` ≈26px.
- Setlist GO bar (209-243): position n/N, `GO ▶` button `text-sm
  font-bold` green — the dominant element.
- Table (257-486): 6 columns # / Name / Template / Tracks / Set / Actions.
- Modals: 6-grid track picker (491-537), 9-slider macros (540-595),
  delete ConfirmModal (598-614).

### Interactions
`useGraphStore` ~28 granular selectors (24-52, anti-60fps comment);
`#`/name click = `selectSlotForEditing`; name dbl-click = inline rename;
`useModalGuardOn` (127) blocks live shortcuts during rename;
`contestedBySlot` (74-95) `⚠ shared` warning on shared tracks.

### Precise problems
- **7 icon buttons in a w-20 cell** (420-479): preview, fade-stop,
  stop, play, edit, hot-swap, macros, delete — ~16px targets, fade-stop
  (438) vs stop (443) distinguished only by `fill` + color — cryptic live.
- Inconsistent glyphs: `▲` text vs `<ChevronDown size={11}>` vs `<X>` vs `<Star>`.
- All targets <44px except `GO ▶` (~36px).
- Bilingualism: "Changer de template"/"Descendre" FR vs "Add to the show
  setlist"/"Immediate stop" EN.
- Vocabulary: Move/slot/template/setlist vs Library/animations — the
  same graph = template, animation, preset, move.
- Delete → ConfirmModal ✓ but ✕ adjacent to the play buttons within
  80px — misclick risk.

**Verdict: functionally complete and defensive, but extreme density —
7 ~16px micro-actions per row, inconsistent glyphs, duplication with
PerformView rows = divergence bomb.**

## 2. `components/CuelistPanel.tsx` (466 lines)

### Role + mounting
**Cue** list (snapshot: graphs + macros + active moves + positions;
recall = kill-all + respawn). Two mounts: `App.tsx:187` (tab) +
`PerformView.tsx:523-524` (**confined h-56/w-72**, `w-96` touch).

### Structure
- Header (113-138): "Cues" + `TcStatus` (DryRunChip, chase toggle, TC
  readout, fps select — all `text-[10px]`, 423) + `◀` / counter /
  `RECALL ▶`.
- Store row (141-166): name input, fade `w-14`, `★ Store` purple.
- Rows (180-334): index, name + **`text-[9px]` micro-badges**: `TRK`
  (204), `w{s}` (207), `f{s}!` (209-224 red if orphan), `TC` (226),
  countdown (229). Armed row → form: fade `w-12`, mode select
  `text-[10px]` (271), **8 checkboxes `w-2.5 h-2.5` label `text-[8px]`**
  (452-462), pre_wait/follow/TC inputs `w-10`/`w-12`. Delete `<X
  size={11}>` (332).
- `PendingCountdown` (365), `DryRunChip` (381), `TcStatus` (396),
  `ScopeEditor` (446).

### Interactions
`useCuelistStore` + 3 graph stores for snapshot. Arm+dbl-click = recall;
`isRecalling` disables arrows; `updateCue` inputs **on every keystroke**
(249-289) — IPC spam. `DryRunChip` optimistic `armed=true` then fetch —
possible false "ARM" at mount.

### Precise problems
- **F4 — Protection asymmetry**: rows require arm+dbl-click, but header
  `◀`/`RECALL ▶` buttons call `goToPreviousCue`/`goToNextCue` →
  `recallCue` **in one ~20px click** (119-137). The arm-first rule isn't
  applied to header buttons.
- `text-[8px]` (ScopeEditor) — below the legibility threshold;
  `text-[9px]` ×5.
- Encrypted jargon badges without legend; subtle red orphan-follow `!` (222).
- Delete ✕ 11px adjacent to the recall zone — comment l.26-27 admits it.
- Delete cue → ConfirmModal ✓. Recall no confirm (design), protected by
  arm+dbl-click on rows but **not on header buttons**. Backend
  `RecallGuard` prevents concurrent recalls.

**Verdict: the show's most critical component (every action modifies or
kills the scene), the most confined (4 visible cues, exclusive in Edit)
and the densest in micro-type (8-10px); row dbl-click vs header
single-click inconsistency = live safety hole.**

## 3. `components/AnimationList.tsx` (240 lines)

### Role
**Preset** browser: built-in templates (`SHAPE_PRESETS`), current graph,
user localStorage library. `App.tsx:301` section 2 "Templates".

### Precise problems
- **`deleteAnimation`: no confirmation, no undo** — `filter` +
  immediate `saveAnimationsToStorage` (store:321-325); `opacity-0`
  hover-only button (222) → **the worst destructive of the 5 files**.
- **Load animation overwrites the slot's graph without confirmation**
  (single click, 191).
- **No `modalGuard` on rename** — live shortcuts active during rename
  (Space can stop a move while typing) — contrary to MovesTable.
- Label duplicate: App "Templates" + AnimationList "Templates" (94).
- `animIcon` hardcoded heuristic of 27 strings → frequent `◆` fallback (9-25).
- Text `▸`/`▾` chevrons vs lucide in App — inconsistent glyph set.
- `getSelectedOscIds` silent 8-object fallback (68).
- FR/EN footer hint in the same sentence (230-236).

**Verdict: clean preset browser but the weak destructive link — delete
without confirmation or undo on a hover-only button, overwriting load
without confirm.**

## 4. `components/TabPanel.tsx` (47 lines)

Generic tab container, `App.tsx:283`, Moves/Cues/FX tabs.

- **`key={activeTab}` forces a full remount** on every switch:
  `MovesTable` re-`refreshMovements()`, `armedCueId`/`editingTracksFor`
  and all local state **lost**; `TcStatus` recreates its interval (41).
- **Structural mutual exclusion**: Moves and Cues never visible
  together — a tool whose recall kills moves, prepared blindly.
- Zero ARIA: no `role="tablist"`, `aria-selected`, keyboard navigation.
- `defaultTab` non-reactive (15).

**Verdict: visually clean tab bar but state-destructive remount +
inability to co-view Moves/Cues — costly layout choice for live.**

## 5. `components/SpatialFxPanel.tsx` (583 lines)

### Role
Spatial FX editor: zones (sphere/box → per-region channels), kinematic
modulations, static channels, graph effects (read-only). `fx` tab.

### Structure
Class constants (17-21: `inputCls`/`selectCls` ≈30px, red-hover
`removeBtnCls`); generic `Section` + `clear all` (23-49); zones form 6
fields + `⌖ Place`/`⌖` re-place/`✎ Edit on scene` (227-388); modulations
(391-488); object channels (491-541); read-only graph effects (544-580).

### Precise problems
- **15+ `font-mono` text inputs** in 256px: typing `x,y,z` by hand =
  main mode; `⌖ Place` only covers the center; no slider/stepper.
- **`clear all` ×3 sections: no ConfirmModal** (227, 391, 494) — gray
  `text-xs` link wipes instantly live. Same for per-item `X` — zero
  guard, while moves/cues have ConfirmModals.
- **Red-hover `removeBtnCls` for `⌖` re-place** — a non-destructive
  action turning red: misleading affordance (378-381).
- **`zonePlaceMode`/`zoneEditMode` persist when the tab is unmounted** —
  invisible armed mode.
- Read-only graph-effects visually almost identical to editable (551 vs
  365).
- `pendingZonePoint`/`zonePlaceTarget`/`zoneEditMode` = Scene3D-coupled
  global state.

**Verdict: the longest and most form-dense — ~15 mono 30px inputs in
256px, destructive `clear all`/`X` without any confirmation (worst
coverage of the 5), placement state surviving unmount.**

## Lot 3 cross-cutting

| Aspect | MovesTable | CuelistPanel | AnimationList | SpatialFx |
|---|---|---|---|---|
| Row idiom | `<table>` cells | 2-line div | 1-line div | cards |
| Delete confirm | ✓ | ✓ | ✗ nothing | ✗ nothing (+clear all) |
| Smallest text | 11px | **8px** | 12px | 12px |
| Max actions/row | **7 ~16px icons** | 1 + form | 1 hover | 2 |

- Inconsistent vocabulary: Move/slot/template/setlist · cue/recall/arm ·
  animation/library · zone/modulation/channel.
- Sizes: all `text-xs`, 8-9px badges, 9-11px icons, no target ≥44px
  except `GO ▶`.
- Colors: indigo=moves, purple=cues, cyan=preview/FX, green=live,
  red=stop/delete, orange=hot-swap — semantic but ad hoc.
- FR/EN mixed everywhere.
- Duplication: MovesTable slots vs `renderSlotRow` PerformView (474-484).

## Recommendations
1. Unify destructive protection: ConfirmModal/undo for `deleteAnimation`,
   `removeZone/Modulation/Channel`, the 3 `clear all`.
2. CuelistPanel: arm-first on header buttons, get out of fixed `h-56`,
   Moves+Cues co-visibility in Edit.
3. Density: MovesTable actions in overflow menu or ≥24px, distinguish
   the 2 stops.
4. TabPanel: don't re-key (keep mounted with `hidden`) + ARIA.
5. Unified lucide glyph set, single vocabulary, single language, shared
   `ListRow`/`RowActions`/`Badge`, eliminate `text-[8px]`/`[9px]` live.
