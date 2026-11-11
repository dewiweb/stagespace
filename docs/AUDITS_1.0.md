# Pre-1.0 audits — STAGESPACE

> **Status: audit snapshot (pre-1.0)** — the T1–T7 plan drove the
> robustness work; fixed items aren't re-marked here.

Three independent reviews conducted on `feat/wasm-plugins` (post PR #1):
real-time engine robustness, software architecture, UX/UI.
Each finding references `file:line`. Classification: 🔴 blocking/critical · 🟠 important · 🟡 minor.

## Consolidated action plan

| Tranche | Content | Findings |
|---|---|---|
| **T1 — Anti-blackout** | Recursion/size bounds (validator, compile, CustomTrajectory parser), zombie worker kill, backend-side merge watchdog | B2, B3, C5, C7 |
| **T2 — Unify transforms + macro scope** | Single spatial transforms layer, `Scale` x/y/z bug fix, `Barycenter` no-op, `MoveRef.move_id`, structural Global/PerMove macro scope | A1, A2 |
| **T3 — Predictable engine** | `eval_frame` batch for stateful engines, per-frame time budget, incremental memoization | B1, C4 |
| **T4 — Live UX** | PANIC never inert + prominent, `.live-mode` wired, shared StatusBar, WCAG contrasts, `storeCue` toast | U1-U8, U16 |
| **T5 — Contracts & hygiene** | Single declarative `NodeSpec` (Rust source → ts-rs), typed+versioned `graph_json`/`Cue`, per-variant `IpcError`, dead-path purge | A3, A4, A7, A9 |
| **T6 — Network/audio robustness** | OSC OUT circuit-breaker + bundles, audio reconnect, param bounds (fps/duration/zones) | C6, I12, I15 |
| **T7 — Real-time determinism** | `PositionFn` = `Arc` (swap without frame wait), bounded pump-thread preview callback (JSON off the merge), track_indices mismatch clip + warn×1, hot-swap generation → conflict, caps mappings/zones/modulations, OSC IN without per-non-match allocs | I8, I10, I11, I13, I12, I14 |

---

# 1. Backend audit — real-time engine

Scope: `rust-engines/src/{runtime,merge_runtime,engines,compiler,validator,graph,plugins,position_sink,osc_sender,osc_receiver,audio_capture,position_buffer,kinematics,zones,animation}.rs`, `tauri-app/src-tauri/src/{commands,graph,lib.rs}`.

## 🔴 Blocking

### B1 — Simulation engines: re-simulation from `t=0` per object × frame

`engines/mod.rs:51-89` (caps), `swarm.rs:64-92`, `avoidance.rs:57-89`, `bouncing.rs:52-66`, `follow.rs:101-184`, `spring.rs`, `pendulum.rs`, `vector_field.rs`. Call loop: `runtime/mod.rs:545-597` (`fn_ref(t_looped, obj_idx)` per object).

`position(t, i)` is pure — each call replays the simulation from `t=0`:

- `Swarm`/`Avoidance` simulate **all agents** per call: O(n²·steps) per object → O(n³·steps) per frame. `sim_steps_n2` bounds at ~4M pair evaluations per call — cap reached at **t≈16 s** for n=64; beyond ~0.5–2 s/frame.
- `Bouncing`/`Spring`/`Follow`/`Pendulum`/`VectorField`: O(steps) per object, `steps = min(t·fps, 4M)` → cost grows linearly with t (no bound on duration, cf. I12).

**Live scenario**: a "Swarm 40 sources" cue dies ~15–20 s after activation — the merge stale-kills after 0.5 s, tracks frozen, and the thread keeps running at 100% CPU (see C5).

**Reco**: `eval_frame(t, n_objects) -> Vec<Vector3>` batch for stateful engines (one simulation per frame, not per call) + memoization `(t_last, state)`; short term: `Instant` deadline in the step loop + compile refusal if `n² × duration × fps` exceeds a budget (~10⁸).

### B2 — Unbounded recursion → stack overflow = whole-process abort

`compiler.rs:225-249` (unbounded recursive `compile_node`), `graph.rs:277-298` (recursive `dfs_cycle`), `validator.rs` (no nodes/edges/depth limits), entry `graph_updates.rs:38`/`parser.rs` (unbounded graph_json).

Only `resolve_n_objects_depth`/`resolve_duration_depth` have a cap (64). A stack overflow = **uncatchable** SIGSEGV/abort — total and permanent OSC blackout, `catch_unwind` powerless. Bonus: DAG compiled as a tree without memoization → `Mix(a,a)` per level = 2^depth explosion.

**Reco**: hard bounds at the validator before `has_cycle` (nodes≤512, edges≤4096, DAG depth≤128 iterative, graph_json≤1 MiB at the IPC); iterative `dfs_cycle`; memoize `compile_node` by `NodeId`.

### B3 — `CustomTrajectory`: unbounded recursive parser, re-parsed on every call

`engines/custom_trajectory.rs:107-227`. (a) `position()` re-parses the 3 expressions per object per frame. (b) Graph-supplied unbounded expression: `((((…))))`×10,000 → stack overflow → abort.

**Reco**: parse to AST **at compile** inside the closure; bounds depth ≤64 and length ≤4 KiB; rejection at validation.

## 🔴 Critical

### C4 — Audio/OSC engines: JSON deep-clone + mutex per object × frame

`compiler.rs:993-998` (`params.clone()` + `engine.position` per object), `:1007-1024` (`values.lock()` per OSCInput object), `inject_audio_values` `:1103-1147` (lock + ~15 allocs per call). At 64 objects × 60 fps ≈ 3,800 locks + JSON deep-clones/s per audio node. Possible lock convoy with the OSC IN receiver in bursts.

**Reco**: snapshot **once per frame** (audio_state/osc_values as atomics or `MacroState::snapshot()`-like), single injection, the N objects read the snapshot.

### C5 — Stale-kill: the zombie worker is never stopped → 100% CPU

`merge_runtime/mod.rs:866-874` — the move is removed from the merge but the worker's `Runtime` keeps evaluating into an orphan `PositionBuffer` indefinitely. The UI shows "playing" while the move is muted; purge only on recall.

**Reco**: `stale_moves` queue drained by the poller (or `on_stale` callback) → `runtime.stop()` + `Movement` removal + `active-moves-update` event + "move killed (engine too slow)" toast.

### C6 — OSC OUT: no backpressure, no bundle, no circuit-breaker

`position_sink.rs:63-91`, `merge_runtime/mod.rs:1094-1123`, `osc_sender.rs:460-491` — up to 8 UDP messages per object/frame (~30,000 msg/s at 64 full-channel objects). Dead renderer → `ECONNREFUSED` counted (`osc_refused_perf`) but **never acted on**: encode+send at full tilt indefinitely; Panic delayed by a sweep of failed sends.

**Reco**: circuit-breaker (refused_rate>50% over 2×500 ms → suspend sends, keep merge+preview, probe 1 Hz, `osc-target-down` event, re-arm); `OscBundle` per object (÷8 packets); surface `refused_rate` to the frontend.

### C7 — Merge restart suspended on frontend polling

`merge_runtime/mod.rs:1219-1253` (panic → `thread_died`, origin parking, death), `commands/sampling.rs:38-45` (restart only inside `get_perf_stats` — ~500 ms poll). Frozen/minimized webview → merge dead permanently, OSC blackout.

**Reco**: backend watchdog (thread/`async_runtime`, checks `thread_died` every 250 ms → `start()`), `merge-restarted` event for toast; consider `continue` with parking frame instead of death when `has_active_moves()`.

## 🟠 Important

### I8 — `position_fn` mutex held for the entire frame evaluation

`runtime/mod.rs:545-597` — `swap_position_fn`/`recall_cue`/`sample` wait for the full frame to end. Engine at cap (B1) → recall delayed by seconds.

**Reco**: `Arc<PositionFn>` + atomic swap (`arc_swap` or per-object Arc clone) — effective at the next object, never a wait.

### I9 — Each fade doubles the evaluation cost for its duration

`runtime/mod.rs:696-708` — `from_fn` + `to_fn` per object. Transitions (the exposed moment) double the cost — ×4 with Crossfade internal + recall fades stacked.

**Reco**: measure/document; prefer merge-level fade (`MoveState` fade exists, `merge_runtime/move_state.rs:101`) over double eval.

### I10 — JSON serialization of the `global-positions` callback on the merge thread

`move_management.rs:387-400`, `merge_runtime/mod.rs:1136-1151` — ~4 KB/frame at 64 objects, ~60 KB/frame at 1024 (3.6 MB/s of JSON produced on the real-time thread).

**Reco**: throttle emit ~20 Hz (1 frame/3) or a dedicated thread fed by a bounded channel (drop if full).

### I11 — `track_indices.len() != positions.len()` mismatch → move skipped every frame + warn×60/s

`merge_runtime/mod.rs:905-918` — persistent window possible (`update_move_graph_merged` `graph_updates.rs:79-96` sequences `update_move_routing` and `set_osc_ids` non-atomically on the worker side).

**Reco**: rate-limited log (1×/move); clip to `min(len)`; push `osc_ids`+`track_indices` as an atomic pair (`RwLock<(Vec<u32>, Vec<usize>)>`).

### I12 — Params without upper bound: `fps`, `duration`, zones/modulations/mappings

`compiler.rs:1040-1056` (`duration`/`fps` only finite>0 — `fps=10000` → a 10 kHz worker), `channels.rs:97-115,174-206` (uncapped Vec), `osc_receiver.rs` uncapped `add_mapping`.

**Reco**: clamp `fps≤240`, `duration≤86,400 s`, zones≤64, modulations≤64, mappings≤256 — explicit validation errors.

### I13 — Hot-swap: generation mismatch → apply-with-warn instead of aborting

`graph_updates.rs:51-56` — the graph compiled for the old context is applied to the new worker (divergent n_objects/tracks → muted objects or phantom agents, silently).

**Reco**: generation mismatch → `Err(conflict)`; the frontend retries the edit.

### I14 — OSC IN: O(mappings) with allocations per message

`osc_receiver.rs:657-671` (`match_address` allocates 2 `Vec<&str>` + `String` per mapping per message), `:757-860` (`mappings.read()` held for the whole dispatch).

**Reco**: pre-split patterns into segments at `add_mapping`, `String`-free captures, mappings cap (I12).

### I15 — Audio device loss: fatal, no reconnection, mods silently frozen

`audio_capture.rs:567-576` (`running=false`, TODO auto-reconnect), `commands/audio.rs:96-100`. BPM/amplitude frozen on last values.

**Reco**: backoff retry in the capture thread (re-enumeration ~2 s) + sticky toast + `AudioState.stale_since` → neutrality >1 s.

## 🟡 Minor

| # | File | Finding |
|---|---|---|
| M16 | `move_management.rs:577-583,622-630` | One dormant `thread::spawn` per deactivation fade — unbounded → `async_runtime::spawn` + `sleep` |
| M17 | `runtime/mod.rs:398-420,518-521`; `merge_runtime/mod.rs:812-815,880,983-990`; `swarm.rs:78-92` | ~10-15 allocs/frame/worker; swarm/avoidance 3 Vecs × n per call — persistent buffers, `Arc` snapshots |
| M18 | `runtime/mod.rs:574-577` | `catch_unwind` per object → panic hook writes stderr on every panic (N×60 lines/s, possible pipe blocking) → rate-limit |
| M19 | `position_buffer.rs:36-54` | positions and `frame_count` under 2 mutexes → torn read → `Mutex<(Vec,u64)>` or seqlock |
| M20 | `osc_sender.rs:262-344` | `String::clone()` per message for the address → `&str`/`Arc<str>` zero-alloc |

## Already solid (don't break)

- **Exemplary Wasmtime sandbox**: `StoreLimits` (32 MiB memory), fuel re-armed on each eval, pointer bounds vs `data_size`, traps→zeros + log-once, zero imports, memory64 refused, bundle/manifest/module caps.
- **Merge**: per-frame catch_unwind, `thread_died`/`merge_frames`/`dropped_positions` observables, origin parking, paced idle, anti-burst re-anchoring.
- **Workers**: `ClearRunning` RAII, CAS double-spawn, idempotent `stop()` + join in Drop, per-object catch_unwind.
- **Locks**: short documented critical sections, callbacks emitted outside locks, `Arc` COW snapshots, macros seqlock, `try_lock` audio callback, systematic `lock_or_recover`.
- **Move lifecycle**: `pending_move_ids` + generations, reservation cleanup, recall `AtomicBool`+RAII, OSC anti-loop, visible `failed_moves`, phantom purge.
- **OSC IN**: socket timeout, new-before-old rebind, bundles ≤8 levels, playback guards.
- **Sanitization**: non-finite positions dropped+counted, `finite_or_zero`, inverted min/max clamps.
- **Audio**: FFT buffers pre-allocated outside the callback, 10 Hz publication under `try_lock`, bounded init.
- **Tests**: 381+37 including sharp regressions — "it broke live, write the test" culture.

---

# 2. Architecture audit

Scope: `rust-engines/`, `tauri-app/src-tauri/`, `tauri-app/frontend/`. Static review (no tests executed).

## 🔴 Critical

### A1 — Triple divergent implementation of the transforms pipeline

`runtime/mod.rs:750-802` (worker `move_transform`: radius_scale→height_offset→fade→scale→rotation→+origin+shift), `merge_runtime/helpers.rs` (`default_post_process_fn`), `post_process_compiler/transforms.rs:95-233` (compiled chain).

Observed divergences:
- `compile_scale` (`transforms.rs:98-104`): `scale` param used **only if macro ≠ 1.0** — "macro 1.0 overrides param 0.5" inexpressible. **Current bug**: the global UI schema exposes `x/y/z`, the compiler reads `scale` → user params ignored.
- `compile_rotate` (`:115-128`): two simultaneous conventions (`yaw/pitch/roll` degrees + `angleX/Y/Z` radians).
- `Barycenter` compiles to a **silent no-op** (`:235-241`).
- `MoveRef.move_id` never read — the node is decorative; Scale after MoveRef applies to all merged positions.
- `compile_clamp` (`:321-341`): scalar `min`/`max` OR `min_x…max_z` — two schemas.

**Reco**: a single layer (the compiled post-process — in the graph, so editable/serializable); remove `default_post_process_fn` or generate it from the same spec; typed `ParamSource` for the macro↔param fallback; unique params convention per NodeType.

### A2 — Spatial macro scope: two opposing models reconciled by comments

`move_management.rs:44-51,451` (spatial macros excluded from the request), `animation.rs:66-70,111-120` (macros at the **worker**), `useAnimationStore.ts:189-196` (frontend neutralization to avoid double transform), `moveSlotsSlice.ts:701-724` (macros at the **merge**).

`launchAnimation` and `playSlot` give different semantics to the same object. `set_macro` writes `speed` on the merge while speed is documented per-move.

**Reco**: structural scope — either always global (remove `SpatialMacroInit`+worker setters), or per-move; at minimum `MacroScope::{Global,PerMove}` + refusal of out-of-scope fields in `update_animation_state`.

### A3 — Node catalog replicated across ≥6 sites in 2 languages — already drifted

`validator.rs:970-1047`, `transforms.rs:20-37`, `compiler.rs:901-976`, `connectionRules.ts`, `nodeParamSchema.ts`, `moveSlotsSlice.ts:121-128,230-237` (two nearly identical lists in the same file), `types/index.ts:12`. The `Scale` drift (A1) is the proof.

**Reco**: single declarative `NodeSpec { node_type, context, ports, params, category }` table in Rust → ts-rs/JSON export consumed by validator, compiler, post_process_compiler, connectionRules, nodeParamSchema, palette. Most profitable refactor before groups.

### A4 — Untyped `graph_json` on the wire; schema-less params; versionless `Cue`

`graph.rs:137-143` (`params: serde_json::Value`), `move_management.rs:28` (`graph_json: Value`), `cue_commands.rs:32-47` (`#[ts(type="unknown")]`), `parser.rs` (ad-hoc parsing), `cuelist.rs` (`Cue` without `version`).

**Reco**: typed `GraphDocument { format_version, nodes, edges }` + ts-rs export; param validation against `NodeSpec` at the boundary with surfaced warnings; `Cue.version`.

## 🟠 Important

### A5 — `MergeRuntime` god-object (~15 responsibilities)

`merge_runtime/mod.rs:80-144` — merge, MacroState, AudioState, origin, osc_ids, track_depths, strategy, PerfMonitor, Tauri callback, PositionSink, post_process_fn, track_positions, manual_positions, object_channels, channel_modulations, kinematic_smoothing, zones ×2, graph_modulations + zombie reaping + clock catch-up.

**Reco**: extract `PostFxRegistry` (zones+modulations+channels+depths) and `MoveTable` (buffers+states+reaping); the loop keeps merge→post_process→sink. (`PositionSink` injectable = good seam for renderers.)

### A6 — The frontend orchestrates runtime coherence invariants

`moveSlotsSlice.ts:26-49` (client-side computeTrackIndices while `resolve_track_indices` exists backend), `useManipulateMode.ts:57-59,202-204` (double write), `persistenceSlice.ts:311-524` (`.hfg` restore = 7 sequential IPC with non-atomic partial rollbacks), `useGlobalGraphStore.ts` (`update_global_graph` + `set_global_origin` in 2 non-atomic IPC), `useAnimationStore.ts:480-485` (implicit cross-store subscribe).

**Reco**: transactional backend `restore_show` command; group update_global_graph+origin; slices must not know lock ordering or compensation protocols.

### A7 — `IpcError::classify`: classification by string sniffing

`commands/error.rs:74-103` — `code` derived from lowercase substrings; renaming an internal message = silent breaking change of the wire contract.

**Reco**: internal typed `StagespaceError` → per-variant map to `IpcError`; delete `classify`.

### A8 — Poorly placed boundaries for testing

`compile` requires `LiveInputs.plugins` (wasmtime) to **validate** a plugin graph; `Compiler` imports runtime infra; no `rust-engines/tests/` integration (graph_json contract, golden `.hfg` untested); commands mix parse+compile+locks+spawn; slices mix state/IPC/localStorage.

**Reco**: separate pure `validate(graph, catalog)` from `resolve_plugin_kinds`; pure `build_graph_from_json` tested on fixtures; round-trip contract tests. Prerequisite for refactors A1-A3.

### A9 — Dead and legacy paths

Root `frontend/` = a complete **abandoned** React app; `overrides.rs:8-22` `set_object_override` registered never called; `sampling.rs:64-81` `sample_trajectory` always returns `[]`; `compiler.rs:78-84` `_overrides` ignored "for compat"; `playback.rs:9-13` comment of a removed path.

**Reco**: purge before 1.0 — a command without a caller = deleted or `#[deprecated]`+issue.

## 🟡 Minor

| # | File | Finding |
|---|---|---|
| A10 | `transforms.rs:58-60`, `graph_updates.rs` | Global graph = linear list disguised as DAG (Zone/Velocity extracted, Merge→strategy, Input→terminus) — DAG constructible but silently truncated → constrain the UI or give real branch semantics |
| A11 | `moveSlotsSlice.ts:243-251` vs backend | Two reconcilers of active moves (pendingPlays, fading, orphans) → backend = single source (`list_active_moves`+event), frontend = TTL cache |
| A12 | `sampling.rs:100-132` | Confused local vs global index, two `usize` → newtypes `LocalIndex`/`GlobalTrackIndex` |
| A13 | `compiler.rs` 1148 l., `validator.rs` 1047, `merge_runtime` ~1200, `moveSlotsSlice.ts` ~960 | At the legibility threshold — the `NodeSpec` table mechanically absorbs half |

---

# 3. UX/UI audit

Scope: `tauri-app/frontend/src`. References: DAWs/live consoles (QLab, Bitwig, TouchDesigner, SPAT).

## 🔴 Blocking / Critical

### U1 — PANIC in Perform inert without indication during a recall

`PerformView.tsx:124-128` — `if (isRecalling) return;` silent: the button looks active, nothing happens. And `Esc` always panics (`useLiveShortcuts.ts:35-51` doesn't check `isRecalling`) → button/shortcut inconsistency.

**Fix**: panic never blocked (it must survive all states); otherwise `disabled` + "RECALLING…"; panic must cancel/await the recall on the store side.

### U2 — PANIC undersized vs GO

`PerformView.tsx:115-133`: GO `px-8 py-2.5 text-lg font-black` vs PANIC `px-5 py-2.5 text-sm`; `Toolbar.tsx:202-208`: PANIC `text-xs` = same weight as the adjacent Undo button. On a show console, the emergency stop dominates.

**Fix**: `px-6 py-2.5 text-lg font-black ring-2 ring-red-400/60` in Perform; Toolbar `ring-1 ring-red-500` + separator.

### U3 — `.live-mode` = dead CSS

`index.css:134-162` defines the live enlargement (14px font, `.text-[10px]`→12px) — **never applied** (0 occurrences). 2 m legibility is broken.

**Fix**: apply on the PerformView container (`:66`); ⚠️ `.live-mode .px-3` too broad — restrict to text.

### U4 — Live hierarchy all in 10px, illegible at 2 m

`PerformView.tsx:75-77` status `text-sm`; `:95-102` "Setlist 1/5"+next `text-[10px] gray-500` — the NEXT cue is the most-watched info in show → `text-2xl font-bold` (QLab model); `:179-197` slots `text-xs`, meta gray-600 (~2.6:1); `:216` cue list fixed `h-56` (~6 cues), `text-[11px]` rows.

**Fix**: big-type "NOW/NEXT" zone in the top bar; slot names `text-base`; cue rows `py-3 text-sm`; resizable panel.

### U5 — No FPS/OSC/CPU indicator in Perform

`Toolbar.tsx:223-235` unmounted in Perform; PerformView only has `oscRate` in `text-[10px]` (:78-88), nothing at 0 moves. Dead merge thread = one toast then silence.

**Fix**: persistent perf chip in Perform top bar (`{fps} fps · {oscRate} osc/s` font-mono `text-xs`), red if `oscErrorRate>5%` or `threadDied` + blinking.

### U6 — Compile/play error banner invisible in Perform

`Toolbar.tsx:239-244` unmounted in Perform — hot-swap error = ephemeral toast only.

**Fix**: error banner hoisted into `App.tsx` (shared by both modes).

## 🟠 Important

### U7 — Contrasts systematically below WCAG AA

`gray-700`/`gray-600` on `#12121a`/`#0a0a0f` backgrounds ≈ 1.9–2.6:1 (4.5:1 required); **337 occurrences** of `text-[9-11px]`. E.g.: `App.tsx:180` tagline, `NodeEditor.tsx:635-640` flows help, `Toolbar.tsx:218` invisible `text-[9px] gray-700` version.

**Fix**: `tailwind.config.js` tokens (`ss-dim #9ca3af`, `ss-faint #6b7280` decorative only); gray-400 floor for all informative text.

### U8 — Click targets < 24px outside Perform

`MovesTable.tsx:428-487` ~20×20px actions, `:391-411` ▲▼, `CuelistPanel.tsx:211-220`, `CustomNode.tsx:254-260`, `w-1.5` splitters (6px grab, `App.tsx:285,410`), `h-1.5` track sliders (`ui/Slider.tsx:66`).

**Fix**: min 24px everywhere; thick slider thumb; `w-2` splitters + widened hover zone.

### U9 — `ui/IconButton` never adopted

`ui/IconButton.tsx` created to standardize ~30 instances — 0 usage outside tests; ad hoc variations everywhere.

**Fix**: adopt (Toolbar, MovesTable, CuelistPanel) or delete.

### U10 — Double status indicator with divergent labels

`App.tsx:158-169` ("N live") vs `Toolbar.tsx:89-101` ("N movements"+"Compiled") — two status points ~50px apart, different words.

**Fix**: shared `StatusDot`, merge.

### U11 — No visible focus on buttons

31 `focus:border-*` on inputs, **zero** `focus-visible:ring` on buttons; `useLiveShortcuts.ts:127-132` blur()s clicked buttons.

**Fix**: `button:focus-visible { outline: 2px solid #3b82f6 }` in `index.css`.

### U12 — Mixed Unicode glyph / Lucide iconography

`◼` (Toolbar:207) vs `■` (PerformView:132) vs `TriangleAlert` (Inspector:553) — three renderings of the same emergency stop; `◉/◎/★/▶/▸/▾/↻` mixed with lucide-react.

**Fix**: Lucide everywhere (`OctagonX`/`Square` panic, single identity).

### U13 — Residual FR/EN bilingualism

`ConfirmModal.tsx:29` "Annuler", `MovesTable.tsx:537-541` "Nom du cue", `AnimationList.tsx:166` "Sauvegarder dans ma bibliothèque", `Inspector.tsx:425,431` "Vitesse/Fondu", `PerformView.tsx:364,372` "tap un move"/"édition :", `MovesTable.tsx:394` "Monter dans la setlist".

**Fix**: all EN (DAW convention) + string extraction if i18n is planned.

### U14 — Opaque "Sub-graph" vs "Global"

`NodeEditor.tsx:404-425` — `text-[10px]` tabs without tooltip or explanation; "Sub-graph" is internal jargon.

**Fix**: rename `Move graph`/`Master FX` + titles + "applies to all live moves" hint on the global tab.

### U15 — Invisible pin-to-Perform

`NodeParamsPanel.tsx:164-176` — nearly invisible `text-gray-700` toggle, discoverable only on hover.

**Fix**: pin `gray-500` min; hint in the Perform empty state ("📌 icon on each field in Edit").

### U16 — `storeCue` fails silently

`CuelistPanel.tsx:87-89` — catch → `console.error` only; an unrecorded cue in show = invisible catastrophe.

**Fix**: `toast.error(...)`.

### U17 — `ConfirmModal`: lying comment

`ConfirmModal.tsx:5` claims "Enter = confirm" but `Modal` focuses the first focusable = "Cancel" → Enter cancels (safe but wrong doc).

**Fix**: `autoFocus` on confirm or fix the comment.

### U18 — Autopatch: weak affordance

`NodeEditor.tsx:166-170,453-456` — `text-[11px] gray-500` hint in palette; the selected edge keeps the generic blue stroke (`index.css:70`).

**Fix**: `.rf-edge-insert-target` class (animated cyan dash) + persistent "INSERT MODE" badge.

## 🟡 Minor / Polish

| # | File | Finding → fix |
|---|---|---|
| U19 | `App.css` (all) | Dead Vite boilerplate conflicting with `index.css` (`#root`) → delete |
| U20 | `Modal.tsx:83` | Close button = `✕` character → Lucide `<X/>` |
| U21 | `App.tsx:188-207` | Perform toggle shows state (◉ Perform) — ambiguous action vs state → fixed label + on/off state |
| U22 | `TrackGrid.tsx:31,34-41` | `'pairs'` in the type but absent from `PATTERNS`; `icon` never rendered → dead code |
| U23 | `App.tsx:331` | `DEBUG PERF` toggle visible in prod → `import.meta.env.DEV` or Settings |
| U24 | `Inspector.tsx:545-547` | "Launch via MovesTable ▶" permanently dead zone → real action link or nothing |
| U25 | `PerformView.tsx:104-112` | GO feedback `text-[10px]` — a live GO error deserves `text-sm font-bold` |
| U26 | `useLiveShortcuts.ts:111` | `toast.info('No move selected…')` pattern to generalize |
| U27 | `App.tsx:337` | "orbit: drag · zoom: scroll" hint `text-[10px] gray-600` → gray-500 |

## Cross-cutting recommendations

1. Wire `.live-mode` on PerformView — quick win for all live type.
2. Shared `StatusBar` (dot + label + FPS/OSC/CPU + errors) mounted in
   `App.tsx`, Edit **and** Perform — solves U5, U6, U10.
3. Semantic tailwind tokens (`ss-text/ss-dim/ss-faint/ss-live/ss-warn/
   ss-panic`) + `gray-600/700`→`ss-faint` sweep.
4. Perform type: NEXT `text-2xl`, slot names `text-base`, LIVE `text-lg`,
   cue rows `py-3` — 2 m legible target.
5. Single PANIC identity (Lucide `OctagonX`+label, `ring-2`), never
   inert, brief red flash overlay.
6. All EN, extracted strings.

---

# §4 — UI architecture audit (arrangement, layouts, windows)

> Structural audit — distinct from §3 which listed point defects.
> Here: the **relevance of the layouts** against real workflows
> (preparation vs live operation).

## Current mapping

### Edit mode (preparation)

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER (48px)  logo · status dot · [Perform] toggle · [Expert]      │
├──────────────────────────────────────────────────────────────────────┤
│ TOOLBAR (36px)  .hol · OSC chip → Settings · undo/redo · save/load  │
│                 · help · PANIC · status · version · perf band        │
├────────┬──────────────────────────────────────────────┬──────────────┤
│ LEFT   │ CENTER                                       │ RIGHT        │
│ 256px  │ ┌─ NodeEditor (expert, split 50%) ─────────┐ │ 288px        │
│        │ │ tabs Sub/Global · palette w-60 · canvas  │ │ ┌──────────┐ │
│ SHOW   │ └──────────────────────────────────────────┘ │ │ AudioPan │ │
│  Moves │ ┌─ Scene3D (always mounted) ────────────────┐│ │  max-40% │ │
│  Cues  │ │ canvas + ad-hoc overlays (z-10..z-30)    ││ ├──────────┤ │
│  FX    │ └──────────────────────────────────────────┘│ │          │ │
│────────│                                              │ │ Inspector│ │
│TEMPLATES│                                             │ │ (Sections│ │
│ (h-80  │                                              │ │  ×~8)    │ │
│  fixed)│                                              │ │          │ │
└────────┴──────────────────────────────────────────────┴─┴──────────┴──┘
        ↕ 5 resizable zones (left, right, expert split, expand×2)
```

### Perform mode (operation)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOPBAR (60px)  status+slots+recall │ NEXT set name │ GO 180px │PANIC│
├──────────┬───────────────────────────────────────────────────────────┤
│ LEFT w-72│ CENTER — Scene3D (the sole survivor of Edit mode)        │
│ ┌──────┐ │                                                           │
│ │MOVES │ │                                                           │
│ │list  │ │                                                           │
│ ├──────┤ │                                                           │
│ │CUES  │ │                                                           │
│ │h-56  │ │                                                           │
│ └──────┘ │                                                           │
├──────────┴───────────────────────────────────────────────────────────┤
│ LIVEDRAWER (≤42vh)  Params/Audio/Global chips + scope drawers       │
└──────────────────────────────────────────────────────────────────────┘
```

## Global verdict

**The bones are good** — the 3-column model (library | canvas | inspector)
is the proven convention of pro DAWs and node-editors (TouchDesigner,
Blender, Pd/plugdata), and Perform is a surface deliberately hostile to
destructive actions: the right intuition. **But 6 architecture choices
go against real show usage.**

## 🔴 Structural misfits

### A1 — No StatusBar: vital information scattered across 4 places

- Header: dot + status (`statusColor`/`statusLabel`, `App.tsx:172`)
- Toolbar: label + perf band (`Toolbar.tsx:211-235`)
- Perform: another dot + perf implementation (`PerformView.tsx:204-262`)
- Errors: banner under Toolbar only → **invisible in Perform**

Result: vital info (dead merge, play error, collapsing FPS) only exists
in components that Perform **unmounts**. The pro model = a StatusBar
**persistent at the bottom of the window, mounted in App** (monitoring
console: engine status + FPS/OSC/CPU + last error event) — surviving all
modes. That's the Resolume/QLab pattern.

**Fix**: shared `StatusBar` component in `App.tsx`, Edit and Perform
modes — solves U5/U6/U10 in one go. The Perform topbar keeps the
*setlist* context, the statusbar keeps the *engine* context.

### A2 — PANIC: two implementations, two glyphs, two sizes — and inert

- `Toolbar.tsx:202-208`: `◼ PANIC` `text-xs` — discreet
- `PerformView.tsx:335-345`: `■ PANIC` `text-sm`, **smaller than GO**
  (`text-lg font-black` 180px), and `if (isRecalling) return;` = mute
  during ~1s of recall — exactly when you need it
- `Esc`: a third path (which does panic during a recall)

On a show console, the emergency stop is the **most prominent control
on the surface** — the mushroom button equivalent. Here it's at best a
peer of GO, at worst a ghost.

**Fix**: single `PanicButton` component (Lucide `OctagonX` + red ring +
≥ GO in prominence), used by both modes, **never inert** (panic must be
able to stack on a recall — the backend is idempotent), brief red flash
overlay on trigger.

### A3 — `.live-mode`: the "2 m legible" mechanism exists but is never wired

`index.css:134-162` defines the type/button enlargement for live — no
component applies the class. Perform mode is therefore rendered in
`text-[10-11px]` = the same density as graph editing, illegible at
operator distance.

**Fix**: `className="live-mode"` on the `PerformView` root (+ verify the
`!important`s cover the real Tailwind classes) — massive quick win.

### A4 — Perform: the setlist isn't a *view* — it's an attribute

`PerformView.tsx:507` — the setlist order is a small `set N` badge in
the move rows. There's **no visual flow**: the next's name is in the
header 400px from the GO button, progression only visible via `x/y` in
`text-[10px]`. In live, the question is *"where is the show, what fires
at the next GO"* — the UI answers in crumbs.

**Fix**: dedicated setlist zone (left column or vertical banner) —
ordered list, current item prominent, **next displayed on/above the
GO** like on lighting consoles/QLab.

### A5 — The right column: AudioPanel permanently crushes Inspector

`App.tsx:424-438` — AudioPanel is a fixed `max-h-40%` zone above the
Inspector. Yet AudioPanel is a **config/monitoring** panel (input
device, spectrum) while Inspector is the **work panel** (params of the
selected slot/node, track grid, macros — ~8 collapsible sections). In
practice: a consultative panel occupies up to 40% of the main tool's
height, permanently.

**Fix**: AudioPanel becomes a collapsible section (or a tab) of the
right column — not a fixed tenant. The Inspector gets the height back
when audio isn't being manipulated.

### A6 — NodeEditor palette vs QuickAddModal: two competing mechanisms

`NodeEditor.tsx:447` — the palette is a fixed `w-60` column (240px)
*inside* the editor panel. In 50% expert split on a 1280px screen, the
React Flow canvas only has ~200 usable px left. Since T4, the
`QuickAddModal` (Ctrl+K, searchable, tab-filtered) covers the same need
better — the palette is only justified by initial discoverability
(hover → description).

**Fix**: collapsible palette (~40px icon rail collapsed by default in
expert), or replaced by QuickAdd + a first-run onboarding. The canvas
goes from ~200px to ~600px usable.

## 🟠 Arrangement inconsistencies

| # | Finding | File |
|---|---|---|
| A7 | **Left "Show" vs "Templates"**: Templates (AnimationList) = *how moves are created*; the section compresses into fixed `h-80` while Moves/Cues/FX have tabs. On small screens Templates eat the moves list. → proportional flex sections, not fixed | `App.tsx:280-299` |
| A8 | **Inspector changes identity by mode** (slot params in simple / node params in expert) but the AudioPanel above doesn't — contradictory visual context in the same column | `Inspector.tsx`, `App.tsx:427` |
| A9 | **Ad hoc z-index**: toasts `z-9999`, modals `z-50`, context menu `z-[100]`, palette tooltips `z-50`, Scene3D overlays `z-10/15/20/30`, autopatch banner `z-50`. No named scale — the first stacking conflict will be an invisible bug | whole front |
| A10 | **`editingSlotId` = 2 semantics**: "NodeEditor's graph" in Edit, "slot whose drawer shows params" in Perform. Implicit coupling between modes — an editing reset in Edit changes the Perform selection without the user asking | `useGraphStore`, `PerformView.tsx:44` |
| A11 | **Hand-stacked Scene3D overlays**: draw canvas z-10, manipulate z-15, ModeButtons/MacrosPanel/moves indicator/empty-state/DebugPerf at z-20-30 absolute — 8 absolute layers without a central registry | `Scene3D.tsx:216-291` |
| A12 | **No "console" surface**: per-move OSC monitoring, per-engine state, network traffic — scattered between header perfStats, Scene3D chips, toasts. A Monitor panel (or tab) would consolidate live diagnostics | absent |
| A13 | **Duplicated Toolbar PANIC + PerformView PANIC** — 2 implementations; even fixing A2, a single component is needed so the semantics can't diverge | `Toolbar.tsx`, `PerformView.tsx` |

## 🟡 Single window — ceiling reached

Everything fits in one Tauri window (header + toolbar + 3 columns +
drawer). At 1080p it works; the pro pattern for live would be a
**detachable "Stage view"**: fullscreen Scene3D + minimal status on a
2nd screen (Resolume output monitor, SPAT Room view). Via Tauri, a
separate `WebviewWindow` listening to the same stores — post-v1 target.

## ✅ What's already well architected — don't break

- **Scene3D always mounted** at the same DOM point — no WebGL reset on
  resize or mode switch (`App.tsx:367` explicit comment)
- **modalGuard stack** — Esc in a modal never panics; the overlay
  mechanics are healthy
- **Perform = surface hostile to destructive actions** — no node
  editor, no OSC config, no delete — good instinct
- **Toasts `z-9999` role=alert assertive** — survive all modes
- **Palette → hover descriptions, autopatch, quick-add** — node
  discoverability already at pro level
- **Explicit canvas empty-state** ("+ Move · template · ▶") —
  in-context onboarding

## §4 Synthesis

| Priority | Item | Effort |
|---|---|---|
| 🔴 | A3 `.live-mode` wired — 2 m legibility | Trivial |
| 🔴 | A2 `PanicButton` single never-inert | Low |
| 🔴 | A1 shared `StatusBar` Edit/Perform | Medium |
| 🔴 | A4 setlist = dedicated view + next on GO | Medium |
| 🟠 | A5 AudioPanel → collapsible | Low |
| 🟠 | A6 palette → rail/quick-add | Medium |
| 🟠 | A7 Templates proportional | Low |
| 🟠 | A9 z-index tokens | Low |
| 🟡 | A12 Monitor console | Post-v1 |
| 🟡 | Detachable stage view | Post-v1 |

These items add to the existing **T4** tranche (PANIC/contrast/
StatusBar) — A1-A4 are its foundations, A5-A7 the density adjustments
that don't break the current structure.
