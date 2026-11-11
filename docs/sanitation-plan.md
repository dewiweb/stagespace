# Sanitation plan — architecture & modularization

> **Status: largely implemented (2026-11).** Phases 0–5 + the >1200-line
> catch-up are done — kept as the record of the modularization work.
> `.devin/rules/modularisation.md` remains the active rule.

2026-11 audit (`refactor/typed-ports` branch). Global structure is
coherent; two work tracks: root hygiene + modularization of large files
(rule `.devin/rules/modularisation.md`: >800 priority, >1200 critical).

Order: from safest/fastest to riskiest. Each phase is an independent
deliverable (commit + full verification before moving on).

**State as of 2026-11-09: phases 0–5 done + >1200 catch-up done.**
`compiler.rs` 1569 → `compiler/` 7 files (mod.rs 322) and
`merge_runtime/loop_core.rs` 1510 → 1118 (+ frame_helpers.rs, emit.rs).
Phase 6 remains (medium size, opportunistic).

---

## Phase 0 — Ongoing release (prerequisite)

| # | Action | Status |
|---|--------|--------|
| 0.1 | CI PR #5 green (fmt fixed by `ebf5365`) | ✅ done |
| 0.2 | Merge `refactor/typed-ports` → `main` | ✅ done |
| 0.3 | Version bump 0.4.2 → **0.5.0** (3 files: package.json, Cargo.toml, tauri.conf.json) — 250+ refactor commits justify the minor | ✅ done (`70a2f53`) |
| 0.4 | Tag `v0.5.0` + push → release CI | ✅ done |
| 0.5 | Watch release CI (builds + artifacts) | ✅ done |

## Phase 1 — Root hygiene (~30 min, zero risk) — ✅ `16b246a`

| # | Action | Detail |
|---|--------|--------|
| 1.1 | Orphaned docs → `docs/` | `ARCHITECTURE_FUTURE`, `AUDITS_1.0`, `PLUGINS_WASM`, `RESEARCH_STATE_OF_ART`, `ROADMAP_GRAPH_GLOBAL` (5 × 16-54k at root, predate docs/) — `git mv` + fix internal links |
| 1.2 | `bindings/` cleanup | Single `nodeSpecs.json` — check if still referenced (grep `bindings\|nodeSpecs`); otherwise delete the folder |
| 1.3 | `_archive/` decision | Full Python/Electron predecessor — kept as-is (excluded from builds) |
| 1.4 | `.gitignore` audit | Check that venv/results/artifacts aren't lying around |

## Phase 2 — `components/` regrouping (~1h, low risk) — ✅ `d08cd3d`

The mixed flat+dirs pattern (subdirs `jeu/ conduite/ editor/ perform/ show/ ui/`
next to 30 flat files). Regroup by existing family:

| New dir | Files |
|---|---|
| `viewer3d/` | Scene3D, TrajectoryVisualization, ZoneVisualization, ObjectInspectBar, ModeButtons, DrawModeOverlay, DebugPerfOverlay, MacrosPanel, ManualReleaseBar |
| `panels/` | CuelistPanel, MovesTable, SpatialFxPanel, ScorePanel, ShowLogPanel, AnimationList, AudioPanel, NodeParamsPanel |
| *(already ok)* | `jeu/` Radar2D · `conduite/` · `editor/` · `perform/` · `show/` · `ui/` |

Method: `git mv` + fixed relative imports (tsc + tests + build per
sub-batch, not all at once).

## Phase 3 — Second Scene3D + useRenderLoop modularization (~2h) — ✅ `193320f`

Regression: Scene3D was 232l after phases 1-3, now **601**;
useRenderLoop **609**. Handlers grew back into the component.

| Extraction | Contents |
|---|---|
| `useScenePicking.ts` | `pickObjectIndexAt` + `zoneRaycast` + `zoneIndexAt` + NDC helpers (~120l) |
| `useZoneGestures.ts` | handleZoneEdit{Down,Move,Up,Wheel} + handleZonePlaceDown (~150l) |
| `useSceneGestures.ts` | handleScenePointerDown/Up (release + tap-select) + handleAssignDown (~80l) |
| `SceneOverlays.tsx` | interaction overlays JSX (zoneEdit/place/assign/manipulate) (~90l) |
| `useHandleTrajectory.ts` | the render loop's trajectory-line section (~60l) |

Target: Scene3D ~200l of pure orchestration, like after phases 1-3.

## Phase 4 — `merge_runtime/mod.rs` 3075l (main track) — ✅ `cb6e45f`, `49f289b`, `9f997c0`

The codebase's biggest file. `transition.rs` already extracted; the rest
is a monolith: merge loop, OSC emission, channel eval, zones,
lock-profiling, state.

| Proposed sub-module | Estimated contents |
|---|---|
| `merge_runtime/loop_core.rs` | main loop + tick scheduling |
| `merge_runtime/osc_emit.rs` | send_positions, send_channels, throttle |
| `merge_runtime/channel_eval.rs` | apply_zones + effective channels + modulations |
| `merge_runtime/zone_transform.rs` | positional effects (ZoneEffect ∇SDF) |
| `merge_runtime/lock_prof.rs` | timed_lock! + sites + profiling |
| `merge_runtime/state.rs` | MergeRuntime struct + builders |

Approach: mechanical extraction one section at a time, stable
`pub(crate)` boundary, `cargo test --lib` after each extraction (519
guard tests).
**Risk: medium** — touching the live loop requires the full test suite.

## Phase 5 — `osc_receiver.rs` 2441l — ✅ `cbeaea1` (merged `6700a87`)

OSC IN monolith: parsing, mappings, show-control, anti-loop, feedback.
Result: `osc_receiver/` = mod.rs 612 + pipeline.rs 365 + show_control.rs 353
+ types.rs 293 + tests 590 + show_control_tests 237. Green suite (539 tests).

## Phase 6 — Medium size (800-1200, opportunistic) + critical catch-up

Handle when touching them for something else (no dedicated track):
~~`compiler.rs` 1569~~ ✅ · ~~`loop_core.rs` 1510~~ ✅ 1118 ·
`node_spec.rs` 1439 (coherent definitions — probable exemption) ·
`validator.rs` 1111 · `runtime/mod.rs` 1082 · `merge_runtime/tests.rs` 1078 ·
`cli/commands/moves.rs` 933 · `audio_capture.rs` 922 · `osc_sender.rs` 829 ·
`signal_compiler.rs` 818 · `cue_commands.rs` 762 · `moves/SpatialFxPanel/NodeEditor/App` 600-700.

Tests >1200 (`validator_tests`, `animation_tests`, `merge_runtime/tests`,
`post_process_compiler/tests`): split by domain into `*_tests/` dirs —
low priority, no live risk.

## Per-phase guardrails

- **Before each refactor**: full green suite (rust-engines 519 + tauri 72 + frontend 416 + E2E 122)
- **Mechanical extraction only** — no behavior change
- **One commit per extracted sub-module** — easy bisect on regression
- **Mandatory green CI** before moving to the next phase
- Phases 1-3 can go on `main` post-merge; phases 4-5 deserve their
  dedicated branch (`refactor/merge-runtime-split`)
