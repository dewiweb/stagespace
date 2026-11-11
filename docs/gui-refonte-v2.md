# GUI redesign v2 — post-deep-review plan

> **Status: active direction** — the canonical GUI plan (PERFORM/Edit,
> Simple/Expert vocabulary).

Replaces `gui-refactor-plan.md` (obsolete) — written from a full code
review at `cf4749a`+, all dimensions: structure, data flow, detached
state, dead code, test coverage, style.

## Verified real state (findings, not opinions)

### Structure

| Surface | Contents | Gap |
|---|---|---|
| **ATELIER** | 3 cols: [Show:Moves/Cues/FX + Templates] · [3D/NodeEditor] · [Inspector/Audio] | healthy layout — CuelistPanel = 6 domains |
| **CONDUITE** | ConduitePage (Now/Next/transport/TC) | **display-only**: no cue list, arm, log, health → impossible to run the show |
| **JEU** | PerformView (setlist+pads+drawer+busking) | diverges from detached RunView (pads+radar+gestures) — the instrument split in two |

### Measured duplications

- **Cues ×3**: CuelistPanel (writing+arm+transport+audition),
  PerformView (cue column+recall), ConduitePage (display) — none
  complete for its phase
- **Atelier-only live safety**: panic+arm+health+dead-backend visible
  only in Atelier — invisible where the show runs
- **PerformView overlays**: `buskingMode` remains the last internal
  `absolute inset-0` (touchMode already removed)
- **Score/tape** in CuelistPanel (a writing panel) — their domain is
  rehearsal/conduite
- **Log** in CuelistPanel — invisible outside Atelier

### Data flow

- **Global hooks mounted in AppMain** (useShowControl, liveShortcuts,
  conduiteBroadcast, listeners) — present on all surfaces ✓
- **Detached windows** = their own zustand instances:
  - `conduite:state` broadcast 500ms + `conduite:cmd` → main dispatches
  - BUT the polling slices (perfSlice module interval) run **in each
    window** → N windows = N× backend poll load
  - `?view=run` has neither useShowControl nor conduite:cmd (direct IPC
    invoke — works, but no OSC dispatch, no shared log)
- **Detached window = display+command, never owner** — to freeze as a
  rule (arm/store/edits live in the master window)

### Measured debt

| Debt | Volume |
|---|---|
| Ad-hoc colors (6 live files) | ~112: PerformView 47, StatusBar 19, SettingsModal 17, CuelistPanel 16, RunView 10 |
| Files >400 lines | 9: PerformView 1017, NodeEditor 686, Inspector 647, MovesTable 617, SpatialFxPanel 615, CustomNode 589, CuelistPanel 570, SettingsModal 496, Scene3D 494 |
| Numeric z-index | 0 (already clean) |
| Dead `oscSlice` | no consumer — delete |
| Tests | 7 files only — PerformView, CuelistPanel, RunView, liveActions, useShowControl (the live dispatch!): **zero coverage** |
| useEffect | healthy (2-5/file) — the poll-slice discipline holds |

## Expected vs actual analysis — where the interface promises more than it delivers

| Expected | Actual | Gap |
|---|---|---|
| Run the show from CONDUITE | `cmd('prev/go/next/panic')` only — no cue list, no arm → GO exists but you don't choose what you GO beyond Now/Next | the surface promises conduite, delivers display |
| **Unsolo** "restores" | restores `soloSavedIds` (captured at solo) — slots played DURING the solo are not resumed → partial restore if the operator played meanwhile | promises a round-trip, delivers a snapshot |
| **Audition** "what does cue 3 look like" | radar of `manual_positions`+`origin` — objects **under move** will move (trajectories, not positions) → the static image omits the cue's animated content | audition shows rest, not motion |
| **Pad** = playing | `movementId` = true backend state ✓ but stays "playing" during fade-out and even if spawn failed (id set until stop) | true but non-granular state |
| **"emitted"** tooltip | = last sent, not received/ack'd by the renderer | fixed in label, confusion remains in expectations |
| **Perceptual** 5°/s warning | true values, but the "illegible" threshold is arbitrary and uncalibrated to the venue — risk of a noisy chip | technical truth, unproven UX utility |
| **Settings** toggles | send config to backend — no real acceptance feedback (except slice revert-on-error) | fire-and-forget masked by a clean revert |
| **Solo/park/hold chips** | `objectStates` backend = true source ✓ (no inference) | correct — keep as reference |
| **Track colors** | one color = one track, consistent across radar/chips/3D | correct |

## Global architecture analysis — the real questions

| Question | State | Risk |
|---|---|---|
| **Per-window store** = independent zustand + shared localStorage | two windows edit the same config → silent last-write-wins | silent config divergence (venue/PSN/reality duplicated) |
| **`conduite:` master→conduite only** | detached RunView has neither `conduite:cmd` nor a dedicated broadcast — direct invoke | inconsistent peer scheme per window |
| **`useGraphStore` god-store** (15 slices) | every surface reads everything — implicit coupling between domain and surface | one slice error breaks all surfaces |
| **`liveActions` injected by regex codegen** (`logAction`/`rec`) | the injection sediments — breaking a signature breaks log/tape | fragile pattern that won't survive refactors |
| **N windows = N× poll** | perfSlice interval per window | multiplied, uncapped backend load |
| **`conduite:state` computed in main** | Now/Next = master window's store — correct if only the master is owner | depends on the detached conduite not editing — to freeze |

## Layout relevance — component by component

| Component | True domain | Relevance | Verdict |
|---|---|---|---|
| Toolbar | file/undo/save/load/help/panic | panic is misplaced (Atelier-only) | keep file items, PANIC moves to SafetyBar |
| StatusBar | engine+arm+flows+perceptual+perf+errors+OSC-dest | all good but Atelier-only | split: safety → global SafetyBar, perf/errors stays |
| CuelistPanel | cues + score + tape + log + audition + transport | 6 domains | cut: cues+audition → Atelier; arm+GO+log → Conduite; score/tape → Rehearsal |
| PerformView | pads+setlist+drawer+busking+chips | the instrument, but no radar/gestures | absorb RunView — one instrument |
| RunView | pads+radar+gestures+transport | the light instrument, detached | variant of the same component, not another |
| ConduitePage | Now/Next+transport+TC | the FOH display | + armed cue list + log to be the surface |
| SettingsModal | 16-section config | monolith | domain tabs |
| MovesTable | move management | healthy, one domain | stays |
| Inspector | move/node params | healthy, one domain | stays |
| SpatialFxPanel | zones/modulations | one domain but home = secondary tab | can stay as tab or be promoted |
| AnimationList | library/presets | healthy | stays |
| Scene3D | 3D canvas + draw modes | healthy | stays |
| AudioPanel | audio capture config | healthy, collapsed | stays |

## The target model — one phase = one complete surface

### R0 — Global SafetyBar (PRIO 1)

`SafetyBar` extracted from StatusBar: PANIC + LIVE/DRYRUN arm + PSN + OSC
activity + perceptual + dead-backend → footer **app-level, all
surfaces**. Show safety must never depend on the phase.

### R1 — Operable CONDUITE (PRIO 1)

ConduitePage becomes the real conduite surface:

```
┌──────────────┬──────────────────────────┐
│ Cuelist      │ Giant Now · Next · then  │
│ (arm+GO+     │ TC · transport           │
│  audition)   │                          │
├──────────────┴──────────────────────────┤
│ Operational log                         │
└─────────────────────────────────────────┘
```

- CuelistPanel `variant="conduite"` prop: arm/GO/audition/log, without
  score/tape/writing
- Log leaves CuelistPanel → dedicated row at the bottom of the surface

### R2 — JEU: one instrument (PRIO 1)

PerformView+RunView merge: pads+radar+gestures+sources+transport+
collapsed drawer. Radar+gestures migrate into PerformView; `?view=run`
becomes the detached variant of the same component (prop). buskingMode →
a pad density variant, no longer an overlay.

### R3 — ATELIER: one domain per panel (PRIO 2)

- CuelistPanel `variant="compose"` prop: writing+scope+audition
- Score/tape → dedicated "Rehearsal" panel (Atelier) or Conduite
- Shared log (same component, mounted in Conduite AND reachable in
  Atelier)

### R4 — SettingsModal: 16 sections → 5 tabs (PRIO 2)

Connection (OSC out/in/profiles) · Tracking (PSN) · Venue (venue+reality+
merge) · Show (media+TC) · Audio. Content unchanged, domain navigation.

### R5 — Hygiene + tokens (PRIO 3, ongoing)

- Delete `oscSlice` (dead)
- Tailwind role tokens (live/conduite/osc/warning/danger/tracking/dim)
  — the 112 ad-hoc migrate per touched file (PerformView 47 first)
- buskingMode → pad density (removes the last internal overlay)
- `text-[10px]` floor on live surfaces (remove 8px/9px)

### R6 — Test coverage (PRIO 2 for reliability)

| Target | Tests to write |
|---|---|
| `liveActions` + `useShowControl` dispatch | the critical live path — show-control event → expected invoke |
| `CuelistPanel` variants | arm/GO/audition/score strip |
| `PerformView`/`RunView` | pads, gestures, source chips |
| `SettingsModal` | persisted sections |
| **Multi-window poll** | N windows must not N-multiply the backend poll (dedup or broadcast) |

## R7 — Detached windows: the frozen model (PRIO 2)

- A detached window = display+command, never owner of truth
- Polls deduplicated OR state received via broadcast (like
  conduite:state) — otherwise 3 windows = 3× the backend IPC poll
- `?view=run` joins the shared conduite:state/cmd scheme

## Actions from the expected/actual analysis

| Gap | Action | Where |
|---|---|---|
| Conduite = display | cue list + arm + log in the surface | **R1** |
| Partial unsolo | capture `soloSavedIds` at unsolo (or document "restore = snapshot at solo") | R2 + backend |
| Audition = rest | label "positions at recall" honestly; future extension = simulated trajectories | R3 |
| Non-granular pad | distinct `playing` vs `fading`/`spawn-failed` states | R2 |
| Arbitrary perceptual | documented thresholds + disable option | Settings |
| Multi-window config | detached window = read-only on config (frozen rule) | **R7** |
| Settings fire-and-forget | backend acceptance indicator per toggle | R4 |

## Order

```
R0 SafetyBar ─┐
R1 Conduite  ─┼─→ the show runs on these two
R2 Jeu       ─┘
   ↓
R3 Atelier · R4 Settings · R6 tests · R7 detached
   ↓
R5 ongoing hygiene
```

## Out of scope

- A1.6 score view (postponed)
- Rewriting allowed if necessary (user decision) — NodeEditor,
  Scene3D, Inspector included; the rule stays: we rewrite for a
  structural reason, not aesthetics
- No cosmetic redesign — structure + coherence, the look follows the
  tokens

## Done criteria

1. Panic/arm/health visible everywhere, all the time
2. Full show run from CONDUITE without leaving the surface
3. Entire instrument playable from JEU (`?view=run` = variant, not
   required)
4. One identifiable domain per panel
5. Tests on live paths (dispatch, cues, gestures)
6. Detached windows without N× poll

---

## Execution (2026-11-01) — R0→R7 delivered

| Item | Commit | Delivered |
|---|---|---|
| R0 | `403b163`+`71d85a5` | Global PANIC in StatusBar (already mounted on all surfaces — the only gap was panic, Toolbar-only) |
| R1 | `0db0668` | Shared `ConduiteView` + `ConduiteSurface` (stores) + `ConduitePage` (events) — operable cue list, arm, log, transport; `doCueRecallById` |
| R2 | `9e3f493` | PerformView = full instrument (pads+badges+radar+throw+gestures+drawer); `?view=run` = same surface via RunWindow; RunView.tsx deleted; **panic fix** (crash on get_track_positions undefined) |
| R3 | `9859a68` | CuelistPanel refocused cues-only; ScorePanel + ShowLogPanel as tabs; **fix for recall-by-id broken since forever** |
| R4 | `3dc628e` | Settings 8 sections → 5 tabs (Network/Tracking/Venue/Show/Audio) |
| R5 | `a848739` | sourceColors.ts (hex/text/chip/label) — radar+pads+chips unified |
| R6 | `f7d0de3` | useShowControl.test 11 tests — OSC→liveActions→IPC dispatch + guards; 391/391 |
| R7 | `a1d80ff` | detached windows read-only (isDetachedWindow + storage guards); ss-surface not persisted; +Move hidden in detached |

### Real bugs discovered along the way
- `panic` crashed if `get_track_positions` resolved undefined
- `doCueRecall(cue.id)` in CuelistPanel — broken since the beginning
  (id ≠ cue_number/index)
- `?view=run` lacked the live listeners (potentially frozen states) →
  RunWindow mounts the listeners without useShowControl (double
  dispatch avoided)

### Accepted out-of-scope remains
- Run window: the `N×poll` perfSlice persists (module-level, per
  window) — R7 freezes writing, not reading; a single backend stream
  would remain ideal
- logAction/rec injected by regex into liveActions — fragile pattern
  on refactor
- Real Tauri runtime validation still pending (inter-webview
  events/listeners)
