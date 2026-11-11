# Documentation index

Entry point for all project documentation. Each doc carries a status
banner; the table below summarizes it.

## For users

| Doc | Contents | Status |
|---|---|---|
| `user-manual.md` | Complete guide: surfaces (Atelier/Conduite/Jeu), cues, OSC, spatial FX, node reference | Current — mirrored to the wiki User-Manual page |
| `use-cases.md` | Two field-validated conduites + open limits | Living document |
| `console-integration.md` | Driving STAGESPACE from an FOH console via OSC show control | Current |
| `conduites/` | Four reference show files (A–D) with `.hfg` sources in `examples/` | Current |
| `screenshots/` | Real app captures (Tauri/X11) referenced by the manual | Current |

## For developers

| Doc | Contents | Status |
|---|---|---|
| `../AGENTS.md` | Repo layout, build/test commands, conventions, OSC show control, live-safety | Current — the canonical dev reference |
| `PLUGINS_WASM.md` | WASM plugin host spec: `.ssx` format, ABI v1/v2, security limits | Shipped (v0.5.2) — current spec |
| `gui-refonte-v2.md` | GUI direction: PERFORM/Edit surfaces, Simple/Expert vocabulary | Active direction — supersedes `gui-refactor-plan.md` |
| `dev-plan-spatial.md` | Object-mixing plan around operator phases (boxing/conduite/live) | Plan — P1–P5 tracks shipped, see roadmap |
| `../MANUAL_TESTING.md` | Manual QA checklist (visual, audio, OSC, stability) | Current — graph-editor gestures in `user-manual.md` §2.4 |

## Architecture & research

| Doc | Contents | Status |
|---|---|---|
| `ARCHITECTURE_FUTURE.md` | Hybrid global-graph design (workers + merge + post-process) | **Implemented** — kept as design rationale |
| `ROADMAP_GRAPH_GLOBAL.md` | Phased plan P1–P5 (done) → P6+ (open) | Mostly implemented — remaining in "Remaining" callouts |
| `RESEARCH_STATE_OF_ART.md` | Software landscape, psychoacoustics, HCI, positioning | Research reference |
| `spatial-object-mixing-study.md` | Positioning study for object-oriented mixing | Reference — rationale for `dev-plan-spatial.md` |

## Audits (snapshots — fixed items aren't re-marked)

| Doc | Contents | Status |
|---|---|---|
| `AUDITS_1.0.md` | Pre-1.0 backend/architecture/UX audits + plan T1–T7 | Snapshot |
| `audit-fresh-eyes-2026-11.md` | Independent 6-reviewer audit, file:line evidence | Snapshot (2026-11-01) |
| `gui-audit.md` + `gui-audit/lot-*.md` | GUI audit, findings F1–F16 / S1–S14 | Snapshot — traceability for `gui-refonte-v2.md` |
| `sanitation-plan.md` | Modularization plan (phases 0–5 + >1200 catch-up) | Largely implemented |
| `gui-refactor-plan.md` | First GUI fix plan | Superseded by `gui-refonte-v2.md` |

## Elsewhere in the repo

- `rust-engines/` — `BENCHMARKS.md`, `CONFIG.md`, `ERROR_HANDLING.md`, `LOGGING.md`, `TESTING.md`
- `plugin-sdk/README.md` — guest SDK + `stagespace-pack` CLI; `plugin-examples/*/README.md` — three worked examples
- `examples/` — `.hfg` show files + `conduite-epilogue.md` walkthrough
- `.devin/rules/` — modularization + Three.js review rules; `.windsurf/rules/context.md` — project genesis
- GitHub wiki — User Manual, Plugins, Dev-Setup, Home (user-facing pages)
