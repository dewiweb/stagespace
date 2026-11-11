# Global GUI audit — structure, hierarchy, elements

> **Status: audit snapshot** — findings reference the code at audit time;
> fixed items aren't re-marked here. See `gui-refonte-v2.md` for the
> current direction.

Complete app mapping first, then findings by level.

## App map (App.tsx)

```
App (default: performMode = TRUE → the app starts in live)
├── performMode → <PerformView/> (live surface, ~1000 lines)
└── edit → 3 columns + chrome
    ├── Toolbar (h-9, top) — mode buttons + global actions
    ├── Left column (collapsible, resize w-1.5 drag)
    │   ├── TabPanel "moves": Moves / Cues / FX   ← priority flex-1
    │   └── AnimationList (templates)             ← secondary
    ├── Center
    │   ├── showExpert → NodeEditor + splitter + Scene3D (split ratio persisted)
    │   └── !showExpert → Scene3D alone ("Simple" mode)
    ├── Right column (collapsible)
    │   ├── AudioPanel (collapsible max-h-40%)
    │   ├── Inspector (flex-1, main tool)
    │   └── collapse strip `w-7`
    ├── StatusBar (bottom, engine monitoring — all views)
    └── focusActive (expert+focus) → side columns hidden
```

**3 nested mode levels**: `performMode` (edit↔perform), `showExpert`
(simple↔expert within edit), `editorFocus` (focus within expert) — plus
PerformView's 4 internal overlays (touch/busking/conduite/⧉). **7 modes**
for 2 real uses (edit, operate).

## Findings by level

### 1. Modes — app-level proliferation
- The `performMode` toggle button is `text-xs` in the toolbar — the
  product's fundamental mode change has no visual weight.
- Simple/Expert (2nd button) and Focus (hidden 3rd state): three stacked
  edit states with no visual cue of "where am I" — a lost user doesn't
  know how they got there.
- `performMode` defaults to `true`: editing is the secondary mode, not
  the reference mode — consistent for live but confusing for a newcomer.

### 2. Edit columns — heterogeneous density
- Left: `TabPanel` Moves/Cues/FX + AnimationList share the column —
  two competing sections without a strong separator.
- Right: AudioPanel collapsible `max-h-40%` + Inspector `flex-1` — the
  main tool (Inspector) shares space with secondary monitoring.
- Resize handles `w-1.5` (6px): the splitter grab zone is
  almost invisible — drag target < 10px.

### 3. PerformView (see element detail below)
- Topbar: 10 items at the same level, GO=big vs cue=text-xs.
- 4 stacked `absolute inset-0 z-50` overlays, transport duplicated 3×.

### 4. Visual system — foundation present, bypassed
- Tokens `stagespace.{bg,panel,border,accent}` + named `zIndex` — laid.
- But: single `accent` vs 8 ad hoc colors (indigo/green/amber/purple/
  cyan/orange/emerald/red); hardcoded `z-50`/`z-[60]` overlays;
  `bg='#0b0d12'` hardcoded in ConduitePage.
- Sizes: live actions at 24-40px (44px touch threshold), live text `text-xs`.
- No visual fallback: blank page outside Tauri, silent errors.

## Element detail — PerformView

| Zone | Render | Precise problem |
|---|---|---|
| LIVE dot | `w-4 h-4` + `text-lg` count | vital state = dot + number without frame |
| `Setlist n/N` | `text-xs gray-400` | secondary at the same level as GO |
| `Cue n→n+1` | `text-xs amber-300` | **the conduite object without visual weight** |
| RECALLING | `text-xs pulse` | illegible blocking state |
| PLAY/GO | `px-6 py-1.5 text-lg` indigo/green | correct — the only ones with weight |
| Mode chips (6) | `text-xs` | heterogeneous, aligned without grouping |
| PARKED/CONSOLE/TC | `text-xs` chips | health scattered in the middle of transport |
| Slot rows | `py-2.5`, buttons `w-9 h-9` (36px), solo `w-6 h-6` (24px) | under 44px |
| Pads | `min-h-[88px]`/150px | good, but different vocabulary than rows |
| LiveDrawer scopes | `px-4 py-2 text-xs` | live tooling presented as a filter |
| CuelistPanel | `h-56` bottom of `w-72` column, `text-[10px]` badges | the show's central object confined to ~230px |

## Global problems (cause → manifestation)

1. **No role hierarchy** — color = action, never = priority
   (primary/watch/dim don't exist).
2. **No show component** — each surface rewrites its classes
   (5 renders of the same transport).
3. **Stacked modes** — 7 states for 2 uses; modes substitute
   rather than structure.
4. **Undersized elements** — live actions <44px, live text `text-xs`.
5. **No error path** — blank, silent, or nothing.

## Proposed refactor order

P0 — **Role tokens** (`live`/`conduite`/`armed`/`osc`/`warning`/`panic` +
`surface`/`dim`/`hi`) → fold the 8 ad hoc into ~9 tokens.
P1 — **Show components** (`ShowTransport`, `PadButton`, `StatusChip`,
`ModeHeader`) → one GO, one panic, one semantics.
P2 — **Two clear modes**: EDIT (columns) / LIVE (single surface
unifying touch/busking/conduite) — PerformView's internal modes
disappear.
P3 — **Base sizes**: live actions ≥44px, conduite info ≥text-base.
P4 — **Visible fallbacks**: explicit error, no blank page.

## Quantitative census (32 components + 7 ui/)

| Metric | Measure | Reading |
|---|---|---|
| Total lines | ~9,100 | PerformView 1184 + NodeEditor 1063 + Inspector 680 + CustomNode 618 + MovesTable 617 + SpatialFxPanel 583 + Scene3D 505 + CuelistPanel 466 |
| `text-xs` | **403 occurrences** | 80% of text is 12px — no effective typographic hierarchy |
| `text-lg`/`xl`/2xl+ | ~45 | large bodies are rare and localized (overlays) |
| `text-[10px]`/`[11px]` | 21 | repeated sub-12px — illegible |
| Ad hoc colors | **~250 usages**, 15+ hues | red-400×33, cyan-400×27/300×21/500×20/900×16, purple×37, orange×26, indigo×24 — not one role token |
| Hardcoded `z-N` | z-10×4, z-50×2, z-[60]×1 | the named zIndex scale exists and isn't used everywhere |
| Targets <44px | w-6 h-6×6, w-4 h-4×6, w-9 h-5×3, w-5 h-5×2, w-8/w-9×2 | ~20 buttons under the touch threshold |

**Quantitative reading**: the problem isn't a few badly chosen
colors — it's ~400 texts at 12px, ~250 off-token colors, ~20 targets
under 44px, spread across 32 files. The refactor is a deep
normalization, not a touch-up.

## Annex — all GUI files (real per-file data)

| File | Lines | text-xs | ad hoc colors | small targets | overlays |
|---|---|---|---|---|---|
| PerformView.tsx | 1184 | 42 | 81 | 6 | 2 |
| NodeEditor.tsx | 1063 | 35 | 19 | 3 | 1 |
| Inspector.tsx | 680 | 49 | 36 | 3 | 0 |
| CustomNode.tsx | 618 | 31 | 31 | 2 | 0 |
| MovesTable.tsx | 617 | 41 | 46 | 2 | 0 |
| SpatialFxPanel.tsx | 583 | 30 | 26 | 1 | 0 |
| Scene3D.tsx | 505 | 9 | 7 | 0 | **7** |
| CuelistPanel.tsx | 466 | 12 | 25 | 0 | 0 |
| NodeParamsPanel.tsx | 305 | 14 | 11 | 2 | 0 |
| SettingsModal.tsx | 294 | 27 | 6 | 0 | 0 |
| TrackGrid.tsx | 254 | 7 | 2 | 0 | 1 |
| AnimationList.tsx | 240 | 16 | 13 | 0 | 0 |
| AudioPanel.tsx | 214 | 14 | 9 | 0 | 0 |
| MacroControls.tsx | 213 | 10 | 5 | 0 | 0 |
| Toolbar.tsx | 176 | 6 | 3 | 0 | 0 |
| ZoneVisualization.tsx | 162 | 0 | 0 | 0 | 0 |
| TrajectoryVisualization.tsx | 159 | 0 | 0 | 0 | 0 |
| QuickAddModal.tsx | 138 | 4 | 4 | 0 | 0 |
| AudioModControls.tsx | 128 | 10 | 8 | 0 | 0 |
| StatusBar.tsx | 113 | 1 | 12 | 0 | 0 |
| ui/Slider.tsx | 109 | 4 | 4 | 0 | 0 |
| pages/ConduitePage.tsx | 94 | 0 | 10 | 0 | 0 |
| ui/Modal.tsx | 94 | 0 | 0 | 0 | 1 |
| MacrosPanel.tsx | 87 | 5 | 2 | 0 | 0 |
| WelcomeModal.tsx | 86 | 6 | 1 | 0 | 0 |
| ModeButtons.tsx | 74 | 4 | 0 | 0 | 0 |
| DebugPerfOverlay.tsx | 58 | 2 | 6 | 0 | 0 |
| ui/PanicButton.tsx | 54 | 1 | 4 | 0 | 1 |
| ui/EmptyState.tsx | 52 | 2 | 4 | 0 | 0 |
| ToastContainer.tsx | 51 | 2 | 4 | 0 | 0 |
| DrawModeOverlay.tsx | 50 | 5 | 6 | 0 | 0 |
| ErrorBoundary.tsx | 48 | 2 | 1 | 0 | 0 |
| TabPanel.tsx | 47 | 1 | 0 | 0 | 0 |
| ShortcutsModal.tsx | 46 | 3 | 0 | 0 | 0 |
| ui/IconButton.tsx | 46 | 4 | 14 | 0 | 0 |
| ui/ConfirmModal.tsx | 43 | 3 | 2 | 0 | 0 |
| ui/OscArmToggle.tsx | 41 | 1 | 5 | 0 | 0 |
| (+ tests, excluded) | — | — | — | — | — |

**Problem weight per file** (lines × text-xs × colors):
PerformView (1184/42/81), NodeEditor (1063/35/19), Inspector (680/49/36),
MovesTable (617/41/46), CustomNode (618/31/31), SpatialFxPanel (583/30/26),
CuelistPanel (466/12/25) — **60% of ad hoc colors concentrate in
5 files**; Scene3D stacks 7 `absolute inset-0` overlays.

## Annexes — detailed per-lot reports (all 7 agents)

| Lot | File | Scope |
|---|---|---|
| 1 | [lot-1-editeur-graphe.md](gui-audit/lot-1-editeur-graphe.md) | NodeEditor, CustomNode, nodeParamSchema |
| 2 | [lot-2-panneaux-parametres.md](gui-audit/lot-2-panneaux-parametres.md) | Inspector, NodeParamsPanel, MacroControls, MacrosPanel, AudioModControls |
| 3 | [lot-3-listes-cues.md](gui-audit/lot-3-listes-cues.md) | MovesTable, CuelistPanel, AnimationList, TabPanel, SpatialFxPanel |
| 4 | [lot-4-3d-visualisations.md](gui-audit/lot-4-3d-visualisations.md) | Scene3D (7 overlays), TrackGrid, Zone/Trajectory, Draw/Debug |
| 5 | [lot-5-store-cablage.md](gui-audit/lot-5-store-cablage.md) | 6 stores, 14 slices, liveActions, persistence, polling |
| 6 | [lot-6-modals-primitives.md](gui-audit/lot-6-modals-primitives.md) | 4 modals, 7 ui/ primitives, ConduitePage, ErrorBoundary |
| 7 | [lot-7-chrome.md](gui-audit/lot-7-chrome.md) | Toolbar, StatusBar, AudioPanel, ModeButtons |

## Detailed per-file audit — synthesis of the 7 lots

### Functional bugs (fix before any reskin)

| # | Bug | File:line |
|---|---|---|
| F1 | **ModeButtons covered** by the `inset-0` layers — in manipulate/assign mode, impossible to exit by click (Esc only) | Scene3D:400 vs 431-468 |
| F2 | **drawMode not exclusive** — assign/zone stay active → drawing impossible | drawModeSlice:38, ModeButtons:57 |
| F3 | **Ghost lines** — trajectories never cleared after stop-all (early-return before cleanup) | TrajectoryVisualization:64 |
| F4 | **RECALL ▶ header in one click** — arm-first bypassed (recall kills the scene) | CuelistPanel:119-137 |
| F5 | **UI bypasses liveActions** — Prev/Next/GO without `isRecalling` guard, pending timer can fire during recall | PerformView:111/648/661, CuelistPanel:120/131/193, doSlotStop without guard |
| F6 | **shared macroDebounce** — a macro drag cancels a pending graph hot-swap | Inspector:104/135-147/402-403 |
| F7 | **Modal focus = X** — `focusables[0]` = X button, steals QuickAddModal's autofocus | ui/Modal:42 |
| F8 | **Delete without confirmation**: `deleteAnimation` (hover-only), `clear all` ×3 SpatialFx, removeZone/Modulation/Channel — inconsistent with ConfirmModal elsewhere | AnimationList:222, SpatialFxPanel:227/391/494 |
| F9 | **OscArmToggle desynchronized** — 3 write sources, competing DryRunChip with inverted semantics, no event | OscArmToggle:13, CuelistPanel:382-393, osc.rs:239 |
| F10 | **ConduitePage off-guardrails**: raw listen/emit, no ErrorBoundary, panic outside PanicButton, GO ≠ GO (cue vs setlist) | ConduitePage:7/44/88 |
| F11 | **edge-id without handles** — dup id if 2 edges between same nodes | NodeEditor:227/244 |
| F12 | **MiniMap double-click opens QuickAdd** — onDoubleClick on wrapper | NodeEditor:469 |
| F13 | **Dead prod state**: isPlaying/status/compileError/playError/currentTime never set; Toolbar/StatusBar error strips = dead code | useGraphStore:310 |

### Structural problems (refactor)

| # | Problem | Scale |
|---|---|---|
| S1 | **Unfactored sub/global/signal triplication** | NodeEditor (~45 lines ×3) |
| S2 | **Slot duplication**: MovesTable vs PerformView renderSlotRow | 2 divergent implementations |
| S3 | **Macros = 4 surfaces + 1 dead**: purple/blue/orange, 3 scopes, ranges ±3/±5/±10 | Inspector×3, MacrosPanel, PerformView, MacroControls (dead) |
| S4 | **TabPanel re-key** → full remount, lost state, Moves/Cues never co-visible | TabPanel:41 |
| S5 | **Underexploited IconButton**: 22 ad hoc classes, 0 tokens, 1 consumer | ui/IconButton |
| S6 | **Confined CuelistPanel** h-56/w-72, text-[8px]-[10px] | PerformView:523 |
| S7 | **TrackGrid IPC bursts**: patterns = N×updateLiveAnimation unbatched | TrackGrid:53-102 |
| S8 | **ZoneVisualization rebuild-all** via JSON.stringify deps during 30Hz drag | ZoneVisualization:113-147 |
| S9 | **Divergent track color**: TrackGrid (array index) vs 3D (track_index) | TrackGrid:26 vs TrajectoryViz:109 |
| S10 | **Duplicated polling**: parked/armed/consoleAge ×2 surfaces; needs `showStatusSlice` | PerformView:73 vs ConduitePage:39 |
| S11 | **Interactive state survives unmount**: zonePlaceMode/EditMode persist | interactionModesSlice |
| S12 | **Inconsistent vocabulary**: Move/slot/template/animation/preset; Shift vs Offset; loop/oneshot; FR/EN | repo-wide |

### Priority by file (agent verdicts)

**High**: PerformView (1184l — transport/pads duplication, tokens), NodeEditor (1063 — triplication + F11/F12 bugs), CustomNode (618 — dup input×7, 16/12 thresholds), Inspector (680 — 3-mode god-panel, dead performMode code, double-write macros), CuelistPanel (466 — confinement + F4), Scene3D (505 — F1/F2/F3 overlays).

**Medium**: MovesTable (617 — 7 micro-actions/row), SpatialFxPanel (583 — F8 + 15 mono inputs), NodeParamsPanel (305 — hit targets), MacrosPanel (87 — badly named 3rd macros surface), TrackGrid (254 — S7/S9), ConduitePage (94 — F10).

**Deletion**: MacroControls (213 — dead code + 24 shallow tests).

**Good health**: nodeParamSchema (only semi-typed), ui/Modal·ConfirmModal·Slider·EmptyState·PanicButton·ToastContainer (OK primitives, underdeployed), ErrorBoundary (zones OK, missing conduite), liveActions (well factored, bypassed by F5).

### Global verdict

The wiring supports the refactor without a domain rewrite: show logic =
moveSlotsSlice+useCuelistStore+liveActions (well factored). **13
functional bugs** to fix first (F1-F4 = live safety), then **12
structural problems** of duplication/convergence. The design system
exists (tokens + primitives) but isn't deployed — this is
normalization, not creation.

## Lot 7 — chrome (Toolbar, StatusBar, AudioPanel, ModeButtons)

- **Toolbar**: mixes edit/live/monitoring without hierarchy — 5 button
  languages in one row, duplicated errors (×StatusBar), OSC destination
  ×3, Import `.hol` permanently prominent.
- **StatusBar**: dev telemetry (`merge µs`, `lock µs`) in live
  foreground; `oscSuspended` displayed but **ARM state absent** — the
  live safety metric is missing from the surveillance post.
- **AudioPanel**: double collapse (App "AUDIO IN ▸" + panel "Audio
  Input ▾") = 2 clicks; `h-15` dead Tailwind class → distorted
  spectrum; audio level disappears when collapsed.
- **ModeButtons**: duplicated top-center banners ×4, `hasDrawableNode`
  duplicates the spline list, `return null` in drawMode with no visible
  click exit.

To add to functional bugs:
- **F14** nonexistent `h-15` → distorted spectrum canvas (AudioPanel:211)
- **F15** ModeButtons covered F1 + `return null` drawMode → **no draw
  exit by click** nor manipulate banner with "Esc"
- **F16** OSC ARM state invisible in StatusBar (monitoring shows dev
  telemetry but not dry-run)

To add to structural items:
- **S13** Mode vocabulary: "PERFORM"/"Atelier"/"Simple"/"Expert" — 3
  names for 2 modes, button shows current state (ambiguous)
- **S14** Cross-cutting duplications: errors ×2, OSC destination ×3,
  banners ×4, spline list ×2

## Audit conclusion

**Coverage**: 39 GUI files + 6 stores + wiring, 7 lots, full read.

**Outcome**: 16 functional bugs (F1-F16) — including live safety
(F1/F2/F4/F5/F15) and contradictory state (F9/F16). 14 structural
problems (S1-S14) — duplication/divergence. The domain is healthy; the
defect is the **undeployed design system** (existing tokens +
primitives bypassed everywhere) and the **missed convergences** (4
macros surfaces, 2 slot renders, 4 banners, bypassed dispatch).

**Confirmed refactor order**:
- **P0** — live-safety bugs: F1, F2, F4, F5, F15 (mode exit, recall
  guard) + F16 (visible ARM)
- **P1** — role tokens + shared components (`ShowTransport`,
  `PadButton`, `StatusChip`, `ModeBanner`, deployed `IconButton`,
  `NodeParamField`)
- **P2** — convergences: 1 macros surface, 1 slot render, liveActions
  only, showStatusSlice
- **P3** — two clear modes + ≥44px sizes
- **P4** — fallbacks: conduite ErrorBoundary, modal focus, delete
  guards, dead classes
