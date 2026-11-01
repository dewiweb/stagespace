# Audit regard neuf — 2026-11-01

Audit complet par 6 reviewers indépendants (backend, wire/IPC, état frontend,
UX/workflows, tests, sécurité live), **sans lecture des plans/audits
existants** — findings vérifiés dans le code, file:line, classés par sévérité.

## P0 — Show-killers (à fixer avant toute confiance live)

| # | Défaut | Preuve | Source |
|---|---|---|---|
| P0.1 | **Fermer une fenêtre détachée tue le show** — `on_window_event` ne filtre pas `window.label()`: fermer conduite/run draine tous les moves, stoppe merge + OSC + superviseur | `src-tauri/src/lib.rs:217-255` | live-safety |
| P0.2 | **Panic n'existe que côté JS** — `/stagespace/panic` est ACKé puis exige la webview main (`useShowControl` → doPanic). Webview gelée/crashée = panic ACKé jamais exécuté | `osc_receiver.rs:1266`, `App.tsx` | live-safety |
| P0.3 | **Renderer mort = invisible** — UDP `send()` réussit sur host éteint, circuit-breaker exige ECONNREFUSED (`refused>0.5`). Status vert, blackout total | `merge_runtime/mod.rs:2651`, `position_sink.rs:93` | live-safety |
| P0.4 | **Panic pendant recall → les moves respawnent** — `recall_cue_inner` respawn après panic ; pas de `panic_in_progress` veto. Et `panic()` store (Esc) ne cancele pas les pending pre_wait/follow — moves qui revivent après panic | `cue_commands.rs:653-712`, `useGraphStore.ts:457` vs `liveActions.ts:192` | live-safety + UX |
| P0.5 | **Dry-run n'est pas un mute** — panic/`send_position_now` bypass `osc_armed` + `venue_map` : positions canoniques réelles envoyées en répétition désarmée | `merge_runtime/mod.rs:431-447, 2757` | live-safety + backend |
| P0.6 | **`set_osc_receiver_port` tue `/stagespace/*`** — rebuild du receiver sans migrer `show_sink` (+ media_sync, timecode_fps, suppress_until). Toute commande ACKée mais droppée — cas courant : port persisté ≠ 8001 au boot | `commands/osc.rs:110-165`, `lib.rs:295` | wire/IPC |

## P1 — Vérités qui divergent (bugs réels mid-show)

| # | Défaut | Preuve |
|---|---|---|
| P1.1 | **Positions manuelles/PSN/tape/throw/attention no-op sans move live** — le merge n'émet que pour les objets couverts par `track_indices` d'un move ; frame loop early-return sans move. Commande ACKée quand même | `merge_runtime/mod.rs:1879`, `helpers.rs:150-157` |
| P1.2 | **`?view=run` pousse sa config stale au backend** — detached store a `manualOscIds=[1..64]` → `set_global_osc_ids` écrase le mapping .hol de la main au mount | `useGraphStore.ts:646-689`, `App.tsx:37` |
| P1.3 | **`manualPositions` frontend = seconde vérité divergente** — drag-3D n'invoque que si playing ; écritures OSC/hold/tape backend jamais reçues → cues + .hfg sauvent des positions fausses | `useManipulateMode.ts:202-205`, `CuelistPanel.tsx:96`, `persistenceSlice.ts:299` |
| P1.4 | **Cue recall droppe `end_mode`/`anchor_mode`** — "hold"/"current" reviennent à revert/origin (sémantique continue effacée) | `cue_commands.rs:694-695` |
| P1.5 | **Full recall vide positions manuelles sans filtre parked** — "park survives recalls" faux pour les positions | `cue_commands.rs:556-567` |
| P1.6 | **Freeze/throw seed `last_out` post-traité** → double-transform quand macros ≠ identité | `merge_runtime/mod.rs:1153-1172, 2197-2204` |
| P1.7 | **Fenêtre run = copie figée qui feint le miroir** — index/solo locaux non broadcastés, écritures perdues silencieusement, pas de toasts | `RunWindow`, `PerformView.tsx`, `safeStorage.ts:19` |
| P1.8 | **Stale-kill ne nettoie pas `move_end_modes`** — Hold appliqué à tort si id réutilisé | `merge_runtime/mod.rs:1743-1782 vs 1110` |
| P1.9 | **Distance polaire en 2D** — source sur Z émet `dist=0, elev=0` | `osc_sender.rs:391-432` |
| P1.10 | **`emittedPositions` = computed, pas emitted** — écrit avant le gate arm ; alimente confidence view + `AnchorMode::Current` | `merge_runtime/mod.rs:2198 vs 2419` |
| P1.11 | **`setContext` signal store restaure le graphe du boot** — edits de session perdus | `useSignalGraphStore.ts:99,126-142` |
| P1.12 | **Rehearsal `playTimer` écrasé** — 'clear' n'annule que le dernier timer | `liveActions.ts:371-384` |
| P1.13 | **`set_macro` skip `require_finite`** — NaN macro → blackout silencieux | `playback.rs:40-67` |
| P1.14 | **Rollback mort `loadShowEnvelope`** — les push catch en interne, revert jamais exécuté | `persistenceSlice.ts:469-495` |
| P1.15 | **`setVenueConfig` persiste avant de valider yaw** — config invalide stockée jamais envoyée | `oscConfigSlice.ts:231-237` |
| P1.16 | **`stopMovement` efface `movementPositions['global']`** — flicker avec autres moves actifs | `movementSlice.ts:127-148` |

## P2 — Incohérences opérateur

- **GO ≠ cue en conduite** — NOW/NEXT = cues, GO = setlist (cible invisible) — piège sémantique
- **Radar en obj_index vs pads/3D en track_id** — même écran, deux numérotations
- **3 noms pour désarmé** : LIVE (OscArmToggle) / MUTED / DRY-RUN ; "LIVE" a aussi 3 sens
- **Ack avant parse** — commandes invalides ACKées, jamais NACKées (`osc_receiver.rs:1259-1304`)
- **Backend-busy → pas de NACK** — `recall_cue` busy → toast seul, `from` non forwardé
- **`doUnsolo`/`doPark`/`doArm` sans guard recallBusy ni `from`** ; `doCueNext/Prev` annule les timers AVANT le guard
- **Media-sync inatteignable sans contrôleur émetteur** (early-return `controllers.is_empty()`)
- **`doSlot`/`doSolo` fallback `moveSlots[n-1]`** — mauvais slot plutôt que nack
- **Pad hold asymétrique** — appui long sur move live = stop sans garde
- **CuelistPanel complet dans PerformView** — delete/store cue en jeu (contradiction)
- **Inspector "Audio" section rend MacrosSurface** — le titre ment (copy-paste)
- **Suppress OSC-IN pendant recall** — jusqu'à 120s de faders morts, aucun indicateur
- **Rehearsal contrat drift** — `Rehearsal(String)` Rust vs `string|null` TS → CI drift
- **FR/EN mélangé** partout ; stop-fade : 3 valeurs différentes selon le bouton
- **Cue authoring incomplet** — pas de reorder/rename/renumber ; `cue_number` figé
- **Bouton "Conduite" mort en ?view=run** ; `performMode` toujours true au boot
- **TC tick pendant recall disarme un pending timer** (cancelPendingTimers avant le guard)

## P3 — Tests : ce que la suite ne peut pas voir

- **Send-path transforms** (venue yaw/scale/offset, reality, spatial, arm gate) : **zéro test backend** — `CaptureSink` existe (`tests.rs:499`)
- **`EndMode::Hold` + `AnchorMode`** : jamais instanciés dans un test
- **obj_index↔track_id** : toutes les fixtures identity-mapped → régression `tid−1` invisible
- **`useLiveShortcuts`** : zéro test
- **`graphMigration`** : vieux shows → graphes cassés silencieux
- **Mock `safeInvoke`** : bypass `checkTauri`/`BackendError` → chemins backend-down invisibles
- **11/24 variantes ShowCommand** testées côté dispatch
- **Sleep réels partout** (CI-load-sensible) ; `bench_merge_under_load` `#[ignore]`

## Vérifié correct (à préserver)

- Déterminisme merge (tri move_id, routing trié), seqlock macros, sanitize NaN
- `catch_unwind` + thread_died + parking + watchdog restart ; poisoned-lock recovery
- Recall atomicité (CAS + RecallGuard), generation checks, pending reservation
- OSC-IN interception + parse exhaustif (26 variantes dispatchées, ack réel UDP)
- Ordre des locks documenté et respecté ; stale-kill `ptr_eq` guard
- Namespace obj_index/track_id respecté aux frontières vérifiées

## Verdicts des reviewers

- **Live-safety** : "Not show-ready — P0.1, P0.2, P0.5 doivent être fixés ; P0.3/P0.4 exigent au moins une dégradation visible"
- **Backend** : "Cœur remarquablement sain (panic containment, déterminisme, locks) ; tous les défauts sont aux bords — positions manuelles, promesses park/arm/venue non honorées dans panic/recall"
- **Wire/IPC** : "Surface globalement cohérente ; la faille structurelle = `set_osc_receiver_port` qui oublie que le receiver est aussi le transport show-control"
- **Frontend state** : "Architecture disciplinée ; la faiblesse = caches frontend parallèles des faits backend (manualPositions le pire) + push de config stale depuis la détachée"
- **UX** : "Architecture 3 phases réelle, sécurité de base sérieuse ; l'UX trahit l'opérateur aux frontières : GO≠cue, fenêtre run figée qui feint le miroir, panic non uniforme, lexique"
- **Tests** : "Fort là où ça couvre ; aveugle sur toute la couche wire-transform, les sémantiques hold/anchor, la conversion d'index et le clavier"

## Plan de remédiation proposé

- **F0** (avant tout) : P0.1 label check · P0.5 armed+venue gates · P0.6 show_sink migration · P0.4 panic↔recall veto + cancel pending timers dans panic() — ~1 jour
- **F1** : P0.2 panic backend-side · P1.1 emit manuel sans move · P1.2 detached no config-push · P1.4 end/anchor_mode persist · P1.5 parked filter — ~2 jours
- **F2** : P1.3 manualPositions sync · P1.6 canonical seed · P1.7 detached truth (broadcast ou read-only honnête) · P0.3 liveness probe — ~2-3 jours
- **F3** : P2 incohérences (lexique, GO sémantique, radar labels, NACK completeness) — ~2 jours
- **F4** : P3 tests (CaptureSink transforms, hold/anchor, non-identity mappings, shortcuts) — ~2 jours
