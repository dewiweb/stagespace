# Lot 6 — Modals and ui/ primitives (full audit)

## 1. `components/SettingsModal.tsx` (294 l.)

Global config (OSC out/in, merge, track IDs, audio). Mounted only at
`Toolbar:115` — unreachable in Perform (consistent with the slice lock).

- `catch (e: any)` — the only explicit `any` in the audited files (94).
- Error detection by `oscInStatus.startsWith('Error')` — fragile (211).
- `setOscPort(Number(...) || 0)` — impossible to clear, silent port 0 (134).
- `key={i}` index on targets (164).
- Mixed tokens: `border-gray-700`/`bg-gray-900` vs
  `border-stagespace-border` footer.
- Arbitrary `max-w-[520px]` vs QuickAdd `max-w-sm` — no width scale.
- `oscIdsStr` initialized at mount, no resync during opening.

**Verdict: functional, single OSC editing point — lax validation,
perfectible type/token hygiene. No tests.**

## 2. `components/WelcomeModal.tsx` (86 l.)

First launch → bundled example or empty start (`App:504`).

- `loadExample` closes and marks `welcomed` **even if the load fails** (30-39).
- Esc/X = consenting to the flag without distinction.
- Ad hoc styled `<kbd>` — the repo's 3rd implementation.

**Verdict: clean and documented; real defect = flag marked on failure.**

## 3. `components/ShortcutsModal.tsx` (46 l.)

Shortcut cheatsheet, `App:507` (`?` or Toolbar button).

- **Hand-duplicated** list of `useLiveShortcuts` — already drifting
  (Ctrl+K listed but its handler is NodeEditor document-level;
  Backspace nuance unmentioned).
- `?` handled **before** the `isModalOpen` guard — stacks ShortcutsModal
  on top.
- Omits the `/stagespace/*` OSC commands.

**Verdict: minimal and correct; manual synchronization = declared debt.**

## 4. `components/QuickAddModal.tsx` (138 l.)

Plugdata-like searchable palette, `NodeEditor:943-951`. Triggers:
Ctrl+K, pane double-click, palette + button, hint.

- **Probable focus bug**: `Modal:42` focuses `focusables[0]` = the
  header **X button** → steals the input's autoFocus → typing on open
  doesn't go into the field. The test doesn't see it (`fireEvent`
  without real focus).
- `expect(calls.length + 0).toBeGreaterThanOrEqual(0)` — **tautological
  assertion**, the keyboard test verifies nothing (test:77).
- `selIdx` reset on `query` only (54).
- Hardcoded plugin color `#a855f7` (113).
- Flat list without category headers.
- Mounted **inside** the "Canvas" ErrorBoundary — a crash kills canvas
  + editor.

**Verdict: good palette UX, but a real suspected focus bug and a
shallow test.**

## 5. `components/ui/Modal.tsx` (94 l.)

Modal shell: overlay `bg-black/60 backdrop-blur-sm` z-popover,
`role=dialog aria-modal`, focus trap, `useModalGuard`.

- **`focusables[0]` = X button** — every modal opens with focus on
  "Close", stealing the content's autoFocus (42). Should prefer
  `[autofocus]` or the first content element.
- **Esc isn't handled by Modal** — delegated to `useLiveShortcuts` →
  outside App (tests, conduite window), Esc closes nothing.
- No `aria-labelledby`.
- `closeOnOverlay=false` but `useModalGuard` stays → Esc closes anyway.
- No portal — fragile inside a transform/overflow container.

**Verdict: good foundation; 2 real defects: initial focus = X,
external Esc.**

## 6. `components/ui/ConfirmModal.tsx` (43 l.)

Destructive confirmation — `CuelistPanel:341`, `MovesTable:599`.

- "Focus lands on Cancel" comment **false** — focusables[0] = header X.
- `onConfirm` doesn't close — depends on the caller (undocumented).
- Buttons without `transition-colors` — micro-inconsistency.
- No `variant` prop: always destructive red (design, ok).

**Verdict: does exactly one thing well; inaccurate docstring.**

## 7. `components/ui/EmptyState.tsx` (52 l.)

Normalized empty state. **Reused**: CuelistPanel, TrackGrid,
MovesTable, AnimationList, SpatialFxPanel ×3 — 6 sites.

- The docstring claims "~8 implementations replaced" — some remain:
  `PerformView` ×4 (465-585, duplicated rich empty state), `NodeEditor`
  (923-941), `SettingsModal` (276-278).
- `bg-indigo-900/50` button — indigo isn't a token.
- `size:'sm'` only compacts padding.
- 0 tests.

**Verdict: correct primitive adopted for lists; half the empty states
remain ad hoc.**

## 8. `components/ui/IconButton.tsx` (46 l.)

5-variant toolbar button. **Reuse: 1 file only** (Toolbar ×5).

- **22 color classes, 0 tokens** — `bg-gray-800`, `bg-indigo-800`… The
  `primary` is **indigo** while `stagespace.accent` = blue — **two
  "primaries" in the design system**.
- Massive under-adoption: PerformView alone has ~25 similar ad hoc
  buttons.
- `danger`/`warning` variants with `border` → different effective
  padding.
- No required `aria-label`.

**Verdict: sensible API but almost undeployed — declaration of intent.**

## 9. `components/ui/Slider.tsx` (109 l.)

Unified 3-layout range. **The most adopted**: 9 files.

- `ACCENTS: Record<string,string>` untyped key — unknown accent →
  silently missing class (30-38).
- `dec` inferred from `step` — step 0.15 → 1 decimal → truncated
  display (55).
- `bare` layout: `className` on the input only vs wrapper elsewhere —
  asymmetric (72).
- No `aria-label` when `label` is absent — `bare` inaccessible.
- Truncated `w-16` label; `w-12` value overflows on `"-180.00°"`.

**Verdict: the only truly deployed primitive; formatting/typing to
tighten.**

## 10. `components/ui/OscArmToggle.tsx` (41 l.)

OSC master LIVE/MUTED switch — `Toolbar:119`, `PerformView:452` and
`:568`.

- **F9 — Desynchronization**: `set_osc_armed` emits no event
  (`osc.rs:239-242` = `eprintln!` only). Three unsynchronized sources:
  this toggle, `DryRunChip` (divergent render, **inverted semantics** —
  disarmed = green), `/stagespace/arm|disarm` → `doArm`. A console
  disarm → the toggle still shows LIVE; two simultaneous PerformView
  instances → contradictory states.
- Silent `catch(() => {})` → lying "LIVE" outside Tauri.

**Verdict: good UX but local state not broadcast + competing
DryRunChip = contradictory state source. To merge.**

## 11. `components/ui/PanicButton.tsx` (54 l.)

Shared panic — `Toolbar:161`, `PerformView:453/568/667`. **The 3
PerformView panics are genuinely the same component** (no internal
duplication).

- `setTimeout` not cleaned up (28).
- Flash: `animate-fade-in` then hard unmount at 350ms — no fade-out.
- The duplication is **elsewhere**: `ConduitePage:88` rewrites the
  button — no icon, no flash, divergent styling, no visual feedback in
  the conduite window itself.
- `PerformView:561` STOP ALL = different action (fade) — legitimately
  separate.

**Verdict: good live-safety component; only ConduitePage's panic
escapes the sharing.**

## 12. `components/ToastContainer.tsx` (51 l.)

Bottom-right z-toast stack, `App:501` — **absent from the
`?view=conduite` branch** (short-circuit before AppMain → panic toasts
invisible in the FOH window).

- `role="alert"` on each item **and** on the container + `assertive` —
  double screen-reader announcement.
- Error icon = `<X>` — "close" glyph, not error.
- **Duplicated `animate-fadein`**: index.css defines
  `fadeIn`/`animate-fade-in` (4px) AND `fadein`/`animate-fadein` (8px) —
  two conventions coexist.
- No sticky vs ephemeral indication, no timeout bar.

**Verdict: solid system (dedup, sticky, folding); a11y and naming to
clean.**

## 13. `components/ErrorBoundary.tsx` (48 l.)

Per-zone boundary: Perform, Left panel, Canvas, Inspector —
deliberately not Toolbar/StatusBar/ToastContainer (panic must survive).

- **The `?view=conduite` branch is NOT wrapped** → ConduitePage crash =
  blank page on the dedicated FOH screen (the worst screen for that).
- Fallback shows raw `error.message` — technical stack exposed to the
  operator.
- Retry without backoff — possible crash→retry→crash loop.

**Verdict: correct zone strategy; missing conduite coverage +
retry-backoff.**

## 14. `pages/ConduitePage.tsx` (94 l.)

Secondary-window conduite dumb-view (`?view=conduite`). Receives
`conduite:state` (500ms), emits `conduite:cmd`.

- **F10 — Blank page outside Tauri, stacked causes**: (a) **raw**
  `listen`/`emit` from `@tauri-apps/api/event` instead of `safeListen`
  (7) → rejection outside Tauri, `st` stays null → '—' everywhere; (b)
  silent `poll` catch → no "backend absent" indicator; (c) unhandled
  `emit`; (d) no ErrorBoundary around the lazy → crash = full blank.
- `bg-stagespace-bg` **and** `style={{background:'#0b0d12'}}` — the
  inline overrides the token with a **different** value (44).
- **Duplicated PANIC** — not `PanicButton`: no icon, no flash, no ack
  if the main window is closed (88).
- **GO ≠ GO**: `cmd('go')` → `doCueNext` (cue recall) vs PerformView
  "GO" = `goToNextMove` (setlist) — same label, different actions
  depending on the window — operator-dangerous.
- `disabled` on Prev/Next during `isRecalling` but **not on GO** (85-87).
- `pending.remainingSec` = emitted snapshot — the countdown jumps in
  500ms steps.

**Verdict: useful dedicated view but the most fragile audited file:
raw API, zero fallback, bypassed token, off-component panic, ambiguous
GO.**

## ui/ primitives quality

| Primitive | Consumers | Verdict |
|---|---|---|
| `Modal` | 5 modals + 2 pickers | ✅ good |
| `ConfirmModal` | CuelistPanel, MovesTable | ✅ adopted (2/2) |
| `EmptyState` | 6 sites/5 files | ⚠️ half the empty states inline |
| `Slider` | 9 files | ✅ the most deployed |
| `IconButton` | **Toolbar only** | ❌ ~40 similar ad hoc buttons unchanged |
| `OscArmToggle` | Toolbar, PerformView×2 | ❌ unsynced state + competing DryRunChip |
| `PanicButton` | Toolbar, PerformView×3 | ✅ shared except ConduitePage |

**stagespace tokens**: partial — `Modal`/`PanicButton`/`ToastContainer` ✓
but `IconButton` (0 tokens, 22 colors), `Slider` (accent-* raw),
`EmptyState` (indigo), `OscArmToggle` (red/gray raw), `ConduitePage`
(inline) — the design system exists but isn't applied to the
primitives themselves.
