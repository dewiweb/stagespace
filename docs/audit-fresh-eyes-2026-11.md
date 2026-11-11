# Fresh-eyes audit — 2026-11-01

Full audit by 6 independent reviewers (backend, wire/IPC, frontend
state, UX/workflows, tests, live safety), **without reading the
existing plans/audits** — findings verified in code, file:line, ranked
by severity.

## P0 — Show-killers (fix before any live trust)

| # | Defect | Evidence | Source |
|---|---|---|---|
| P0.1 | **Closing a detached window kills the show** — `on_window_event` doesn't filter `window.label()`: closing conduite/run drains all moves, stops merge + OSC + supervisor | `src-tauri/src/lib.rs:217-255` | live-safety |
| P0.2 | **Panic only exists on the JS side** — `/stagespace/panic` is ACK'd then requires the main webview (`useShowControl` → doPanic). Frozen/crashed webview = panic ACK'd never executed | `osc_receiver.rs:1266`, `App.tsx` | live-safety |
| P0.3 | **Dead renderer = invisible** — UDP `send()` succeeds on a powered-off host, circuit-breaker requires ECONNREFUSED (`refused>0.5`). Green status, total blackout | `merge_runtime/mod.rs:2651`, `position_sink.rs:93` | live-safety |
| P0.4 | **Panic during recall → moves respawn** — `recall_cue_inner` respawns after panic; no `panic_in_progress` veto. And `panic()` store (Esc) doesn't cancel pending pre_wait/follow — moves that revive after panic | `cue_commands.rs:653-712`, `useGraphStore.ts:457` vs `liveActions.ts:192` | live-safety + UX |
| P0.5 | **Dry-run isn't a mute** — panic/`send_position_now` bypass `osc_armed` + `venue_map`: real canonical positions sent during disarmed rehearsal | `merge_runtime/mod.rs:431-447, 2757` | live-safety + backend |
| P0.6 | **`set_osc_receiver_port` kills `/stagespace/*`** — receiver rebuilt without migrating `show_sink` (+ media_sync, timecode_fps, suppress_until). Every command ACK'd but dropped — common case: persisted port ≠ 8001 at boot | `commands/osc.rs:110-165`, `lib.rs:295` | wire/IPC |

## P1 — Diverging truths (real mid-show bugs)

| # | Defect | Evidence |
|---|---|---|
| P1.1 | **Manual/PSN/tape/throw/attention positions no-op without a live move** — the merge only emits for objects covered by a move's `track_indices`; frame loop early-returns without a move. Command ACK'd anyway | `merge_runtime/mod.rs:1879`, `helpers.rs:150-157` |
| P1.2 | **`?view=run` pushes its stale config to the backend** — detached store has `manualOscIds=[1..64]` → `set_global_osc_ids` overwrites the main's .hol mapping at mount | `useGraphStore.ts:646-689`, `App.tsx:37` |
| P1.3 | **Frontend `manualPositions` = second divergent truth** — 3D-drag only invokes if playing; backend OSC/hold/tape writes never received → cues + .hfg save wrong positions | `useManipulateMode.ts:202-205`, `CuelistPanel.tsx:96`, `persistenceSlice.ts:299` |
| P1.4 | **Cue recall drops `end_mode`/`anchor_mode`** — "hold"/"current" revert to revert/origin (continuous semantics erased) | `cue_commands.rs:694-695` |
| P1.5 | **Full recall clears manual positions without parked filter** — "park survives recalls" false for positions | `cue_commands.rs:556-567` |
| P1.6 | **Freeze/throw seeds post-processed `last_out`** → double-transform when macros ≠ identity | `merge_runtime/mod.rs:1153-1172, 2197-2204` |
| P1.7 | **Run window = frozen copy faking a mirror** — local index/solo not broadcast, writes silently lost, no toasts | `RunWindow`, `PerformView.tsx`, `safeStorage.ts:19` |
| P1.8 | **Stale-kill doesn't clean `move_end_modes`** — Hold wrongly applied if id is reused | `merge_runtime/mod.rs:1743-1782 vs 1110` |
| P1.9 | **Polar distance in 2D** — source on Z emits `dist=0, elev=0` | `osc_sender.rs:391-432` |
| P1.10 | **`emittedPositions` = computed, not emitted** — written before the arm gate; feeds confidence view + `AnchorMode::Current` | `merge_runtime/mod.rs:2198 vs 2419` |
| P1.11 | **Signal store `setContext` restores the boot graph** — session edits lost | `useSignalGraphStore.ts:99,126-142` |
| P1.12 | **Rehearsal `playTimer` overwritten** — 'clear' only cancels the last timer | `liveActions.ts:371-384` |
| P1.13 | **`set_macro` skips `require_finite`** — NaN macro → silent blackout | `playback.rs:40-67` |
| P1.14 | **Dead `loadShowEnvelope` rollback** — pushes catch internally, revert never executed | `persistenceSlice.ts:469-495` |
| P1.15 | **`setVenueConfig` persists before validating yaw** — invalid config stored never sent | `oscConfigSlice.ts:231-237` |
| P1.16 | **`stopMovement` clears `movementPositions['global']`** — flicker with other active moves | `movementSlice.ts:127-148` |

## P2 — Operator inconsistencies

- **GO ≠ cue in conduite** — NOW/NEXT = cues, GO = setlist (invisible
  target) — semantic trap
- **Radar in obj_index vs pads/3D in track_id** — same screen, two
  numberings
- **3 names for disarmed**: LIVE (OscArmToggle) / MUTED / DRY-RUN;
  "LIVE" also has 3 meanings
- **Ack before parse** — invalid commands ACK'd, never NACK'd
  (`osc_receiver.rs:1259-1304`)
- **Backend-busy → no NACK** — `recall_cue` busy → toast only, `from`
  not forwarded
- **`doUnsolo`/`doPark`/`doArm` without recallBusy guard or `from`**;
  `doCueNext/Prev` cancels timers BEFORE the guard
- **Media-sync unreachable without an emitting controller**
  (early-return `controllers.is_empty()`)
- **`doSlot`/`doSolo` fallback `moveSlots[n-1]`** — wrong slot rather
  than nack
- **Asymmetric pad hold** — long-press on a live move = unguarded stop
- **Full CuelistPanel inside PerformView** — delete/store cue while
  playing (contradiction)
- **Inspector "Audio" section renders MacrosSurface** — the title lies
  (copy-paste)
- **OSC-IN suppress during recall** — up to 120s of dead faders, no
  indicator
- **Rehearsal contract drift** — `Rehearsal(String)` Rust vs
  `string|null` TS → CI drift
- **FR/EN mixed** everywhere; stop-fade: 3 different values depending
  on the button
- **Incomplete cue authoring** — no reorder/rename/renumber; `cue_number`
  frozen
- **Dead "Conduite" button in ?view=run**; `performMode` always true at
  boot
- **TC tick during recall disarms a pending timer** (cancelPendingTimers
  before the guard)

## P3 — Tests: what the suite can't see

- **Send-path transforms** (venue yaw/scale/offset, reality, spatial,
  arm gate): **zero backend tests** — `CaptureSink` exists
  (`tests.rs:499`)
- **`EndMode::Hold` + `AnchorMode`**: never instantiated in a test
- **obj_index↔track_id**: all fixtures identity-mapped → `tid−1`
  regression invisible
- **`useLiveShortcuts`**: zero tests
- **`graphMigration`**: old shows → silently broken graphs
- **`safeInvoke` mock**: bypasses `checkTauri`/`BackendError` →
  backend-down paths invisible
- **11/24 ShowCommand variants** tested on the dispatch side
- **Real sleeps everywhere** (CI-load-sensitive); `bench_merge_under_load`
  `#[ignore]`

## Verified correct (to preserve)

- Merge determinism (move_id sort, sorted routing), macros seqlock, NaN
  sanitize
- `catch_unwind` + thread_died + parking + watchdog restart; poisoned-lock
  recovery
- Recall atomicity (CAS + RecallGuard), generation checks, pending
  reservation
- OSC-IN interception + exhaustive parse (26 dispatched variants, real UDP
  ack)
- Documented and respected lock ordering; stale-kill `ptr_eq` guard
- obj_index/track_id namespace respected at verified boundaries

## Reviewer verdicts

- **Live-safety**: "Not show-ready — P0.1, P0.2, P0.5 must be fixed;
  P0.3/P0.4 require at least a visible degradation"
- **Backend**: "Remarkably healthy core (panic containment, determinism,
  locks); all defects are at the edges — manual positions, unhonored
  park/arm/venue promises in panic/recall"
- **Wire/IPC**: "Globally coherent surface; the structural flaw =
  `set_osc_receiver_port` forgetting the receiver is also the
  show-control transport"
- **Frontend state**: "Disciplined architecture; the weakness =
  parallel frontend caches of backend facts (manualPositions the worst)
  + stale config push from the detached window"
- **UX**: "Real 3-phase architecture, serious base safety; the UX betrays
  the operator at the boundaries: GO≠cue, frozen run window faking a
  mirror, non-uniform panic, lexicon"
- **Tests**: "Strong where it covers; blind on the whole wire-transform
  layer, hold/anchor semantics, index conversion and keyboard"

## Proposed remediation plan

- **F0** (first): P0.1 label check · P0.5 armed+venue gates · P0.6
  show_sink migration · P0.4 panic↔recall veto + cancel pending timers
  in panic() — ~1 day
- **F1**: P0.2 backend-side panic · P1.1 manual emit without move ·
  P1.2 detached no config-push · P1.4 end/anchor_mode persist · P1.5
  parked filter — ~2 days
- **F2**: P1.3 manualPositions sync · P1.6 canonical seed · P1.7 detached
  truth (broadcast or honest read-only) · P0.3 liveness probe — ~2-3 days
- **F3**: P2 inconsistencies (lexicon, GO semantics, radar labels, NACK
  completeness) — ~2 days
- **F4**: P3 tests (CaptureSink transforms, hold/anchor, non-identity
  mappings, shortcuts) — ~2 days
