# Score sequencer — implementation plan & progress tracker

> Living document on branch `feat/score-sequencer`.
> Design rationale: [score-sequencer.md](score-sequencer.md).
> **Update this file whenever a phase lands or its scope changes** —
> it is the single source of truth for "where is the sequencer".

Last updated: 2026-11-23 — clip fades + lane modes + orphan refs
implémentés (S2.y). Reste : seek-while-playing, record→tracks,
édition (split/multi-select/copy-paste).

## Status at a glance

| Phase | Goal | Status | Commit |
|-------|------|--------|--------|
| S0 | Design note | ✅ | `2e4b384` |
| S1 | Backend-owned tape clock | ✅ | `952439d` |
| S2 | Multitrack clip timeline executed by backend + SCORE surface | ✅ | `65eadb0` |
| S2.x | Clip repeat (bounded pattern copies) | ✅ | `c18a8cb` |
| S2.y | Timeline hardening — loop region ✅ · clip duplicate ✅ · clip fades ✅ · lane modes ✅ · orphan refs ✅ · seek-while-playing 🔲 · record→tracks 🔲 · édition avancée 🔲 | 🔄 | — |
| S3 | Automation lanes — pistes objets ✅ · courbes param:/transform/globalfx/modulation ✅ · blend merge: ✅ · taxonomie ✅ · reste : outils courbes, édition timeline, clips position/park/throw | 🔄 | — |
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
  the sequencer rather than a parallel feature. Le modèle lanes-par-
  objet (design 11-23) rend le dépôt naturel : clips sur les pistes
  objets + événements globaux sur le master.
- ✅ **Clip fades** — `fadeInMs`/`fadeOutMs` optionnels sur
  `ScoreClipDoc` (`undefined`/`None` = hérite les fades du slot),
  wire `fade_in_ms`/`fade_out_ms`. Backend : l'override est injecté
  dans `req.animation` au fire (même pipeline `spec.fade` que les
  slots) et emporté par l'`EndMove` (`clip.fade ?? animation.fade`).
  UI : poignée triangulaire haut-gauche (fade-in, région en gradient
  dans le clip) + **tail** dessiné après le bord droit (le move
  s'éteint après sa fenêtre — tail model), drag des deux avec snap
  50 ms + champs inspecteur. `fade_shape` réservé pour plus tard.
- ✅ **Lane mode `stacked | exclusive`** — `mode` optionnel sur
  `ScoreTrack` (défaut `exclusive`, backfill `setScoreDoc` sur les
  vieux docs), wire `stacked: true` par clip. Backend : `lane_active`
  passe d'un id par lane à `HashMap<lane, Vec<(id, fade)>>` —
  exclusive draine et coupe la lane au fire (comportement S2),
  stacked empile (les moves se composent dans le merge). EndMove ne
  retire que son move ; le hard-wrap loop draine tout. UI : toggle
  `EXC`/`STK` en tête de piste ; en stacked les clips qui se
  chevauchent sont empilés sur des sous-lignes (packing glouton) et
  la piste grandit.
- ✅ **Clip orphelin** — réf `slotId`/`cueId` cassée → clip dessiné
  pointillé/désaturé en édition (label `⚠` déjà existant), plus
  seulement en toast au play. Couleurs par type inchangées
  (slot mauve / cue ambre / stop rouge / panic rouge foncé).
- ✅ **Layout deux zones (modèle UI S3)** — la surface se scinde :
  zone haute = éditeur clip-scoped, zone basse = timeline +
  transport. L'éditeur affiche déjà l'**enveloppe de fades** du clip
  sélectionné (rampe/plateau/tail — première "courbe" réelle) +
  sélecteur de courbe avec placeholders S3 (pos.x, speed).
  Dev-seed `?score-demo` (hors prod) pour les revues visuelles.
- 🔲 **Clip editing** — split at cursor, copy/paste, multi-select,
  nudge, Alt-drag duplicate. Priorité : split + multi-select +
  copy/paste (c'est ce qui rend l'arrangement réellement éditable).

## S3 — automation lanes 🔄

Keyframed continuous parameters evaluated by the backend (design note
`AutomationLane`), through the **same command paths as OSC-IN**.

**Livré** : pistes par objet (`obj-<track_id>`) + copies liées
multi-objets + couverture cue dérivée du snapshot + réassignation par
lane (`bc1675d`) ; courbes `param:<node>:<key>` du graphe du move
(canal `external_param_deltas` → `ParamSlots`, courbe absolue → delta
au fire — même résolution id-puis-type que le signal compiler) ;
courbes transform per-move (`runtime.macros()`) ; lanes GLOBALFX
(transform du merge + markers) et MODULATION (valeurs nommées → map
OSC → `SignalOsc`, getter `osc_values_source()` rebind-safe) ; loop
default = `repeatEveryMs` pré-rempli à la période du move loopé ;
ligne plate = valeur connue à l'insertion ; éditeur keyframes +
splits réglables + ruler sticky ; taxonomie alignée **Transform**
(per-move) / **Global transform** (merge) / **Params** / **Modulation**
dans toute l'app.

**Restant — chantiers identifiés :**

- **Outils d'édition de courbes dédiés** 🔄 (chantier 3, démarré) :
  multi-sélection marquee / déplacement groupé, tangentes &
  interpolations (linear, step, smooth/bezier), snap grille t+valeur,
  édition numérique du point, copier/coller de courbes entre params
  et clips, ghost des autres courbes en fond, undo/redo score-scoped.
  Fait : `ScoreKeyframe.interp` (`linear|step|smooth`, défaut linear,
  rétrocompatible) côté backend (`ScoreInterp` + `sample_curve`) et
  frontend (type + `utils/scoreCurveMath.ts`, sampler miroir).
  **Non fait** : l'UI — `CurveEditor.tsx` est encore l'éditeur
  d'origine (linéaire, clic=ajout, drag 1 point, clic droit=delete).
- **Blend modes multi-moves** ✅ — `merge:weight`/`merge:priority`
  clip curves → `set_move_weight`/`set_move_priority` (côté merge,
  `fade × weight` = poids effectif) ; sélecteur de `MergeStrategy`
  dans le contexte GLOBALFX (override/crossfade/blend/priority —
  aussi porté par cues + node Merge du graphe global) ; getters
  `get_move_weight`/`get_move_priority` ajoutés.
- **Modulation e2e** ✅ — `buildScoreDemoSignalGraph` (SignalOsc
  `/score/energy` → Map → SignalOut scale) seedé par `?score-demo` ;
  test rust-engines `test_signal_osc_reads_score_modulation_source`
  prouve la chaîne map OSC → SignalOsc → delta macro.
- **Outils d'édition timeline** : menu contextuel clip (cut/copy/
  paste/delete/duplicate/split at cursor/rename/mute/convert) +
  menu contextuel lane (mute/solo, mode, hauteur, insert) + entrées
  menu bar (Edit/Score), split clip au curseur, multi-sélection de
  clips + déplacement groupé, ripple edit.
- **Clips position/park/throw** sur pistes objets (automation de la
  couche manuelle).
- **Copy/paste lié vs indépendant** explicite dans l'UI.
- **End-mode des courbes** (hold/revert à la fin du clip — réutiliser
  `end_mode`).

Open design points (inchangés) : conflict policy avec écriture
opérateur/OSC (proposition : courbe écrit en continu sauf park/manuel
— opérateur souverain), fade_out tail vs in-window (conservé : tail).

**Dependency reassessment:** le custom timeline tient ; les outils de
courbes (tangentes bezier, marquee) réévalueront `react-timeline-editor`
vs custom canvas quand le chantier démarre.

### Modularisation de la surface SCORE ✅

`ScoreView.tsx` (1229 l.) découpé — comportement inchangé :

| Fichier | Rôle |
|---|---|
| `ScoreView.tsx` | orchestration : stores, sélection, split, layout lanes, drag clips |
| `scoreParams.ts` | catalogues courbables + ligne plate (base connue) |
| `scoreUtils.ts` | `fmtMs`, couleurs, `clipLabel` |
| `CurveEditor.tsx` | éditeur SVG keyframes (cible du chantier 3) |
| `ScoreCurvePane.tsx` | zone haute + `EnvelopeEditor` |
| `ScoreParamsPanel.tsx` | colonne paramètres (groupes construits par ScoreView) |
| `ScoreTransport.tsx` | play/stop, loop, zoom, hauteur pistes |
| `ScoreTimeline.tsx` | en-têtes + ruler + lanes globales/objets + curseur |
| `ScoreClipBlock.tsx` | rendu d'un clip (fades, repeats, poignées) |
| `ScoreClipPicker.tsx` | popup d'ajout |
| `ScoreInspector.tsx` | bandeau bas |

Règle : composants définis au niveau module (identité stable — pas de
composant imbriqué, sinon perte de pointer capture en plein drag).

Fix au passage : le drag de clip utilisait `px2ms` (borné ≥0) pour le
**delta** → tout drag vers la gauche (reculer, rétrécir, réduire un
fade) était écrasé à 0. Delta signé désormais.

### Audit UI Puppeteer (`?score-demo`, Vite seul, sans backend)

`puppeteer-core` + Chrome headless, 1600×1000 (script local non
versionné, `.scratch/`). OK : drag clip (2000→0→2500 ms), resize
(12000→10350→12000), poignée fade-in, zoom, slider hauteur, deux
splitters, contextes GLOBALFX/MODULATION/clip, picker (fermeture au
clic extérieur), bandeau bas réactif.

**Bugs à corriger (prioritaires, petits)** :
1. **Échap avec le picker ouvert déclenche PANIC** (raccourci global)
   au lieu de fermer le picker → le picker doit consommer Échap
   (`stopPropagation`) et se fermer.
2. **Suppr inopérant après usage d'un slider** : le `<input range>`
   garde le focus, le handler ignore les INPUT → blur des contrôles
   non-texte après usage, ou ne filtrer que les inputs texte.
3. **CurveEditor déformé** (`preserveAspectRatio="none"`) : keyframes
   en ellipses étirées, textes écrasés → coordonnées en pixels réels
   (ResizeObserver) ou textes/points hors du SVG étiré.
4. **Clips cue illisibles** (carré 14 px sans label).

**Manques UX constatés** : colonne paramètres à 50 % de la largeur
(→ ~200 px fixe), éditeur de courbe sans grille / axes valeur+temps /
curseur de lecture / tooltip de valeur, aucun menu contextuel
(chantier 4), courbes invisibles sur les lanes objets (aperçu
mini-courbe dans le clip souhaitable), modal « Welcome » bloquante
en mode navigateur (gêne les tests automatisés).

Console (mode navigateur) : `[showSync] show-state-changed listen
failed: … reading 'transformCallback'` — à vérifier avec le shim.

### Reprise — audit backend réel fait sous Linux (bridge + `?score-demo`)

- ✅ Bridge headless + `?score-demo` joué contre le vrai merge :
  résolution 8 clips OK, `score_timeline_load` OK. Bugs trouvés et
  corrigés : ids de cue numériques (`id: 1` vs `String`) → coercition
  défensive dans `scoreResolve` + seed à ids string ; champs `Cue`
  requis sans `serde(default)` (`description`, `graph`, `timestamp`)
  absents des cues stub du seed → seed complété + valeurs de repli
  dans le résolveur (un snapshot partiel ne doit pas faire échouer le
  load de toute la partition).
- ⚠️ **Piège de diagnostic bridge** : `import()` dynamique dans
  `page.evaluate` peut lire une instance de module HMR périmée
  (store vide alors que l'UI affiche les clips) — valider via le DOM
  ou un spy `fetch`, pas via le store importé.
- ✅ **Modèle cue sur timeline — implémenté** (voir design note §
  "Cues on the timeline") : lane CONDUCTOR en tête de timeline (cue,
  stopAll, panic), blast radius = marqueurs d'impact ambrés sur les
  lanes couvertes (`trackIds` vide = toutes), barrière d'état backend
  (Full → `lane_active` + `curve_targets` vidés ; `cue.moves` ids
  respawnés enregistrés sous `conductor` pour cleanup wrap/stop),
  `score-nack` → toast sur busy-skip, picker conductor dédié (cues +
  stopAll + panic). ✅ **`flatten cue → clips` livré**
  (`utils/scoreFlatten.ts` + menu contextuel / toolbar `◆` / MenuBar) :
  moves → slots matérialisés `‹cue›·‹move›` + clips suivis, macros →
  keyframes GLOBALFX ; `signal_graph`/`spatial_macros`/
  `manual_positions`/`channels`/`mappings`/`zones`/`depths` rapportés
  `skipped` (pas d'entité timeline). ✅ **Entités livrées** : clip
  `positions` (manual_positions obj→track, tir = `/stagespace/position`
  par objet, marqueurs teal par lane) et clip `modGraph` (signal_graph
  porté par le clip, tir = compile+swap de la SignalFn globale) ;
  `spatial_macros` → keyframes GLOBALFX ; make-unique sur cue =
  `duplicateCue` + retargetClip. **Reste ouvert** : re-capture
  arrangement→cue, entités pour `channels`/`mappings`/`zones`/`depths`,
  tail `fade_duration` du clip cue.
- `bridge_server.rs` : origine IPC `http://tauri.localhost` sous
  Windows/Android — sans effet sous Linux, **non testé en exécution**.
- ✅ Vérifié sous Linux après sync : rust-engines 556/556, src-tauri
  92/92, clippy `-D warnings` + fmt des deux, tsc, vitest 527/527.
- Ordre suivant : redesign cue (conductor lane + barrière) → chantier
  3 (UI CurveEditor) → 4 timeline editing → 5 clips position/park/throw
  → 6 end-mode courbes.

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
| UX | Pistes = par objet + master, pas par type | Lisibilité opérateur ; le "record→tracks" devient un dépôt par objet naturel |
| UX | Terminologie "piste"/"clip" | "track" collisionne avec `/track/N` (OSC) |
| UX | Courbes éditées clip-scoped (zone haute), pas de sous-pistes | Évite l'explosion de lanes (1 param × N objets) ; évaluation bornée à la fenêtre du clip |
| UX | Fades clip-locaux (`None` = hérite slot) + poignées de bord | Même clip, articulations différentes par instance (modèle DAW clip gain) |
| UX | `lane_mode: stacked \| exclusive` par piste | Chevauchement = intention (layering merge) sur objets ; last-wins reste sain sur cues/master |
| UX | Clip orphelin flaggé en édition | Réf cassée visible avant le play, pas juste en toast |
| Audit | Cue = référence atomique sur lane CONDUCTOR, pas lanes objet | `recall_cue_inner` est une transition globale — sa couverture déborde toute piste ; le modèle setlist-traduite est honnête |
| Audit | Cue fire = barrière d'état (release `lane_active` + track `active_move_ids`) | Determinisme de boucle : les respawns de cue ne fuient pas entre cycles |
| Audit | `pre_wait`/`follow`/`timecode` bypassés au score | Sémantiques setlist ; sur un score la timeline EST le timing |
| Audit | `flatten cue → clips` = opération d'éditeur non-destructive | Référence vivante par défaut (édit-once), édition interne à la demande |
| Sync | Couverture clip : `trackIds` absent = suit l'entité vivante, présent = override gelé | Propagation Atelier→Score automatique ; l'override reste l'exception (toggle ⇄ inspector) |
| Édit | Déliage : `Détacher T<n>` = split de couverture (même entité), `→ nouveau move` = clone slot scopé ; `Rendre unique` = clone + repoint ref | Deux liens distincts (couverture vs contenu) ; le nouveau move vit en banque → synchro tous modes |
| Édit | Sélection clip/lane dans `useScoreStore` (pas ScoreView) | Même cible pour menu contextuel, toolbar et MenuBar global — trois portes, un chemin |

## Verification status

- **Dernier état (branche `feat/score-sequencer`, commit de reprise)** :
  frontend vitest 522/522 + tsc + eslint verts après modularisation ;
  rust-engines 555/555 et src-tauri 90/90 verts **avant** l'ajout de
  `ScoreInterp` — à relancer en premier à la reprise.

Historique :

- Backend: **87 tests** (4 `build_events` repeat + 3 fade/serde
  compat) — all green sur la toolchain GNU (manifest comctl32 v6
  injecté pour `TaskDialogIndirect` ; voir note env ci-dessous).
- Frontend: **520 tests** (score timeline : +fades clip-local,
  +lane mode, +backfill mode), tsc, lint (0 errors) — all green.
- Note env (Windows/GNU) : `cargo test` src-tauri exige
  `RUSTFLAGS="-Clink-arg=<manifest.res>"` (comctl32 v6) + un shim
  `strnlen_s` pour `ittapi-sys` — artefacts temporaires hors repo.
