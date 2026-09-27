# Audits pré-1.0 — STAGESPACE

Trois revues indépendantes menées sur `feat/wasm-plugins` (post PR #1) :
robustesse du moteur temps réel, architecture logicielle, UX/UI.
Chaque finding référence `fichier:ligne`. Classification : 🔴 bloquant/critique · 🟠 important · 🟡 mineur.

## Plan d'action consolidé

| Tranche | Contenu | Findings |
|---|---|---|
| **T1 — Anti-blackout** | Bornes de récursion/taille (validator, compile, parser CustomTrajectory), kill des workers zombies, watchdog merge côté backend | B2, B3, C5, C7 |
| **T2 — Unifier les transforms + scope macros** | Une seule couche de transforms spatiaux, fix bug `Scale` x/y/z, `Barycenter` no-op, `MoveRef.move_id`, scope macro Global/PerMove structurel | A1, A2 |
| **T3 — Moteur prévisible** | `eval_frame` batch pour engines à état, budget temps/frame, mémoïsation incrémentale | B1, C4 |
| **T4 — UX live** | PANIC jamais inerte + proéminent, `.live-mode` branché, StatusBar partagée, contrastes WCAG, `storeCue` toast | U1-U8, U16 |
| **T5 — Contrats & hygiène** | `NodeSpec` déclarative unique (source Rust → ts-rs), `graph_json`/`Cue` typés+versionnés, `IpcError` par variant, purge des chemins morts | A3, A4, A7, A9 |
| **T6 — Robustesse réseau/audio** | Circuit-breaker OSC OUT + bundles, reconnect audio, bornes params (fps/duration/zones) | C6, I12, I15 |

---

# 1. Audit backend — moteur temps réel

Périmètre : `rust-engines/src/{runtime,merge_runtime,engines,compiler,validator,graph,plugins,position_sink,osc_sender,osc_receiver,audio_capture,position_buffer,kinematics,zones,animation}.rs`, `tauri-app/src-tauri/src/{commands,graph,lib.rs}`.

## 🔴 Bloquants

### B1 — Engines à simulation : re-simulation depuis `t=0` par objet × frame

`engines/mod.rs:51-89` (caps), `swarm.rs:64-92`, `avoidance.rs:57-89`, `bouncing.rs:52-66`, `follow.rs:101-184`, `spring.rs`, `pendulum.rs`, `vector_field.rs`. Boucle d'appel : `runtime/mod.rs:545-597` (`fn_ref(t_looped, obj_idx)` par objet).

`position(t, i)` est pure — chaque appel rejoue la simulation depuis `t=0` :

- `Swarm`/`Avoidance` simulent **tous les agents** par appel : O(n²·pas) par objet → O(n³·pas) par frame. `sim_steps_n2` borne à ~4 M évaluations de paires par appel — cap atteint à **t≈16 s** pour n=64 ; au-delà ~0,5–2 s/frame.
- `Bouncing`/`Spring`/`Follow`/`Pendulum`/`VectorField` : O(pas) par objet, `pas = min(t·fps, 4M)` → coût croît linéairement avec t (aucune borne sur duration, cf. I12).

**Scénario live** : cue "Swarm 40 sources" meurt ~15–20 s après activation — le merge stale-kill après 0,5 s, tracks figées, et le thread continue à 100 % CPU (voir C5).

**Reco** : `eval_frame(t, n_objects) -> Vec<Vector3>` batch pour les engines à état (une simulation par frame, pas par appel) + mémoïsation `(t_last, état)` ; à court terme : deadline `Instant` dans la boucle de pas + refus compile si `n² × duration × fps` dépasse un budget (~10⁸).

### B2 — Récursion non bornée → stack overflow = abort du process entier

`compiler.rs:225-249` (`compile_node` récursif sans borne), `graph.rs:277-298` (`dfs_cycle` récursif), `validator.rs` (aucune limite nodes/edges/profondeur), entrée `graph_updates.rs:38`/`parser.rs` (graph_json non borné).

Seuls `resolve_n_objects_depth`/`resolve_duration_depth` ont un cap (64). Un stack overflow = SIGSEGV/abort **non rattrapable** — blackout OSC total et définitif, `catch_unwind` impuissant. Bonus : DAG compilé en arbre sans mémoïsation → `Mix(a,a)` par niveau = explosion 2^profondeur.

**Reco** : bornes dures au validator avant `has_cycle` (nodes≤512, edges≤4096, profondeur DAG≤128 itératif, graph_json≤1 MiB à l'IPC) ; `dfs_cycle` itératif ; mémoïser `compile_node` par `NodeId`.

### B3 — `CustomTrajectory` : parseur récursif sans borne, re-parsé à chaque appel

`engines/custom_trajectory.rs:107-227`. (a) `position()` re-parse les 3 expressions par objet par frame. (b) Expression issue du graphe sans borne : `((((…))))`×10 000 → stack overflow → abort.

**Reco** : parser en AST **à la compile** dans la closure ; bornes profondeur ≤64 et longueur ≤4 KiB ; rejet à la validation.

## 🔴 Critiques

### C4 — Engines audio/OSC : deep-clone JSON + mutex par objet × frame

`compiler.rs:993-998` (`params.clone()` + `engine.position` par objet), `:1007-1024` (`values.lock()` par objet OSCInput), `inject_audio_values` `:1103-1147` (lock + ~15 allocs par appel). À 64 objets × 60 fps ≈ 3 800 locks + deep-clones JSON/s/node audio. Convoy de locks possible avec le receiver OSC IN en rafale.

**Reco** : snapshot **une fois par frame** (audio_state/osc_values en atomiques ou `MacroState::snapshot()`-like), injection unique, les N objets lisent le snapshot.

### C5 — Stale-kill : le worker zombie n'est jamais arrêté → CPU 100 %

`merge_runtime/mod.rs:866-874` — le move est retiré du merge mais le `Runtime` du worker continue d'évaluer dans un `PositionBuffer` orphelin indéfiniment. L'UI affiche "playing" alors que le move est muet ; purge uniquement au recall.

**Reco** : file `stale_moves` drainée par le poller (ou callback `on_stale`) → `runtime.stop()` + retrait du `Movement` + event `active-moves-update` + toast "move killed (engine too slow)".

### C6 — OSC OUT : pas de backpressure, pas de bundle, pas de circuit-breaker

`position_sink.rs:63-91`, `merge_runtime/mod.rs:1094-1123`, `osc_sender.rs:460-491` — jusqu'à 8 messages UDP par objet/frame (~30 000 msg/s à 64 objets full-channel). Renderer mort → `ECONNREFUSED` comptabilisé (`osc_refused_perf`) mais **jamais exploité** : encodage+send à fond indéfiniment ; Panic retardé d'un sweep de sends échoués.

**Reco** : circuit-breaker (refused_rate>50 % sur 2×500 ms → suspendre sends, garder merge+preview, sonder 1 Hz, event `osc-target-down`, réarmer) ; `OscBundle` par objet (÷8 paquets) ; remonter `refused_rate` au frontend.

### C7 — Redémarrage du merge suspendu au polling frontend

`merge_runtime/mod.rs:1219-1253` (panic → `thread_died`, parking origine, mort), `commands/sampling.rs:38-45` (restart uniquement dans `get_perf_stats` — poll ~500 ms). Webview gelée/minimisée → merge mort définitivement, blackout OSC.

**Reco** : watchdog backend (thread/`async_runtime`, check `thread_died` toutes 250 ms → `start()`), event `merge-restarted` pour toast ; envisager `continue` avec frame de parking plutôt que mort quand `has_active_moves()`.

## 🟠 Importants

### I8 — Mutex `position_fn` tenu pendant toute l'évaluation d'une frame

`runtime/mod.rs:545-597` — `swap_position_fn`/`recall_cue`/`sample` attendent la fin du frame complet. Engine au cap (B1) → recall retardé de secondes.

**Reco** : `Arc<PositionFn>` + swap atomique (`arc_swap` ou clone Arc par objet) — effet au prochain objet, jamais d'attente.

### I9 — Chaque fade double le coût d'évaluation pendant sa durée

`runtime/mod.rs:696-708` — `from_fn` + `to_fn` par objet. Les transitions (le moment exposé) doublent le coût — ×4 avec Crossfade interne + fade recall superposés.

**Reco** : mesurer/documenter ; privilégier le fade au niveau merge (`MoveState` fade existe, `merge_runtime/move_state.rs:101`) plutôt que double éval.

### I10 — Sérialisation JSON du callback `global-positions` sur le thread merge

`move_management.rs:387-400`, `merge_runtime/mod.rs:1136-1151` — ~4 Ko/frame à 64 objets, ~60 Ko/frame à 1024 (3,6 Mo/s de JSON produit sur le thread temps réel).

**Reco** : throttle emit ~20 Hz (1 frame/3) ou thread dédié alimenté par channel borné (drop si plein).

### I11 — Mismatch `track_indices.len() != positions.len()` → move sauté chaque frame + warn×60/s

`merge_runtime/mod.rs:905-918` — fenêtre persistante possible (`update_move_graph_merged` `graph_updates.rs:79-96` séquence `update_move_routing` et `set_osc_ids` non atomiques côté worker).

**Reco** : log rate-limité (1×/move) ; clip à `min(len)` ; pousser `osc_ids`+`track_indices` en une paire atomique (`RwLock<(Vec<u32>, Vec<usize>)>`).

### I12 — Params sans borne haute : `fps`, `duration`, zones/modulations/mappings

`compiler.rs:1040-1056` (`duration`/`fps` seulement finite>0 — `fps=10000` → worker à 10 kHz), `channels.rs:97-115,174-206` (Vec sans cap), `osc_receiver.rs` `add_mapping` sans cap.

**Reco** : clamp `fps≤240`, `duration≤86 400 s`, zones≤64, modulations≤64, mappings≤256 — erreurs de validation explicites.

### I13 — Hot-swap : génération mismatch → apply-with-warn au lieu d'annuler

`graph_updates.rs:51-56` — le graphe compilé pour l'ancien contexte est appliqué au nouveau worker (n_objects/tracks divergents → objets muets ou agents fantômes, silencieux).

**Reco** : generation mismatch → `Err(conflict)` ; le frontend relance l'edit.

### I14 — OSC IN : O(mappings) avec allocations par message

`osc_receiver.rs:657-671` (`match_address` alloue 2 `Vec<&str>` + `String` par mapping par message), `:757-860` (`mappings.read()` tenu pendant tout le dispatch).

**Reco** : pré-découper les patterns en segments à `add_mapping`, captures sans `String`, cap mappings (I12).

### I15 — Perte du device audio : fatale, pas de reconnexion, mods figés silencieusement

`audio_capture.rs:567-576` (`running=false`, TODO auto-reconnect), `commands/audio.rs:96-100`. BPM/amplitude figés sur les dernières valeurs.

**Reco** : retry backoff dans le thread capture (re-énumération ~2 s) + toast sticky + `AudioState.stale_since` → neutralité >1 s.

## 🟡 Mineurs

| # | Fichier | Finding |
|---|---|---|
| M16 | `move_management.rs:577-583,622-630` | Un `thread::spawn` dormant par fade de désactivation — non borné → `async_runtime::spawn` + `sleep` |
| M17 | `runtime/mod.rs:398-420,518-521` ; `merge_runtime/mod.rs:812-815,880,983-990` ; `swarm.rs:78-92` | ~10-15 allocs/frame/worker ; swarm/avoidance 3 Vecs × n par appel — buffers persistants, snapshots `Arc` |
| M18 | `runtime/mod.rs:574-577` | `catch_unwind` par objet → panic hook écrit stderr à chaque panic (N×60 lignes/s, blocage possible sur pipe) → rate-limit |
| M19 | `position_buffer.rs:36-54` | positions et `frame_count` sous 2 mutex → lecture déchirée → `Mutex<(Vec,u64)>` ou seqlock |
| M20 | `osc_sender.rs:262-344` | `String::clone()` par message pour l'adresse → `&str`/`Arc<str>` zéro-alloc |

## Déjà solide (à ne pas casser)

- **Sandbox Wasmtime exemplaire** : `StoreLimits` (mémoire 32 Mio), fuel re-armé à chaque eval, bornes pointeurs vs `data_size`, traps→zeros + log-once, zéro import, memory64 refusé, caps bundle/manifest/module.
- **Merge** : catch_unwind par frame, `thread_died`/`merge_frames`/`dropped_positions` observables, parking origine, idle paced, anti-burst re-ancrage.
- **Workers** : `ClearRunning` RAII, CAS double-spawn, `stop()` idempotent + join dans Drop, catch_unwind par objet.
- **Locks** : sections critiques courtes documentées, callbacks émis hors lock, snapshots `Arc` COW, seqlock macros, `try_lock` audio callback, `lock_or_recover` systématique.
- **Cycle de vie moves** : `pending_move_ids` + générations, nettoyage réservations, recall `AtomicBool`+RAII, anti-loop OSC, `failed_moves` visible, purge fantômes.
- **OSC IN** : timeout socket, rebind nouveau-avant-ancien, bundles ≤8 niveaux, guards playback.
- **Sanitization** : positions non-finies droppées+comptées, `finite_or_zero`, clamps min/max inversés.
- **Audio** : buffers FFT pré-alloués hors callback, publication 10 Hz sous `try_lock`, init borné.
- **Tests** : 381+37 dont régressions pointues — culture "ça a cassé en live, on écrit le test".

---

# 2. Audit architecture

Périmètre : `rust-engines/`, `tauri-app/src-tauri/`, `tauri-app/frontend/`. Revue statique (aucun test exécuté).

## 🔴 Critiques

### A1 — Triple implémentation divergente du pipeline de transforms

`runtime/mod.rs:750-802` (`move_transform` worker : radius_scale→height_offset→fade→scale→rotation→+origin+shift), `merge_runtime/helpers.rs` (`default_post_process_fn`), `post_process_compiler/transforms.rs:95-233` (chaîne compilée).

Divergences constatées :
- `compile_scale` (`transforms.rs:98-104`) : param `scale` utilisé **seulement si macro ≠ 1.0** — "macro 1.0 écrase param 0.5" inexprimable. **Bug actuel** : le schéma UI global expose `x/y/z`, le compilateur lit `scale` → params utilisateur ignorés.
- `compile_rotate` (`:115-128`) : deux conventions simultanées (`yaw/pitch/roll` degrés + `angleX/Y/Z` radians).
- `Barycenter` compile en **no-op silencieux** (`:235-241`).
- `MoveRef.move_id` jamais lu — le nœud est décoratif ; Scale après MoveRef s'applique à toutes les positions mergées.
- `compile_clamp` (`:321-341`) : `min`/`max` scalaires OU `min_x…max_z` — deux schémas.

**Reco** : une seule couche (le post-process compilé — dans le graphe, donc éditable/sérialisable) ; supprimer `default_post_process_fn` ou la générer depuis la même spec ; `ParamSource` typé pour le fallback macro↔param ; convention unique de params par NodeType.

### A2 — Scope des macros spatiales : deux modèles opposés réconciliés par commentaires

`move_management.rs:44-51,451` (macros spatiales exclues du request), `animation.rs:66-70,111-120` (macros au **worker**), `useAnimationStore.ts:189-196` (neutralisation frontend pour éviter le double transform), `moveSlotsSlice.ts:701-724` (macros au **merge**).

`launchAnimation` et `playSlot` donnent des sémantiques différentes au même objet. `set_macro` écrit `speed` sur le merge alors que speed est documenté per-move.

**Reco** : scope structurel — soit toujours global (supprimer `SpatialMacroInit`+setters worker), soit per-move ; à minima `MacroScope::{Global,PerMove}` + refus des champs hors-scope dans `update_animation_state`.

### A3 — Catalogue de nœuds répliqué dans ≥6 sites sur 2 langages — déjà dérivé

`validator.rs:970-1047`, `transforms.rs:20-37`, `compiler.rs:901-976`, `connectionRules.ts`, `nodeParamSchema.ts`, `moveSlotsSlice.ts:121-128,230-237` (deux listes quasi identiques dans le même fichier), `types/index.ts:12`. La dérive `Scale` (A1) en est la preuve.

**Reco** : table déclarative `NodeSpec { node_type, context, ports, params, category }` unique en Rust → export ts-rs/JSON consommé par validator, compiler, post_process_compiler, connectionRules, nodeParamSchema, palette. Refactor le plus rentable avant les groupes.

### A4 — `graph_json` non typé sur le wire ; params sans schéma ; `Cue` sans version

`graph.rs:137-143` (`params: serde_json::Value`), `move_management.rs:28` (`graph_json: Value`), `cue_commands.rs:32-47` (`#[ts(type="unknown")]`), `parser.rs` (parsing ad-hoc), `cuelist.rs` (`Cue` sans `version`).

**Reco** : `GraphDocument { format_version, nodes, edges }` typé + export ts-rs ; validation des params contre `NodeSpec` à la frontière avec warnings remontés ; `Cue.version`.

## 🟠 Importants

### A5 — `MergeRuntime` god-object (~15 responsabilités)

`merge_runtime/mod.rs:80-144` — merge, MacroState, AudioState, origin, osc_ids, track_depths, stratégie, PerfMonitor, callback Tauri, PositionSink, post_process_fn, track_positions, manual_positions, object_channels, channel_modulations, kinematic_smoothing, zones ×2, graph_modulations + zombie reaping + rattrapage d'horloge.

**Reco** : extraire `PostFxRegistry` (zones+modulations+channels+depths) et `MoveTable` (buffers+états+reaping) ; la boucle garde merge→post_process→sink. (`PositionSink` injectable = bonne seam pour renderers.)

### A6 — Le frontend orchestre les invariants de cohérence runtime

`moveSlotsSlice.ts:26-49` (computeTrackIndices client alors que `resolve_track_indices` existe backend), `useManipulateMode.ts:57-59,202-204` (double écriture), `persistenceSlice.ts:311-524` (restore `.hfg` = 7 IPC séquentiels avec rollbacks partiels non atomiques), `useGlobalGraphStore.ts` (`update_global_graph` + `set_global_origin` en 2 IPC non atomiques), `useAnimationStore.ts:480-485` (subscribe cross-store implicite).

**Reco** : commande backend `restore_show` transactionnelle ; regrouper update_global_graph+origin ; les slices ne doivent pas connaître l'ordre des locks ni les protocoles de compensation.

### A7 — `IpcError::classify` : classification par sniffing de strings

`commands/error.rs:74-103` — `code` dérivé de sous-chaînes lowercase ; renommer un message interne = breaking change silencieux du contrat wire.

**Reco** : `StagespaceError` typé interne → map par variant vers `IpcError` ; supprimer `classify`.

### A8 — Frontières mal placées pour tester

`compile` exige `LiveInputs.plugins` (wasmtime) pour **valider** un graphe plugin ; `Compiler` importe infra runtime ; pas de `rust-engines/tests/` d'intégration (contrat graph_json, golden `.hfg` non testés) ; commands mélangent parse+compile+locks+spawn ; slices mélangent état/IPC/localStorage.

**Reco** : séparer `validate(graph, catalogue)` pur de `resolve_plugin_kinds` ; `build_graph_from_json` pure testée sur fixtures ; tests de contrat round-trip. Prérequis aux refactors A1-A3.

### A9 — Chemins morts et legacy

`frontend/` racine = app React **abandonnée** complète ; `overrides.rs:8-22` `set_object_override` enregistré jamais appelé ; `sampling.rs:64-81` `sample_trajectory` retourne toujours `[]` ; `compiler.rs:78-84` `_overrides` ignoré pour "compat" ; `playback.rs:9-13` commentaire d'un chemin supprimé.

**Reco** : purge avant 1.0 — commande sans appelant = supprimée ou `#[deprecated]`+issue.

## 🟡 Mineurs

| # | Fichier | Finding |
|---|---|---|
| A10 | `transforms.rs:58-60`, `graph_updates.rs` | Graphe global = liste linéaire déguisée en DAG (Zone/Velocity extraits, Merge→stratégie, Input→terminus) — DAG constructible mais tronqué silencieusement → contraindre l'UI ou donner une vraie sémantique de branche |
| A11 | `moveSlotsSlice.ts:243-251` vs backend | Deux réconciliateurs des moves actifs (pendingPlays, fading, orphans) → backend = source unique (`list_active_moves`+event), frontend = cache TTL |
| A12 | `sampling.rs:100-132` | Index local vs global confus, deux `usize` → newtypes `LocalIndex`/`GlobalTrackIndex` |
| A13 | `compiler.rs` 1148 l., `validator.rs` 1047, `merge_runtime` ~1200, `moveSlotsSlice.ts` ~960 | Au seuil de lisibilité — la table `NodeSpec` absorbe mécaniquement la moitié |

---

# 3. Audit UX/UI

Périmètre : `tauri-app/frontend/src`. Références : DAW/consoles live (QLab, Bitwig, TouchDesigner, SPAT).

## 🔴 Bloquants / Critiques

### U1 — PANIC en Perform inerte sans indication pendant un recall

`PerformView.tsx:124-128` — `if (isRecalling) return;` silencieux : le bouton semble actif, rien ne se passe. Et `Esc` panique toujours (`useLiveShortcuts.ts:35-51` ne vérifie pas `isRecalling`) → incohérence bouton/raccourci.

**Fix** : panic jamais bloqué (il doit survivre à tous les états) ; sinon `disabled` + "RECALLING…" ; le panic doit annuler/attendre le recall côté store.

### U2 — PANIC sous-dimensionné vs GO

`PerformView.tsx:115-133` : GO `px-8 py-2.5 text-lg font-black` vs PANIC `px-5 py-2.5 text-sm` ; `Toolbar.tsx:202-208` : PANIC `text-xs` = poids du bouton Undo adjacent. Sur une console de show, l'arrêt d'urgence domine.

**Fix** : `px-6 py-2.5 text-lg font-black ring-2 ring-red-400/60` en Perform ; Toolbar `ring-1 ring-red-500` + séparateur.

### U3 — `.live-mode` = CSS mort

`index.css:134-162` définit l'agrandissement live (font 14px, `.text-[10px]`→12px) — **jamais appliqué** (0 occurrence). La lisibilité à 2 m est cassée.

**Fix** : appliquer sur le conteneur PerformView (`:66`) ; ⚠️ `.live-mode .px-3` trop large — restreindre aux textes.

### U4 — Hiérarchie live tout en 10px, illisible à 2 m

`PerformView.tsx:75-77` statut `text-sm` ; `:95-102` "Setlist 1/5"+next `text-[10px] gray-500` — le NEXT cue est l'info la plus regardée en show → `text-2xl font-bold` (modèle QLab) ; `:179-197` slots `text-xs`, meta gray-600 (~2.6:1) ; `:216` cue list `h-56` fixe (~6 cues), rows `text-[11px]`.

**Fix** : zone "NOW/NEXT" grande typo dans la top bar ; slot names `text-base` ; cue rows `py-3 text-sm` ; panel redimensionnable.

### U5 — Pas d'indicateur FPS/OSC/CPU en Perform

`Toolbar.tsx:223-235` démonté en Perform ; PerformView n'a que `oscRate` en `text-[10px]` (:78-88), rien si 0 move. Thread merge mort = toast unique puis silence.

**Fix** : chip perf persistant en top bar Perform (`{fps} fps · {oscRate} osc/s` font-mono `text-xs`), rouge si `oscErrorRate>5%` ou `threadDied` + clignotant.

### U6 — Bannière erreur compile/play invisible en Perform

`Toolbar.tsx:239-244` démonté en Perform — erreur hot-swap = toast éphémère seulement.

**Fix** : bandeau erreur remonté dans `App.tsx` (commun aux deux modes).

## 🟠 Importants

### U7 — Contrastes systématiquement sous WCAG AA

`gray-700`/`gray-600` sur fonds `#12121a`/`#0a0a0f` ≈ 1.9–2.6:1 (requis 4.5:1) ; **337 occurrences** de `text-[9-11px]`. Ex. : `App.tsx:180` tagline, `NodeEditor.tsx:635-640` aide flows, `Toolbar.tsx:218` version `text-[9px] gray-700` invisible.

**Fix** : tokens `tailwind.config.js` (`ss-dim #9ca3af`, `ss-faint #6b7280` décoratif only) ; plancher gray-400 pour tout texte informatif.

### U8 — Cibles de clic < 24px hors Perform

`MovesTable.tsx:428-487` actions ~20×20px, `:391-411` ▲▼, `CuelistPanel.tsx:211-220`, `CustomNode.tsx:254-260`, splitters `w-1.5` (6px de grab, `App.tsx:285,410`), track sliders `h-1.5` (`ui/Slider.tsx:66`).

**Fix** : min 24px partout ; thumb slider épais ; splitters `w-2` + zone hover élargie.

### U9 — `ui/IconButton` jamais adopté

`ui/IconButton.tsx` créé pour uniformiser ~30 instances — 0 usage hors tests ; variations ad hoc partout.

**Fix** : adopter (Toolbar, MovesTable, CuelistPanel) ou supprimer.

### U10 — Double indicateur de statut aux labels divergents

`App.tsx:158-169` ("N live") vs `Toolbar.tsx:89-101` ("N movements"+"Compiled") — deux points de statut à ~50px, mots différents.

**Fix** : `StatusDot` partagé, fusionner.

### U11 — Aucun focus visible sur les boutons

31 `focus:border-*` sur inputs, **zéro** `focus-visible:ring` sur boutons ; `useLiveShortcuts.ts:127-132` blur() les boutons cliqués.

**Fix** : `button:focus-visible { outline: 2px solid #3b82f6 }` dans `index.css`.

### U12 — Iconographie mixte glyphes Unicode / Lucide

`◼` (Toolbar:207) vs `■` (PerformView:132) vs `TriangleAlert` (Inspector:553) — trois rendus du même arrêt d'urgence ; `◉/◎/★/▶/▸/▾/↻` mêlés à lucide-react.

**Fix** : Lucide partout (`OctagonX`/`Square` panic, identité unique).

### U13 — Bilinguisme résiduel FR/EN

`ConfirmModal.tsx:29` "Annuler", `MovesTable.tsx:537-541` "Nom du cue", `AnimationList.tsx:166` "Sauvegarder dans ma bibliothèque", `Inspector.tsx:425,431` "Vitesse/Fondu", `PerformView.tsx:364,372` "tap un move"/"édition :", `MovesTable.tsx:394` "Monter dans la setlist".

**Fix** : tout EN (convention DAW) + extraction des strings si i18n prévu.

### U14 — "Sub-graph" vs "Global" opaque

`NodeEditor.tsx:404-425` — tabs `text-[10px]` sans tooltip ni explication ; "Sub-graph" est du jargon interne.

**Fix** : renommer `Move graph`/`Master FX` + titles + hint "applies to all live moves" sur le tab global.

### U15 — Pin-to-Perform invisible

`NodeParamsPanel.tsx:164-176` — toggle `text-gray-700` quasi invisible, découvrable uniquement au hover.

**Fix** : pin `gray-500` min ; hint dans l'empty state Perform ("📌 icon on each field in Edit").

### U16 — `storeCue` échoue silencieusement

`CuelistPanel.tsx:87-89` — catch → `console.error` seul ; un cue non enregistré en show = catastrophe invisible.

**Fix** : `toast.error(...)`.

### U17 — `ConfirmModal` : commentaire mensonger

`ConfirmModal.tsx:5` prétend "Enter = confirmer" mais `Modal` focus le premier focusable = "Annuler" → Enter annule (safe mais doc fausse).

**Fix** : `autoFocus` sur confirm ou corriger le commentaire.

### U18 — Autopatch : affordance faible

`NodeEditor.tsx:166-170,453-456` — hint `text-[11px] gray-500` en palette ; l'edge sélectionnée garde le stroke bleu générique (`index.css:70`).

**Fix** : classe `.rf-edge-insert-target` (dash animé cyan) + badge "INSERT MODE" persistant.

## 🟡 Mineurs / Polish

| # | Fichier | Finding → fix |
|---|---|---|
| U19 | `App.css` (tout) | Boilerplate Vite mort en conflit avec `index.css` (`#root`) → supprimer |
| U20 | `Modal.tsx:83` | Bouton close = caractère `✕` → `<X/>` Lucide |
| U21 | `App.tsx:188-207` | Toggle Perform affiche l'état (◉ Perform) — action vs état ambigu → label fixe + état on/off |
| U22 | `TrackGrid.tsx:31,34-41` | `'pairs'` dans le type mais absent de `PATTERNS` ; `icon` jamais rendu → dead code |
| U23 | `App.tsx:331` | Toggle `DEBUG PERF` visible en prod → `import.meta.env.DEV` ou Settings |
| U24 | `Inspector.tsx:545-547` | "Launch via MovesTable ▶" zone morte permanente → vrai lien d'action ou rien |
| U25 | `PerformView.tsx:104-112` | Feedback GO `text-[10px]` — une erreur GO en live mérite `text-sm font-bold` |
| U26 | `useLiveShortcuts.ts:111` | Pattern `toast.info('No move selected…')` à généraliser |
| U27 | `App.tsx:337` | Hint "orbit: drag · zoom: scroll" `text-[10px] gray-600` → gray-500 |

## Recommandations transverses

1. Brancher `.live-mode` sur PerformView — quick win pour toute la typo live.
2. `StatusBar` partagée (dot + label + FPS/OSC/CPU + erreurs) montée dans `App.tsx`, Edit **et** Perform — résout U5, U6, U10.
3. Tokens sémantiques tailwind (`ss-text/ss-dim/ss-faint/ss-live/ss-warn/ss-panic`) + sweep `gray-600/700`→`ss-faint`.
4. Perform typo : NEXT `text-2xl`, slot names `text-base`, LIVE `text-lg`, cue rows `py-3` — cible lisible 2 m.
5. PANIC identité unique (Lucide `OctagonX`+label, `ring-2`), jamais inerte, flash overlay rouge bref.
6. Tout EN, strings extraites.
