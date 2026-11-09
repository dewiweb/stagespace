# Plan de sanitation — architecture & modularisation

Audit du 2026-11 (branche `refactor/typed-ports`). Structure globale cohérente ;
deux chantiers : hygiène racine + modularisation des gros fichiers (règle
`.devin/rules/modularisation.md` : >800 prioritaire, >1200 critique).

Ordre : du plus sûr/rapide au plus risqué. Chaque phase est un livrable
indépendant (commit + vérif complète avant de passer).

**État au 2026-11-09 : phases 0–5 terminées.** Reste la phase 6 (taille
moyenne, opportuniste) + `merge_runtime/loop_core.rs` (1510l, >1200 —
repassé au-dessus du seuil critique après la phase 4).

---

## Phase 0 — Release en cours (préalable)

| # | Action | Statut |
|---|--------|--------|
| 0.1 | CI PR #5 verte (fmt corrigé par `ebf5365`) | ✅ fait |
| 0.2 | Merge `refactor/typed-ports` → `main` | ✅ fait |
| 0.3 | Bump version 0.4.2 → **0.5.0** (3 fichiers : package.json, Cargo.toml, tauri.conf.json) — 250+ commits de refonte justifient le minor | ✅ fait (`70a2f53`) |
| 0.4 | Tag `v0.5.0` + push → release CI | ✅ fait |
| 0.5 | Surveiller release CI (builds + artifacts) | ✅ fait |

## Phase 1 — Hygiène racine (~30 min, risque nul) — ✅ `16b246a`

| # | Action | Détail |
|---|--------|--------|
| 1.1 | Docs orphelins → `docs/` | `ARCHITECTURE_FUTURE`, `AUDITS_1.0`, `PLUGINS_WASM`, `RESEARCH_STATE_OF_ART`, `ROADMAP_GRAPH_GLOBAL` (5 × 16-54k à la racine, datent d'avant docs/) — `git mv` + fix les liens internes |
| 1.2 | `bindings/` cleanup | Un seul `nodeSpecs.json` — vérifier s'il est encore référencé (grep `bindings\|nodeSpecs`) ; sinon supprimer le dossier |
| 1.3 | `_archive/` décision | Prédécesseur Python/Electron complet — gardé tel quel (exclu des builds) |
| 1.4 | `.gitignore` audit | Vérifier que venv/results/artifacts ne traînent pas |

## Phase 2 — `components/` regroupement (~1h, risque faible) — ✅ `d08cd3d`

Le pattern flat+dirs mixte (subdirs `jeu/ conduite/ editor/ perform/ show/ ui/`
à côté de 30 fichiers plats). Regrouper par famille existante :

| Nouvelle dir | Fichiers |
|---|---|
| `viewer3d/` | Scene3D, TrajectoryVisualization, ZoneVisualization, ObjectInspectBar, ModeButtons, DrawModeOverlay, DebugPerfOverlay, MacrosPanel, ManualReleaseBar |
| `panels/` | CuelistPanel, MovesTable, SpatialFxPanel, ScorePanel, ShowLogPanel, AnimationList, AudioPanel, NodeParamsPanel |
| *(déjà ok)* | `jeu/` Radar2D · `conduite/` · `editor/` · `perform/` · `show/` · `ui/` |

Méthode : `git mv` + imports relatifs corrigés (tsc + tests + build à chaque sous-lot, pas tout d'un coup).

## Phase 3 — Second modularisation Scene3D + useRenderLoop (~2h) — ✅ `193320f`

Régression : Scene3D était 232l après la phase 1-3, aujourd'hui **601** ;
useRenderLoop **609**. Les handlers ont repoussé dans le composant.

| Extraction | Contenu |
|---|---|
| `useScenePicking.ts` | `pickObjectIndexAt` + `zoneRaycast` + `zoneIndexAt` + NDC helpers (~120l) |
| `useZoneGestures.ts` | handleZoneEdit{Down,Move,Up,Wheel} + handleZonePlaceDown (~150l) |
| `useSceneGestures.ts` | handleScenePointerDown/Up (release + tap-select) + handleAssignDown (~80l) |
| `SceneOverlays.tsx` | le JSX des overlays d'interaction (zoneEdit/place/assign/manipulate) (~90l) |
| `useHandleTrajectory.ts` | la section trajectory-line du render loop (~60l) |

Cible : Scene3D ~200l d'orchestration pure, comme après la phase 1-3.

## Phase 4 — `merge_runtime/mod.rs` 3075l (chantier principal) — ✅ `cb6e45f`, `49f289b`, `9f997c0`

Le plus gros fichier du codebase. `transition.rs` déjà extrait ; le reste
est un monolithe : boucle merge, émission OSC, éval channels, zones,
lock-profiling, state.

| Sous-module proposé | Contenu estimé |
|---|---|
| `merge_runtime/loop_core.rs` | la boucle principale + scheduling tick |
| `merge_runtime/osc_emit.rs` | send_positions, send_channels, throttle |
| `merge_runtime/channel_eval.rs` | apply_zones + effective channels + modulations |
| `merge_runtime/zone_transform.rs` | positional effects (ZoneEffect ∇SDF) |
| `merge_runtime/lock_prof.rs` | timed_lock! + sites + profiling |
| `merge_runtime/state.rs` | struct MergeRuntime + builders |

Approche : extraction mécanique une section à la fois, `pub(crate)` boundary
stable, `cargo test --lib` après chaque extraction (519 tests de garde).
**Risque : moyen** — toucher la boucle live exige la suite de tests complète.

## Phase 5 — `osc_receiver.rs` 2441l — ✅ `cbeaea1` (mergé `6700a87`)

OSC IN monolithe : parsing, mappings, show-control, anti-loop, feedback.
Résultat : `osc_receiver/` = mod.rs 612 + pipeline.rs 365 + show_control.rs 353
+ types.rs 293 + tests 590 + show_control_tests 237. Suite verte (539 tests).

## Phase 6 — Taille moyenne (800-1200, opportuniste) + rattrapage critique

À traiter quand on les touche pour autre chose (pas de chantier dédié) :
`compiler.rs` 1569 · **`merge_runtime/loop_core.rs` 1510 — >1200, repassé
critique après la phase 4 (la boucle a grossi lors des splits)** ·
`node_spec.rs` 1439 · `validator.rs` 1111 · `runtime/mod.rs` 1082 ·
`cli/commands/moves.rs` 933 · `audio_capture.rs` 922 · `osc_sender.rs` 829 ·
`signal_compiler.rs` 818 · `cue_commands.rs` 762 · `moves/SpatialFxPanel/NodeEditor/App` 600-700.

Tests >1200 (`validator_tests`, `animation_tests`, `merge_runtime/tests`,
`post_process_compiler/tests`) : split par domaine en `*_tests/` dirs —
basse priorité, pas de risque live.

## Garde-fous par phase

- **Avant chaque refactor** : suite complète verte (rust-engines 519 + tauri 72 + frontend 416 + E2E 122)
- **Extraction mécanique seule** — pas de changement de comportement
- **Un commit par sous-module extrait** — bisect facile si régression
- **CI verte obligatoire** avant de passer à la phase suivante
- Les phases 1-3 peuvent partir sur `main` post-merge ; phases 4-5 méritent leur branche dédiée (`refactor/merge-runtime-split`)
