# Lot 7 — Chrome and monitoring (full audit)

`performMode` in `useMoveEditorStore` (default **`true`** — the app boots
in live, `:264`); header toggle `App.tsx:203-217`; `showExpert` `:218-229`
(only if `!performMode`).

## 1. `components/Toolbar.tsx` (176 l.)

**Edit-only** action bar (`App:242`, `!performMode` ternary).

One line: primary `.hol` Import `bg-blue-700` + green `{n} tracks` chip;
divider; OSC chip → SettingsModal (`OSC out` 11px + mono addr:port +
profile); `OscArmToggle`; undo/redo `IconButton`; save/load `.hfg`;
spacer; Help; `PanicButton`; errors banner `bg-red-950/30`.

- **5 button languages in the same row**: custom primary, chip-button,
  OscArmToggle, IconButton, PanicButton — no unification.
- **Error duplication**: banner (166-171) and StatusBar pill:89-98
  display the same `compileError`/`playError` simultaneously.
- **OSC destination duplication**: chip (112) + StatusBar:104 +
  SettingsModal — 3 places.
- Undo/redo labeled "expert" but visible in Simple too.
- Ad hoc `text-[11px]`, icons 13 vs 14, non-token colors (`bg-blue-700`,
  `text-green-400`).
- `.hol` Import permanently prominent though it's one-shot setup;
  only state feedback = transient green chip.
- Edit/live/monitoring mix without segmentation.

**Verdict: hierarchy-free mix + duplications. High priority —
restructure into file/project/live-safety zones.**

## 2. `components/StatusBar.tsx` (113 l.)

Monitoring console **persistent in all modes** (`App:498`, intended).

`footer h-7 text-xs`: status dot (green live/yellow pulse compiling/red
error/blue compiled/gray idle); perf block if `activeCount>0`: FPS
(55/30), osc/s, %cpu, `merge` µs (2000/8000), `lock` µs (100/500),
pulsing `OSC SUSPENDED`/`MERGE DEAD` badges; dismissable error pill;
`→ addr:port` mono; `v{__APP_VERSION__}`.

- **F16 — Dev telemetry exposed live**: `mergeFrameUs`/`mergeLockUs`
  with "budget 16.6ms"/"contention" tooltips permanently in first line
  during play — `debugPerfVisible` exists but the perf block isn't
  gated by it.
- **OSC ARM state absent**: `oscSuspended` shown but not arm/disarm —
  THE live safety metric missing from the surveillance post (silent
  dry-run possible).
- Hardcoded magic thresholds in JSX (55/30, 0.05, 50%, 2000/8000,
  100/500) — not centralized.
- µs→ms conversion duplicated 2× inline.
- Plain-language engine vocabulary: `Compile:`, `merge`, `lock`,
  `MERGE DEAD`.
- Error pill = duplication of the Toolbar banner in edit.
- Reasonable permanents: dot + destination + version — but ARM is
  missing.

**Verdict: dev telemetry in live foreground + ARM state absent. High
priority — user/debug split + permanent arm/disarm indicator.**

## 3. `components/AudioPanel.tsx` (214 l.)

Audio-in capture config + monitoring, `App:479` right column, inside an
**App collapsible section** "AUDIO IN" (`audioExpanded`, `ss-layout-*`,
default `false`), `max-h-[40%]`.

Internal header: pulse dot + title + cyan mini-RMS bar + cyan BPM +
text chevron `▸/▾`; body: device select (disabled listening), Status
card, 4 RMS/Bass/Mid/High bars, BPM+confidence card, `SpectrumView`
canvas 220×60 48 bins `hsl(200…280)`, Start/Stop button.

- **Double collapse** — major defect: App renders "AUDIO IN ▸" which
  mounts AudioPanel re-rendering "● Audio Input ▾" — two headers, two
  chevrons (`ChevronRight` vs `▸`), two labels → 2 clicks to see the
  controls.
- **`h-15` doesn't exist in Tailwind v3** (211 — h-14/h-16 scale, no
  config extension) — dead class; the canvas keeps its 60px attribute
  but `w-full` stretches it → non-uniformly distorted spectrum. F14.
- Redundant Status card (96-106) — duplicates header dot + button.
- `mt-auto` without effect (scrollable parent without fixed height).
- Errors on 2 channels: local `error` (open body) + App toast.
- Ad hoc band colors `blue/red/green/yellow-500`, inline `hsl()`.
- `audioExpanded=false` unmounts everything → capture continues
  (intended) but **no level indicator survives** — the header mini-RMS
  is killed by the App wrapper.

**Verdict: double collapse (2 clicks) + dead `h-15`. High priority —
remove the internal collapse, keep App's with summary header +
persistent level indicator.**

## 4. `components/ModeButtons.tsx` (74 l.)

Floating interaction-mode toggles — mounted `Scene3D:400-405`
(edit-only).

Container `absolute bottom-2 left-2 z-overlay`: Manipulate `bg-blue-600`
active / ghost; Assign `bg-green-600`; Draw conditional `hasDrawableNode`
(DrawSpline/Evaluate/Trim/Offset + `VectorField field==='drawn'`, 22-31);
manipulate top-center cheatsheet banner; `if (drawMode) return null` (33).

- **`hasDrawableNode` duplicates the spline list** — same list as
  `objectsNodeSync.ts:15`; should be a shared constant.
- **4 copies of the top-center banner**: here (66-70) + Scene3D:380
  (Assign), 387 (Place), 394 (Edit) — same position/styling, 4
  implementations.
- **`return null` in drawMode**: no affordance to exit Draw except
  Esc/DrawModeOverlay — the button that launched the mode disappears.
  F15.
- Asymmetric props/store: manipulate/assign in props, draw in store.
- Manipulate banner: one dense line of 4 gestures, `text-xs`, **no Esc
  mention** (the zone banners say "Esc to cancel").
- Hit targets ~22px (`px-2.5 py-1`, 11px icons).
- Ad hoc colors `blue-600`/`green-600` vs unused `IconButton`.

**Verdict: quadrupled banner + duplicated spline list + no draw exit
by click. Medium — extract `ModeBanner`, `DRAWABLE_NODE_TYPES`, Exit
Draw button.**

## Lot 7 cross-cutting

- **S13 — Mode vocabulary**: "PERFORM" (green) / "Atelier" /
  "Simple"/"Expert" — 3 names for 2 modes; the button shows the
  **current state** as the toggle's label toward the other — ambiguous
  semantics.
- **S14 — Cross-cutting duplications**: errors ×2 (Toolbar×StatusBar),
  OSC destination ×3, audio collapse ×2, spline list ×2, banners ×4.
- Entirely ad hoc palette (`blue-600/700`, `green-400-600`,
  `cyan-400/500`, `red-900/60`) despite tokens almost unused outside
  `bg/panel/border`.
- `z-overlay` token well used everywhere — the only real token
  discipline.
