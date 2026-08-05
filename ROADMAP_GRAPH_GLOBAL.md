# Plan d'Action : Graph Global Hybride

Référence architecturale : `ARCHITECTURE_FUTURE.md`

Architecture retenue : **hybride multi-threadée** — engines compilés en worker threads parallèles, merge + post-processing dans un thread unique, fast path atomique pour le live control.

**Principes directeurs** : souplesse (per-move ou global, au choix) et intuitivité (sliders pour le live, nodes pour le design).

---

## Phase 1 : Merge Node + MergeRuntime

**Objectif** : Workers parallèles + merge thread unique + une seule socket OSC.
**Durée estimée** : 3-5 sessions de travail.
**Risque** : moyen (refactor minimal du runtime existant, nouveau MergeRuntime).

### Étape 1.1 : PositionBuffer struct (Rust)

**Fichiers** :
- `rust-engines/src/position_buffer.rs` (nouveau)
- `rust-engines/src/lib.rs` (export)

**Tâches** :
- [ ] Créer `PositionBuffer` struct (lock simple, pas de double buffer) :
  ```rust
  pub struct PositionBuffer {
      positions: Mutex<Vec<(usize, Vector3<f64>)>>,
  }
  ```
- [ ] `write(positions)` : worker écrit sous le lock
- [ ] `read() -> Vec<(usize, Vector3<f64>)>` : merge lit sous le lock (clone ~200 bytes)
- [ ] `read_stale() -> Vec<(usize, Vector3<f64>)>` : retourne la dernière frame si worker pas prêt (pas de blocking)
- [ ] Tests unitaires : write/read concurrent, pas de deadlock

**Note** : Mutex simple suffit pour 9 objets (~200 bytes). Pas de double buffer front/back.

### Étape 1.2 : Modifier les workers Runtime existants

**Fichiers** :
- `rust-engines/src/runtime.rs` (modifier boucle de playback)

**Tâches** :
- [ ] Ajouter champ `position_buffer: Option<Arc<PositionBuffer>>` au `Runtime`
  - `None` = mode legacy (OSC direct, compatibilité)
  - `Some(buf)` = mode worker (écrit dans buffer, pas d'OSC)
- [ ] Dans la boucle de playback (lignes 202-467) :
  - Si `position_buffer` est `Some` :
    - Calculer `raw_pos = fn_ref(t, i)` (sub-graph compilé)
    - Appliquer **speed** (per-move, reste dans le worker)
    - Appliquer **loop_mode** et **direction** (per-move, reste dans le worker)
    - Appliquer **phase_offset** (per-track, reste dans le worker)
    - Écrire `[(i, pos), ...]` dans le buffer
    - **Ne pas** appliquer scale, rotation, shift, radius_scale, height_offset, depth (montent dans le merge thread)
    - **Ne pas** envoyer OSC
    - **Ne pas** émettre d'event Tauri
  - Si `position_buffer` est `None` :
    - Comportement actuel (legacy, compatibilité)
- [ ] Ajouter `set_position_buffer(&mut self, buffer: Arc<PositionBuffer>)`
- [ ] Ajouter `unset_position_buffer(&mut self)` (retour en mode legacy)
- [ ] Garder `set_speed()` per-move (fast path atomic dans RuntimeConfig)
- [ ] Tests : worker en mode buffer ne fait pas d'OSC, n'applique pas de macros spatiales

### Étape 1.3 : MergeRuntime struct (Rust)

**Fichiers** :
- `rust-engines/src/merge_runtime.rs` (nouveau)
- `rust-engines/src/lib.rs` (export)

**Tâches** :
- [ ] Créer `MergeRuntime` struct :
  ```rust
  pub struct MergeRuntime {
      thread: Option<JoinHandle<()>>,
      running: Arc<AtomicBool>,
      socket: UdpSocket,
      osc_sender: Arc<Mutex<OscSender>>,
      move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
      active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
      // Macros spatiales seulement (scale, rotation, shift, radius_scale, height_offset)
      // PAS speed (speed reste per-move dans les workers)
      macros: Arc<MacroState>,
      audio_state: Arc<Mutex<AudioState>>,  // partagé avec les workers
      origin: Arc<Mutex<Vector3<f64>>>,
      osc_ids: Arc<RwLock<Vec<u32>>>,
      merge_strategy: Arc<RwLock<MergeStrategy>>,
      perf: Arc<PerfMonitor>,
      position_callback: Arc<Mutex<Option<Box<dyn Fn(f64, &[(usize, Vector3<f64>)]) + Send + Sync>>>>,
  }
  ```
- [ ] Créer `MoveState` struct :
  ```rust
  struct MoveState {
      osc_ids: Vec<u32>,
      track_indices: Vec<usize>,
      fade_in_remaining: f64,
      fade_out_remaining: f64,
      fade_in_duration: f64,
      fade_out_duration: f64,
      weight: f64,
      is_active: bool,
      is_preview: bool,
  }
  ```
- [ ] Créer `MergeStrategy` enum :
  ```rust
  enum MergeStrategy {
      Override,      // dernier move actif gagne
      Crossfade,     // blend pondéré par fade
      Blend,         // moyenne pondérée
      Priority,      // move avec priorité la plus haute
  }
  ```
- [ ] Implémenter `MergeRuntime::start()` : démarre le merge thread
- [ ] Implémenter `MergeRuntime::stop()` : arrête le thread proprement
- [ ] Implémenter la boucle du merge thread :
  ```
  1. Lire tous les buffers (lock simple, latest frame)
  2. Pour chaque track_id, résoudre les positions multiples selon MergeStrategy
  3. Appliquer fade (fade_in/fade_out) par move
  4. Appliquer macros spatiales (scale, rotation, shift, radius_scale, height_offset)
     — code existant déplacé depuis runtime.rs
  5. Appliquer depth + origin — code existant déplacé
  6. Séparer display positions (tout) de OSC positions (exclut preview)
  7. Envoyer OSC (une seule socket, osc_positions seulement)
  8. Callback position (un seul event, display_positions)
  9. Perf monitor
  ```
- [ ] Implémenter `resolve_merge()` pour chaque stratégie :
  - `Override` : pour chaque track, prendre la position du move avec le poids le plus élevé
  - `Crossfade` : blend linéaire entre moves actifs pondéré par weight * fade
  - `Blend` : moyenne pondérée de toutes les positions
  - `Priority` : move avec priorité la plus haute gagne
- [ ] Implémenter `register_move(move_id, buffer, osc_ids, track_indices, is_preview)`
- [ ] Implémenter `unregister_move(move_id)`
- [ ] Implémenter `set_merge_strategy(strategy)`
- [ ] Implémenter `set_macros(request)` (fast path atomic, spatiales seulement)
- [ ] Implémenter `set_origin(origin)`
- [ ] Implémenter `set_osc_ids(osc_ids)` (quand la sélection de tracks change)
- [ ] Implémenter la séparation preview : display_positions = tout, osc_positions = exclut preview
- [ ] Gestion du crash : watchdog détecte si un worker n'a pas écrit depuis > 2 frames → unregister

**Tests** :
- [ ] Test unitaire : 2 moves sur le même track → merge override
- [ ] Test unitaire : 2 moves sur le même track → merge crossfade
- [ ] Test unitaire : fade in/out d'un move
- [ ] Test unitaire : un worker crash → merge skip, autres continuent
- [ ] Test unitaire : macros spatiales appliquées une seule fois
- [ ] Test unitaire : preview mode → display mais pas d'OSC
- [ ] Test unitaire : speed reste per-move (vérifier que le merge thread ne touche pas à speed)

### Étape 1.4 : Commands Tauri (Rust)

**Fichiers** :
- `tauri-app/src-tauri/src/commands/movements.rs` (refactor)
- `tauri-app/src-tauri/src/commands/playback.rs` (refactor)
- `tauri-app/src-tauri/src/lib.rs` (register commands)
- `tauri-app/src-tauri/src/state.rs` (AppState avec MergeRuntime)

**Tâches** :
- [ ] Ajouter `MergeRuntime` à `AppState` :
  ```rust
  pub struct AppState {
      merge_runtime: Mutex<MergeRuntime>,
      movements: Mutex<HashMap<String, Movement>>,  // workers existants
      audio_state: Arc<Mutex<AudioState>>,  // partagé workers + merge
      // ... reste inchangé
  }
  ```
- [ ] `activate_move(move_id, graph_json, osc_ids, track_indices, is_preview, origin)` :
  1. Compiler le sub-graph
  2. Créer un `Runtime` worker avec le sub-graph
  3. Partager `audio_state` avec le worker (déjà le cas)
  4. Créer un `PositionBuffer` et l'attacher au worker
  5. Démarrer le worker thread
  6. `merge_runtime.register_move(move_id, buffer, osc_ids, track_indices, is_preview)`
  7. Démarrer le merge runtime si pas déjà démarré
  8. Émettre `active-moves-update`
- [ ] `deactivate_move(move_id, fade_duration)` :
  1. `merge_runtime.start_fade_out(move_id, fade_duration)`
  2. Quand fade terminé : `merge_runtime.unregister_move(move_id)`
  3. Stop le worker thread
  4. Émettre `active-moves-update`
- [ ] `deactivate_all_moves(fade_duration)` :
  1. Fade out tous les moves actifs
  2. Quand tous les fades terminés : stop tous les workers
- [ ] `update_move_graph(move_id, graph_json, fade_duration)` :
  1. Recompiler le sub-graph
  2. Hot-swap dans le worker (recall_cue existant)
- [ ] `set_merge_strategy(strategy)` :
  1. `merge_runtime.set_merge_strategy(strategy)`
- [ ] `set_macro(request)` (fast path, spatiales seulement) :
  1. `merge_runtime.set_macros(request)` (une seule fois, pas par movement)
- [ ] `set_move_speed(move_id, speed)` (nouveau, per-move) :
  1. `movements[move_id].runtime.set_speed(speed)` (fast path atomic dans le worker)
- [ ] `set_audio_state(state)` (inchangé) :
  1. Update `audio_state` (partagé avec workers + merge thread)
- [ ] **Supprimer** `set_movement_macro` (plus de macros spatiales per-movement)
- [ ] Event `global-positions` (un seul, remplace `movement-positions-{id}`)
- [ ] Event `active-moves-update` (remplace `movements-update`)

**Tests** :
- [ ] Test intégration : activate → deactivate → vérifier pas de leak
- [ ] Test intégration : 2 moves actifs → 1 seul flux OSC
- [ ] Test intégration : hot-swap graph pendant playback
- [ ] Test intégration : merge strategy change en live
- [ ] Test intégration : speed per-move (2 moves à des vitesses différentes)
- [ ] Test intégration : preview mode → 3D voit, OSC n'envoie pas

### Étape 1.5 : Frontend — adapter les appels IPC

**Fichiers** :
- `tauri-app/frontend/src/store/slices/moveSlotsSlice.ts` (playSlot, stopSlot)
- `tauri-app/frontend/src/store/slices/macrosSlice.ts` (pushMacrosToRuntime)
- `tauri-app/frontend/src/store/useGraphStore.ts` (listeners)

**Tâches** :
- [ ] `playSlot` : appeler `activate_move` au lieu de `play_movement`
  - Passer `osc_ids`, `track_indices`, `is_preview`, `origin`
- [ ] `stopSlot` : appeler `deactivate_move` au lieu de `stop_movement`
- [ ] `stopAllSlots` : appeler `deactivate_all_moves` au lieu de `stop_all_movements`
- [ ] `pushMacrosToRuntime` : appeler `set_macro` **une seule fois** (pas par movement)
  - Seulement les macros spatiales (scale, rotation, shift, radius_scale, height_offset)
- [ ] `pushSpeedToRuntime` : appeler `set_move_speed` par move (per-move)
- [ ] `usePositionListener` : écouter `global-positions` au lieu de `movement-positions-{id}`
- [ ] `useMovementPositionsListener` : simplifier — un seul event
- [ ] `syncSlotMovements` : adapter pour `active-moves-update`
- [ ] Ajouter UI pour merge strategy (dropdown dans Inspector ou toolbar)

**Tests** :
- [ ] Test E2E : play un move → positions arrivent via `global-positions`
- [ ] Test E2E : play 2 moves → 1 seul flux de positions
- [ ] Test E2E : stop un move → fade out → positions s'arrêtent
- [ ] Test E2E : changer merge strategy en live
- [ ] Test E2E : speed per-move (2 moves à des vitesses différentes)

### Étape 1.6 : Frontend — render loop simplifié

**Fichiers** :
- `tauri-app/frontend/src/hooks/useRenderLoop.ts`

**Tâches** :
- [ ] Supprimer le merge côté frontend (lignes 226-265) — le merge est fait côté Rust
- [ ] Lire les positions depuis le callback global (un seul `positions` array)
- [ ] Mapper `positions[i]` → `objectsRef.current[i]` (0-based direct)
- [ ] Supprimer la logique multi-movement (`mvPosMaps`, etc.)

**Tests** :
- [ ] Test E2E : 2 moves → objets affichés correctement
- [ ] Test E2E : objets ne tremblent plus quand 2 moves ciblent le même track

### Étape 1.7 : Migration et cleanup

**Tâches** :
- [ ] Migration : les moveSlots existants fonctionnent toujours (même graph_json)
- [ ] Speed reste dans les moveSlots (per-move)
- [ ] Macros spatiales poussées au merge runtime (une seule fois)
- [ ] Tests complets : Rust, TS 0 erreurs, Playwright 51+

---

## Phase 2 : Post-processing graph

**Objectif** : Macros spatiales + audio mods + depth + origin + manual positions → nodes du graph global.
**Durée estimée** : 5-8 sessions.
**Risque** : élevé (refactor compiler + UI).

### Étape 2.1 : PostProcessFn type et compiler (Rust)

**Fichiers** :
- `rust-engines/src/engines/mod.rs` (PostProcessFn type)
- `rust-engines/src/compiler.rs` (nouveau compile_post_process)

**Tâches** :
- [ ] Définir `PostProcessFn` :
  ```rust
  type PostProcessFn = Box<dyn Fn(
      f64,                                    // t
      Vec<(usize, Vector3<f64>)>,            // positions mergées
      &MacroState,                            // fast path macros spatiales
      &AudioState,                            // audio state (pour AudioFalloff)
      &HashMap<u32, [f64; 3]>,               // track positions (pour Barycenter)
      &HashMap<usize, [f64; 3]>,             // manual positions (pour ManualPos)
  ) -> Vec<(usize, Vector3<f64>)> + Send + Sync>;
  ```
- [ ] Implémenter `compile_post_process(global_graph, audio, track_positions)` :
  - Parcourt les nodes du graph global
  - Compile chaque Transform node (Scale, Rotate, Offset) en closure
  - Compile les AudioFalloff nodes (lecture AudioState)
  - Compile le PerTrackDepth node (indexé par object_index)
  - Compile le Barycenter node (calcul origin depuis track_positions)
  - Compile le ManualPosition node (override depuis manual_positions)
  - Chaîne les closures selon les edges du graph
- [ ] Les params des Transform nodes sont liés à des `Arc<AtomicU64>` (fast path)
- [ ] Hot-swap : `merge_runtime.swap_post_process_fn(new_fn)` avec crossfade

### Étape 2.2 : Transform nodes dans le graph global (Rust)

**Fichiers** :
- `rust-engines/src/engines/transform.rs` (nouveau)

**Tâches** :
- [ ] `ScaleNode` : `pos * scale_ref.load()` (atomic fast path)
- [ ] `RotateNode` : rotation matrix from yaw/pitch/roll refs
- [ ] `ShiftNode` : `pos + shift_ref.load()`
- [ ] `RadiusScaleNode` : `origin + (pos - origin) * radius_ref.load()`
- [ ] `HeightOffsetNode` : `pos.y + height_ref.load()`
- [ ] `PerTrackDepthNode` : `origin + (pos - origin) * depths[i] * fade`
  - Prend un array de depths, indexe par object_index
- [ ] `BarycenterNode` : calcule origin depuis track_positions (positions .hol)
- [ ] `AudioFalloffNode` : lit AudioState, produit [0,1], modifie un paramètre
- [ ] `ManualPositionNode` : override la position pour certains objets
  - Lit manual_positions HashMap
  - Si entry existe pour cet objet → override
  - Sinon → garde la position calculée

### Étape 2.3 : MergeRuntime — supprimer la chaîne hardcoded

**Fichiers** :
- `rust-engines/src/merge_runtime.rs`

**Tâches** :
- [ ] Remplacer les lignes de post-processing hardcodées par :
  ```rust
  let transformed = post_process_fn(
      t, merged, &macros, &audio_state, &track_positions, &manual_positions
  );
  ```
- [ ] Le MergeRuntime ne fait plus que : lire buffers → merge → post_process_fn → OSC
- [ ] Ajouter `swap_post_process_fn(new_fn, fade_duration)` pour hot-swap
- [ ] Speed reste per-move (dans les workers, inchangé)

### Étape 2.4 : Frontend — graph global editor

**Fichiers** :
- `tauri-app/frontend/src/components/NodeEditor.tsx`
- `tauri-app/frontend/src/store/useGlobalGraphStore.ts` (nouveau)
- `tauri-app/frontend/src/components/nodeParamSchema.ts` (ajouter nodes globaux)

**Tâches** :
- [ ] Créer `useGlobalGraphStore` (nodes + edges du graph global)
- [ ] Ajouter tab "Global" dans le NodeEditor
- [ ] MoveRef nodes : références vers les sub-graphs des moves
- [ ] Transform nodes : Scale, Rotate, Shift, RadiusScale, HeightOffset
- [ ] AudioFalloff nodes : source + target + amount
- [ ] PerTrackDepth node : array de depths (un slider par track dans l'Inspector)
- [ ] Barycenter node : calcul origin (lit track positions)
- [ ] ManualPosition node : override positions (connecté au drag 3D)
- [ ] Output node : terminal
- [ ] Compiler le graph global → `update_global_graph` command
- [ ] **Souplesse** : un node Scale peut être placé dans le sub-graph (per-move) OU dans le graph global (post-merge)

### Étape 2.5 : Perform Panel

**Fichiers** :
- `tauri-app/frontend/src/components/PerformPanel.tsx` (nouveau)

**Tâches** :
- [ ] Vue sliders des params des nodes du graph global
- [ ] Scale, Rotate, Shift, Radius, Height → sliders (fast path atomic)
- [ ] AudioFalloff amount → slider
- [ ] PerTrackDepth → un slider par track
- [ ] Sync bidirectionnelle : slider ↔ node param (même donnée)
- [ ] **Intuitivité** : le musicien voit des sliders, pas des nodes. Deux vues, mêmes données.

### Étape 2.6 : ManualPositions sync (drag 3D)

**Fichiers** :
- `tauri-app/frontend/src/hooks/useManipulateMode.ts`
- `tauri-app/frontend/src/store/slices/holProjectSlice.ts`

**Tâches** :
- [ ] Drag d'un objet dans le 3D view → invoke `set_manual_position(obj_idx, [x,y,z])`
- [ ] L'objet reste à sa position manuelle (ManualPosition node l'applique)
- [ ] Double-clic ou bouton "libérer" → invoke `clear_manual_position(obj_idx)`
- [ ] L'objet revient à la position calculée par le graph
- [ ] Si le graph global n'a pas de ManualPosition node → le créer automatiquement (default)

### Étape 2.7 : Track positions sync (pour Barycenter)

**Fichiers** :
- `tauri-app/frontend/src/store/slices/holProjectSlice.ts`

**Tâches** :
- [ ] Au chargement d'un .hol → invoke `set_track_positions(positions_map)`
- [ ] Le Barycenter node lit ces positions pour calculer l'origin
- [ ] Si pas de .hol → track_positions vide → origin = [0,0,0]

### Étape 2.8 : Migration

**Tâches** :
- [ ] Script de migration : pour chaque moveSlot existant
  - Macros spatiales (scale, rotation, shift, radius_scale, height_offset) → Transform nodes dans le graph global
  - Speed reste dans le slot (per-move)
  - Audio mods → AudioFalloff nodes dans le graph global
  - Per-track depths → PerTrackDepth node dans le graph global
- [ ] Supprimer `useAnimationStore.audio_mods` (remplacé par nodes)
- [ ] Supprimer `MacrosState` spatial (remplacé par params de nodes, exposés via Perform Panel)
- [ ] Garder `speed` dans `MacroState` per-move (dans les workers)

---

## Phase 3 : Unified graph

**Objectif** : Tout est graph, nested editor, MoveRef nodes, cue system étendu.
**Durée estimée** : 8-12 sessions.
**Risque** : élevé (UI majeure, migration données).

### Étape 3.1 : MoveRef nodes

**Tâches** :
- [ ] Node `MoveRef` dans le graph global : référence un sub-graph par ID
- [ ] Double-clic → ouvre le sub-graph dans un nouvel onglet
- [ ] Le sub-graph est stocké dans `useMoveGraphStore[moveId]`
- [ ] Le compiler résout les MoveRef → injecte la PositionFn du sub-graph

### Étape 3.2 : Nested graph editor

**Tâches** :
- [ ] Tabs : "Global" + un tab par sub-graph actif
- [ ] Breadcrumb : Global > Move A > (sub-graph)
- [ ] React Flow : un instance par tab, ou nested nodes
- [ ] Drag & drop : MoveRef depuis la palette vers le graph global

### Étape 3.3 : Cue system étendu

**Fichiers** :
- `rust-engines/src/cuelist.rs`
- `tauri-app/src-tauri/src/commands/cue_recall.rs`

**Tâches** :
- [ ] Étendre `Cue` struct :
  ```rust
  pub struct Cue {
      pub graph: GraphJson,                    // sub-graph du move
      pub macros: MacroSnapshot,               // macros spatiales
      pub track_indices: Vec<usize>,
      pub fade_duration: f64,
      pub cue_number: String,
      // Nouveau :
      pub global_graph: Option<GraphJson>,     // graph global
      pub active_move_ids: Vec<String>,        // quels moves sont actifs
      pub audio_mods: Option<AudioModSnapshot>, // audio mods (devenus nodes)
      pub per_track_depths: Vec<f64>,          // depth per-track
      pub manual_positions: HashMap<usize, [f64; 3]>, // overrides manuels
  }
  ```
- [ ] Recall :
  1. Désactiver les moves qui ne sont pas dans `active_move_ids`
  2. Activer les moves qui y sont (avec fade)
  3. Hot-swap le graph global si `global_graph` est présent
  4. Restaurer les macros spatiales (fast path atomic)
  5. Restaurer les per-track depths
  6. Restaurer les manual positions

### Étape 3.4 : Suppression des vestiges

**Tâches** :
- [ ] Supprimer `play_movement`/`stop_movement` (legacy)
- [ ] Supprimer `Runtime` legacy mode (sans buffer)
- [ ] Supprimer `useAnimationStore` (metadata migrée vers moveSlots)
- [ ] Supprimer `AnimationState` Rust (audio mods = nodes, depth = PerTrack node)
- [ ] Supprimer `compute_audio_modulated_params` (remplacé par AudioFalloff nodes)
- [ ] Supprimer le node `Objects` (n_objects = osc_ids.len(), pas besoin)
- [ ] Simplifier `MovesTable` : juste template + tracks + play/stop + speed

### Étape 3.5 : Merge node UI

**Tâches** :
- [ ] Node `Merge` dans la palette du graph global
- [ ] Inputs : N entrées (une par MoveRef actif)
- [ ] Params : strategy (override/crossfade/blend/priority), fade_duration
- [ ] Visualisation : montre les moves actifs et leurs poids

---

## Ordre de priorité

```
Phase 1 (court terme) ──── Merge + MergeRuntime (hybride)
  │
  ├── 1.1 PositionBuffer struct
  ├── 1.2 Modifier workers Runtime (buffer mode, garder speed/loop/dir)
  ├── 1.3 MergeRuntime struct + merge thread
  ├── 1.4 Commands Tauri (activate/deactivate/set_move_speed)
  ├── 1.5 Frontend IPC
  ├── 1.6 Render loop simplifié
  └── 1.7 Migration + cleanup
        │
Phase 2 (moyen terme) ──── Post-processing graph
  │
  ├── 2.1 PostProcessFn + compiler
  ├── 2.2 Transform nodes (Scale, Rotate, Shift, PerTrackDepth, Barycenter, ManualPos)
  ├── 2.3 MergeRuntime cleanup (supprimer hardcoded)
  ├── 2.4 Global graph editor (frontend)
  ├── 2.5 Perform Panel
  ├── 2.6 ManualPositions sync (drag 3D)
  ├── 2.7 Track positions sync (pour Barycenter)
  └── 2.8 Migration
        │
Phase 3 (long terme) ──── Unified graph
  │
  ├── 3.1 MoveRef nodes
  ├── 3.2 Nested editor
  ├── 3.3 Cue system étendu
  ├── 3.4 Cleanup vestiges
  └── 3.5 Merge node UI
```

## Critères de validation par phase

### Phase 1
- [ ] 2 moves sur le même track → pas de tremblement
- [ ] 1 seule socket UDP → 1 seul flux OSC
- [ ] Fade in/out fonctionne
- [ ] Hot-swap de sub-graph pendant playback
- [ ] Workers en parallèle (vérifier CPU usage avec engines complexes)
- [ ] Crash isolation : un worker crash → autres continuent
- [ ] Speed per-move : 2 moves à des vitesses différentes
- [ ] Preview mode : 3D voit le move, OSC ne l'envoie pas
- [ ] UI inchangée (pas de régression)
- [ ] Latence < 1 frame ajoutée (16ms max, acceptable)

### Phase 2
- [ ] Macros spatiales = nodes Transform dans le graph global
- [ ] Audio mods = nodes AudioFalloff
- [ ] Depth = PerTrackDepth node (indexé par object_index)
- [ ] Origin = Barycenter node (lit track positions .hol)
- [ ] ManualPositions = ManualPosition node (drag 3D → override)
- [ ] Ordre des transformations configurable
- [ ] Perform Panel pour le live control (sliders)
- [ ] Plus de chaîne hardcoded dans le MergeRuntime
- [ ] Fast path atomique pour tous les params live
- [ ] Speed reste per-move (dans les workers)
- [ ] Souplesse : Transform per-move (sub-graph) OU global (graph global)

### Phase 3
- [ ] MoveRef nodes dans le graph global
- [ ] Nested editor (tabs + double-clic)
- [ ] Cue system étendu (snapshot graph global + moves actifs + audio mods + depths + manual positions)
- [ ] MovesTable simplifié
- [ ] Plus de AnimationState ni Objects node
- [ ] Plus de commands legacy

## Notes techniques

### Buffer — latence acceptable

Le buffer (Mutex simple) ajoute 0-1 frame de latence (16ms max à 60fps). C'est acceptable pour du spatial audio :
- L'oreille humaine ne détecte pas de latence < 30ms
- Holophonix a déjà une latence réseau de ~5-10ms
- Le total reste bien en dessous du seuil perceptible

### Crash isolation — stratégie

Si un worker crash (panic Rust) :
1. Le `PositionBuffer` garde la dernière frame valide
2. Le merge thread lit la frame stale (1 frame de retard, invisible)
3. Un watchdog détecte le worker crash (pas de write depuis > 2 frames)
4. Le merge thread unregister le move crashé
5. Les autres moves continuent normalement
6. Event `active-moves-update` émis pour notifier le frontend

Si le merge thread crash :
1. Le watchdog le redémarre automatiquement
2. Les workers continuent d'écrire dans leurs buffers
3. Le merge thread recommence à lire les buffers
4. Latence : ~1s (temps de restart), acceptable pour un cas rare

### Speed vs macros spatiales — la séparation

| Paramètre | Niveau | Pourquoi |
|---|---|---|
| `speed` | Per-move (worker) | Affecte `t`. Deux moves à des vitesses différentes. |
| `loop_mode` | Per-move (worker) | Loop vs OneShot. Per-move. |
| `direction` | Per-move (worker) | Forward/Backward/PingPong. Per-move. |
| `phase_offset` | Per-move (worker, sub-graph) | Per-track, décalage temporel. |
| `scale` | Global (graph global) | Transformation spatiale. |
| `rotation` | Global (graph global) | Transformation spatiale. |
| `shift` | Global (graph global) | Transformation spatiale. |
| `radius_scale` | Global (graph global) | Transformation spatiale. |
| `height_offset` | Global (graph global) | Transformation spatiale. |
| `depth` | Global (graph global, PerTrack) | Spatial, mais per-track. |

**Souplesse** : un node `Scale` peut aussi être placé dans le sub-graph (per-move) pour un scale local au move. Même node, deux niveaux d'application.

### Per-track parameters — modélisation

`PerTrackDepthNode` indexe par `object_index` :
```rust
let depth = depths.get(object_index).unwrap_or(1.0);
origin + (pos - origin) * depth * fade
```

Dans le Perform Panel : un slider par track pour la depth. Pas un node qu'on connecte — une vue projetée du PerTrackDepth node.

### ManualPositions — interaction 3D

Le drag d'un objet dans le 3D view :
1. Écrit dans `manual_positions_ref` (atomic, fast path)
2. Le ManualPosition node lit à la frame suivante
3. L'objet saute à la position manuelle
4. Pour "libérer" l'objet : `clear_manual_position` → l'objet revient à la position calculée

Si le graph global n'a pas de ManualPosition node, le drag ne fait rien. Solution : toujours inclure un ManualPosition node par défaut (créé automatiquement).

### AudioState — partagé

Un seul `Arc<Mutex<AudioState>>` partagé entre :
- Les workers (pour les engines audio : BPM, AudioAmplitude, AudioSpectrum)
- Le merge thread (pour les AudioFalloff nodes du graph global)

Déjà le cas aujourd'hui. **Pas de changement nécessaire.**

### OSC profile — globalisé

En Phase 1, l'OSC profile devient global (une seule socket, un seul receiver). En pratique, on envoie toujours au même receiver (Holophonix). Si on veut plusieurs receivers à terme, il faudra un routing node dans le graph global (Phase 3+).
