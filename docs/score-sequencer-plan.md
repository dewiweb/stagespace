# Score sequencer — implementation plan & progress tracker

> Living document on branch `feat/score-sequencer`.
> Design rationale: [score-sequencer.md](score-sequencer.md).
> **Update this file whenever a phase lands or its scope changes** —
> it is the single source of truth for "where is the sequencer".

Last updated: after loop region + clip duplicate (S2.y partial).

## Status at a glance

| Phase | Goal | Status | Commit |
|-------|------|--------|--------|
| S0 | Design note | ✅ | `2e4b384` |
| S1 | Backend-owned tape clock | ✅ | `952439d` |
| S2 | Multitrack clip timeline executed by backend + SCORE surface | ✅ | `65eadb0` |
| S2.x | Clip repeat (bounded pattern copies) | ✅ | `c18a8cb` |
| S2.y | Timeline hardening — loop region ✅ · clip duplicate ✅ · seek-while-playing 🔲 · record→tracks 🔲 | 🔄 | — |
| S3 | Automation lanes (macros, modulations, object params) | 🔲 | — |
| S4 | TC chase, poly-temporal (multi-cursors, relative speeds) | 🔲 | — |

## S1 — backend-owned score tape clock ✅

**Problem:** the rehearsal tape replayed via frontend `setTimeout` —
jitter, dead on webview reload, orphan timers possible.

**Delivered:**

- `commands/score.rs` — `ScoreTape` in `AppState` + commands
  `score_load/play/stop/clear/state`. Thread sleeps to each entry
  timestamp then emits `score-fire`; generation counter makes
  stop/re-play safe (<50 ms, no orphan fire).
- `useScoreTape` hook (main window only — global Tauri event → same
  anti-double-dispatch rule as `show-control`), fires entries through
  the existing REPLAY map. Execution semantics unchanged — only the
  clock moved.

**Known limit (accepted):** `score-fire` events are lost if the
webview is dead at fire time (the clock survives, the dispatch does
not). Superseded by S2's backend-direct execution.

## S2 — multitrack clip timeline + SCORE surface ✅

**Delivered:**

- **Model** — `ScoreTrack` (lanes `MOVES`/`CUES`/`MARKERS`, mute) and
  `ScoreClipDoc` (references `slotId`/`cueId` — never snapshots) in
  `useScoreStore`; persisted in the `.hfg` envelope under `score`,
  dirty-tracked.
- **Backend execution** — `score_timeline_load/play/stop/seek/state`;
  clips resolved at play (slot → `ActivateMoveRequest` via the builder
  extracted from `playSlot`; cue → `Cue` snapshot), then a backend
  thread executes `spawn_move` / `recall_cue_inner` / `deactivate_*`
  directly. **Playback survives webview death** — true runtime truth.
- **Shared helpers** extracted (zero divergence with IPC paths):
  `spec_from_request`, `deactivate_*_arc`, `apply_set_macro_request`.
- **SCORE surface** (`ScoreView`) — 4th surface, custom timeline (no
  new dependency): ruler seek, draggable/resizable clips (50 ms snap),
  lane pickers, animated cursor, zoom, per-lane mute.

**Semantics fixed:**

- One score move at a time per lane — last clip wins (console model).
- Cue markers passed by seek are skipped — no catch-up (initial state
  is Conduite's business).
- Stop = clock stop, NOT panic.
- Slot clip spanning the cursor starts with `set_time_offset`.

**Known limits:** seek stopped-only · no score loop · no TC chase ·
cue fired during an operator recall is skipped deterministically
(busy) · rehearsal tape (S1) remains a separate Atelier feature.

## S2.x — clip repeat ✅ (`c18a8cb`)

"Les loops de slots peuvent être aussi des loops dans le séquenceur"
— yes, as **two distinct notions** (documented in the design note):

- **In-clip loop** (`MoveSlot.loop_mode`) — trajectory cycles inside
  one clip: continuous motion.
- **Clip repeat** (`repeat_every_ms`) — the clip re-fires at
  `start + k·every` inside its `duration_ms` window: rhythmic
  re-articulation. With `anchor: current`, copies chain into evolving
  patterns.

**Implementation:** copies are **materialized at play time** (bounded
4096 iterations — never an infinite scheduler, never unbounded
workers); per-iteration movement ids `sc-{clip}-{k}` → deterministic
deactivation; mid-iteration seek starts with `time_offset`; repeat
without a window fires once + warning. UI: `⟳` clip label + repeat
ticks + inspector (start/duration/repeat). 85 backend + 515 frontend
tests.

**Limit:** repeat covers a *single clip*. A multi-lane "pattern clip"
(nested clip group tiling moves+cues+markers together — the real DAW
pattern) is S3+ work.

## S2.y — timeline hardening 🔄

- ✅ **Score loop region** — `loop_region: Option<(u64,u64)>` on the
  timeline, command `score_timeline_set_loop`. Transport-level
  `[start,end)` loop with **hard-wrap semantics**: at `loop_end` the
  cycle's score moves are cut, the shared cursor re-bases to
  `loop_start` (state event shows the jump), and a fresh event list
  is generated — deterministic, each cycle is "seek into loop_start".
  Events ≥ `loop_end` never fire while looping (no pre-hearing).
  First pass honours the seek: events before `loop_start` play once
  as an intro, then the region loops. Loop config is captured at
  play (live re-arm is S3). Persisted in `.hfg` + dirty-tracked; UI:
  `⟲ LOOP` transport toggle + bound inputs + ruler band. Three
  distinct loop levels now coexist: trajectory loop (`loop_mode`),
  clip repeat (`repeat_every_ms`), transport loop (`loop_region`).
- ✅ **Clip duplicate** — `duplicateClip` materializes an independent
  copy offset by its duration (inspector `⧉` button). Distinct from
  repeat: a real editable clip, not a virtual pattern copy.
- 🔲 **Seek while playing** — deterministic kill/respawn of score
  moves or backend `locate` semantics; today `score_timeline_seek`
  refuses while `started_at.is_some()`.
- 🔲 **Record → tracks** — convert the S1 rehearsal tape (or live
  capture) into clips on lanes; the tape becomes a recording mode of
  the sequencer rather than a parallel feature.
- 🔲 **Clip nudge UX** — copy/paste, Alt-drag duplicate, multi-select.

## S3 — automation lanes 🔲

Keyframed continuous parameters evaluated by the backend (design note
`AutomationLane`): global macros (`speed`, `scale`, `shift_*`,
`yaw/pitch/roll`, `radius_scale`, `height_offset`), modulation-graph
params, per-object params. Writes go through the **same command paths
as OSC-IN** (same validation, same merge inputs).

Open design points: evaluation rate (60 Hz vs event-driven), curve
model (linear/smoothstep/step — bezier later), conflict policy with
operator/OSC writes (last-wins? score priority?), lane-per-target UI
density.

**Dependency reassessment:** S3 is where curve editing (keyframe
handles, bezier, range selection) may finally justify a React
timeline/graph library — re-evaluate `react-timeline-editor` /
custom canvas then. S2's custom timeline stays: ~100 lines of pointer
math vs an unmaintained dependency.

## S4 — TC chase & poly-temporal 🔲

- Score clock driven by incoming timecode (reuse the existing TC
  engine `/stagespace/timecode`, chase flag) — the score becomes a
  TC-follower like a lighting desk.
- Loop regions, multiple cursors / relative playback speeds —
  IanniX territory (see `RESEARCH_STATE_OF_ART` §IanniX, and
  `dev-plan-spatial.md` A1.6 "diffusion score view" which anticipated
  this as long-term).

## Cross-cutting invariants (any phase)

- **Backend owns runtime truth** — the score clock, event list and
  clip execution live in Rust; the webview is authoring + view only.
  Never reintroduce `setTimeout` orchestration.
- **Clips reference live entities** (`slotId`/`cueId`), resolved at
  play — editing a slot updates future playback, document stays a
  document.
- **Bounded everything** — materialized repeats capped, no unbounded
  worker fan-out, deterministic ids.
- **Persisted score fields** must touch: `useScoreStore` model,
  `.hfg` envelope, dirty tracking (`envelopeComparable`),
  `scoreResolve`, backend `ScoreClip`, UI, tests.
- **Lock order** `pending_move_ids → movements → merge_runtime →
  osc_receiver` — score thread follows it like everyone else.

## Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| S1 | Tape clock moved backend-side, still event-dispatched | Quick win; true survival needed clip payloads (S2) |
| S2 | Clips *reference* entities, snapshots resolved at play | Edit-once semantics; document stays small |
| S2 | Backend executes spawn/recall directly (not `score-fire`) | Playback survives webview death |
| S2 | Last-wins per lane; skipped cues on seek | Deterministic console semantics |
| S2 | No timeline library (custom view) | Minimal deps; real cost lands at S3 |
| S2.x | Clip repeat = virtual materialized copies, not duplicated JSON | Edit-once; bounded; seek-safe |
| S2.x | Repeat requires `duration_ms` window | No unbounded generation |
| S2.y | Transport loop = hard-wrap (cycle moves cut at loop_end) | Deterministic "restart the phrase"; no ghost spawns |
| S2.y | Events < loop_start play once on first pass | Intro-then-loop, standard DAW reading |

## Verification status

- Backend: **85 tests** (incl. 4 `build_events` repeat tests), clippy
  `-D warnings`, fmt — all green.
- Frontend: **517 tests** (score timeline suite: document ops,
  resolution, mute/lost refs, transport invokes, repeat propagation,
  duplicate, loop region config), tsc, lint (0 errors) — all green.
