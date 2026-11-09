# Architecture Future : Graph Global Hybride

## Contexte

Stagespace compile des graphs de nodes en fonctions continues `f(t, i) → Vec3` pour le contrôle spatial temps réel. Le système actuel a une tension fondamentale : les macros et audio mods sont des couches **externes** au graph, hardcodées dans le runtime, alors que les nodes `Scale`, `Rotate`, `Offset`, `AudioAmplitudeFalloff` existent déjà dans le compiler.

Ce document décrit l'évolution vers un **graph global** qui englobe tous les moves, avec les macros et audio mods comme nodes du graph. Inspiré de Max/PureData mais avec compilation des engines pour la performance.

L'architecture retenue est **hybride multi-threadée** : les engines (math complexe) tournent dans des worker threads parallèles, le merge + post-processing tournent dans un thread unique. Compilation pour les engines, interprétation pour le post-processing, fast path atomique pour le live control.

**Objectifs de design** : souplesse (per-move ou global, au choix) et intuitivité (le musicien ne manipule pas des nodes en concert — il a des sliders).

---

## État actuel — tensions identifiées

### Tension 1 : Deux systèmes de transformation parallèles

```
COUCHE GRAPH (compilé)          COUCHE RUNTIME (hardcoded)
─────────────────────           ──────────────────────────
Circular → Scale → Rotate       radius_scale → height_offset
  → Output → PositionFn         → depth → scale → rotation
                                → origin + shift → OSC
```

Le graph compile `f(t, i) → Vec3`. Le runtime applique **ensuite** 6 transformations hardcodées (runtime.rs lignes 341-399) : `radius_scale → height_offset → depth → scale → rotation → origin + shift`. Non visible dans le graph, non composable, non réordonnable.

Si on met un node `Scale(2.0)` dans le graph ET un macro scale à 1.5 → position scalée deux fois. Confusant.

### Tension 2 : Isolation des movements → conflits non résolus

```
Movement A (tracks 1-5) → OSC socket A → /track/3/xyz
Movement B (tracks 3-9) → OSC socket B → /track/3/xyz
                                                    ↑
                                        Dernier qui parle gagne.
                                        Pas de blend, pas de priorité.
```

Chaque movement est un `Runtime` indépendant avec thread + socket propres. Deux moves sur le même track → positions contradictoires à 60fps → tremblement.

### Tension 3 : Macros globales appliquées per-movement

```typescript
// macrosSlice.ts — pushMacrosToRuntime
await Promise.all(movements.map((mv) =>
  invoke('set_movement_macro', { movementId: mv.id, request: macroReq })
));
```

Mêmes macros poussées à tous les movements. Ni vraiment globales (appliquées N fois), ni vraiment per-move (même valeur). Accident d'implémentation.

### Tension 4 : Audio mods = couche externe alors que les nodes existent

Le compiler a `AudioAmplitudeFalloff`, `AudioSpectrum`, `BPM`. Mais les "audio mods" de l'Inspector sont un système séparé (`AnimationState.audio_mods`) qui calcule des deltas en dehors du graph. Deux systèmes pour la même chose.

### Tension 5 : Objects node = vestige

Le node `Objects` existe pour fournir `n_objects` au compiler. Mais le vrai count est `osc_ids.len()`. Le compiler résout `n_objects` depuis le node Objects, puis le runtime l'ignore et utilise `osc_ids.len()`.

### Tension 6 : Origin calculé en dehors du graph

```typescript
const origin = computeCentroid(holProject, trackIndices, manualOscIds);
// → passé en paramètre au runtime
```

L'isobarycentre est calculé en TypeScript. Concept spatial qui devrait être un node.

### Tension 7 : Per-track parameters non représentés dans le graph

`AnimationState` a `track_depths: Vec<f64>` et `track_phase_offsets: Vec<f64>` — des **arrays per-track**, pas des valeurs globales. La depth et le phase_offset sont différents pour chaque objet. Ces paramètres sont appliqués dans le runtime (lignes 247-257), pas dans le graph. Un node du graph global doit pouvoir retourner des valeurs **indexées par object_index**.

### Tension 8 : Speed est per-move, pas global

Speed est dans `MacroState` et affecte `t` (time scaling). Chaque runtime applique son propre speed. Si les macros deviennent globales, speed devient global — tous les moves à la même vitesse. C'est une régression : deux moves peuvent vouloir des vitesses différentes. **Speed doit rester per-move.**

### Tension 9 : Cue system incomplet

Un cue snapshot contient : `graph + macros + track_indices + fade_duration`. Mais **audio mods ne sont pas dans les cues**. Avec un graph global, un cue doit aussi snapshotter quels moves sont actifs et l'état du graph global.

### Tension 10 : ManualPositions non représentées

Le drag d'objets individuels dans le 3D view modifie `manualPositions` (positions manuelles per-objet). Ça ne mappe pas à un Transform node — c'est un **override de position**. Il faut un node `ManualPosition` qui override la position calculée pour certains objets.

---

## Architecture proposée — Sweet Spot Hybride

```
TOUT COMPILÉ                    TOUT INTERPRÉTÉ
(f(t,i) monolithique)           (Max/PureData)
     │                               │
     │  ┌──────────────────────────┐ │
     │  │ SWEET SPOT HYBRIDE       │ │
     │  │ Engines compilés         │ │
     │  │ Post-processing interprété│ │
     │  │ Fast path pour live      │ │
     │  │ Worker threads parallèles│ │
     │  │ Merge thread unique      │ │
     │  └──────────────────────────┘ │
     │                               │
     ←── Stagespace actuel           ←── Stagespace proposé
```

### Principe : 3 couches, 2 niveaux de threading

**Couche 1 — Engine (compilé, worker threads parallèles)**
```
Sub-graph du move → compile → f(t, i) → Vec3
Évalué en parallèle dans des worker threads (1 par move actif)
Résultat écrit dans un buffer partagé
N'envoie PAS d'OSC
Applique speed (per-move), loop_mode, direction, phase_offset (per-move)
N'applique PAS scale/rotation/shift/depth (ces transforms montent dans le graph global)
```

**Couche 2 — Merge + Post-processing (closure compilée, merge thread unique)**
```
Lire tous les buffers (latest frame)
  → Merge (résoudre conflits par track)
  → Post-processing (closure compilée, params atomiques) :
    Scale → Rotate → Shift → AudioMod → Depth → ManualPosition
  → Une seule socket OSC
  → Un seul callback pour le visualizer
```

**Couche 3 — Output (routing OSC, merge thread)**
```
Output → format OSC (Holophonix/IEM/Spat) → UDP (une seule socket)
```

### Architecture multi-threadée

```
┌─────────────────────────────────────────────────────────────┐
│ WORKER THREADS (une par move actif)                          │
│                                                              │
│  Thread A: f_a(t,i) ──→ [buffer A]                          │
│  Thread B: f_b(t,i) ──→ [buffer B]                          │
│  Thread C: f_c(t,i) ──→ [buffer C]                          │
│                                                              │
│  Chaque thread:                                              │
│  - Évalue son sub-graph compilé (engine math)               │
│  - Applique speed (per-move), loop_mode, direction           │
│  - Applique phase_offset (per-track, dans le sub-graph)      │
│  - Écrit positions dans son buffer                          │
│  - N'envoie PAS d'OSC                                       │
│  - N'applique PAS scale/rotation/shift/depth (graph global) │
│  - A accès à AudioState (pour les engines audio)            │
└────────────────────────┬────────────────────────────────────┘
                         │  (Mutex<Vec>, lock simple, ~200 bytes)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ MERGE + POST-PROCESS THREAD (unique)                         │
│                                                              │
│  1. Read all buffers (latest frame)                         │
│  2. Merge: resolve conflicts per track                      │
│  3. Post-process (compiled closure, atomic params):         │
│     Scale → Rotate → Shift → AudioMod → Depth → ManualPos   │
│  4. OSC output (une seule socket)                           │
│  5. Callback (un seul event Tauri)                          │
│  - A accès à AudioState (pour les AudioFalloff nodes)       │
│  - A accès à track positions (pour Barycenter node)         │
└─────────────────────────────────────────────────────────────┘
```

### Pourquoi hybride plutôt que single-thread

| Aspect | Single-thread global | Hybride multi-thread |
|---|---|---|
| Engine evaluation | Séquentiel (6.7ms pour 3 moves) | **Parallèle** (3ms max, le plus lent) |
| Crash isolation | Tout s'arrête | **Worker crash → merge skip ce buffer, autres continuent** |
| Refactor | Massif (tout réécrire) | **Minimal** (garder Runtime existant, ajouter merge) |
| OSC conflicts | Résolu (1 socket) | Résolu (1 socket) |
| Latency | 0 frame | **0-1 frame** (buffer, acceptable à 60fps) |
| Complexité | Moyenne | **Moyenne** (Mutex simple, pas critique) |
| Scalability | Limité (1 core) | **Multi-core** (Rayon pour post-processing par objet) |

### Compilation vs interprétation — la frontière

```
COUCHES          MODE D'EXÉCUTION       THREADS
─────────        ───────────────        ───────
Sub-graphs       Compilé (f(t,i))       Worker threads (1 par move)
  ↓              + speed, loop, dir, phase (per-move, dans le worker)
Merge            Interprété             Merge thread
  ↓                (structure dynamique:
Post-processing    N moves variables)
                  Compilé pour les       Merge thread
                  transforms (closures   (optionnel: Rayon
                  avec params atomiques)  par objet)
  ↓
OSC output       Direct                  Merge thread
```

**Sub-graphs** : compilés en `f(t, i) → Vec3`. Structure figée pendant le playback. Hot-swappable avec crossfade. Évalués en parallèle dans des worker threads. **Speed, loop_mode, direction, phase_offset restent per-move dans le worker** — ce sont des transformations du temps et de la phase, pas de l'espace.

**Merge** : interprété. Le nombre de moves actifs change en temps réel (play/stop). Le merge ne peut pas être compilé car ses inputs sont dynamiques. Mais c'est trivial : pour chaque track, prendre la position du move avec le poids le plus élevé.

**Post-processing** : **hybride compilation/interprétation**.
- La **structure** (quels nodes, quel ordre) est compilée en une closure → pas d'overhead d'interprétation
- Les **paramètres** (scale value, rotation angle, audio amount) sont des `Arc<AtomicU64>` → modifiables sans recompilation
- La **audio data** est lue en live via `Arc<Mutex<AudioState>>` → pas de recompilation quand l'audio change
- Hot-swap de la closure quand le graph global change (rare, ~1ms)

### Graph Global conceptuel

```
┌─────────────────────────────────────────────────────────────────────┐
│ GRAPH GLOBAL                                                         │
│                                                                      │
│  [MoveRef A] ──→ f_a(t,i) ──┐                                       │
│                              ├── [Merge] ── [Scale] ── [Rotate]     │
│  [MoveRef B] ──→ f_b(t,i) ──┘         │              │              │
│                                       │              ↓              │
│                                  [AudioFalloff]  [Shift]            │
│                                       │              │              │
│                                       ↓              ↓              │
│                                  [PerTrackDepth] [ManualPos]        │
│                                       │              │              │
│                                       ↓              ↓              │
│                                    [Barycenter] ──→ [Output] ──→ OSC│
│                                                                      │
│  Sub-graph A: [Circular] → [PhaseShift(per-track)] → [Output]        │
│  Sub-graph B: [Spiral] → [Jitter] → [Output]                        │
│                                                                      │
│  Inputs globaux: AudioState, TrackPositions (.hol), ManualPositions  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Sub-graphs** (moves) : compilés en `f(t, i) → Vec3`, évalués en worker threads. Speed, loop, direction, phase_offset per-move.
- **Graph global** (post-processing) : closure compilée, params atomiques, évalué dans le merge thread.
- **MoveRef nodes** : références vers des sub-graphs (abstractions).
- **PerTrack nodes** : retournent des valeurs indexées par object_index (depth, phase_offset).
- **ManualPosition node** : override la position pour certains objets (drag manuel).

---

## Séparation speed vs transforms — le point critique

### Ce qui reste per-move (dans les workers)

| Paramètre | Pourquoi | Où |
|---|---|---|
| `speed` | Affecte `t` (time scaling). Deux moves à des vitesses différentes. | Worker |
| `loop_mode` | Loop vs OneShot. Per-move. | Worker |
| `direction` | Forward/Backward/PingPong. Per-move. | Worker |
| `phase_offset` | Per-track, décalage temporel. Déjà dans le sub-graph. | Worker (sub-graph) |
| `fade_in/out` | Per-move, cycle de vie du move. | Worker |

### Ce qui monte dans le graph global (merge thread)

| Paramètre | Pourquoi | Où |
|---|---|---|
| `scale` | Transformation spatiale globale. | Graph global (Transform node) |
| `rotation` (yaw/pitch/roll) | Transformation spatiale globale. | Graph global (Transform node) |
| `shift` (x/y/z) | Transformation spatiale globale. | Graph global (Transform node) |
| `radius_scale` | Transformation spatiale globale. | Graph global (Transform node) |
| `height_offset` | Transformation spatiale globale. | Graph global (Transform node) |
| `depth` | Per-track, mais spatial. | Graph global (PerTrack node) |
| `audio mods` | Modulation globale. | Graph global (AudioFalloff node) |
| `origin` | Calcul spatial global. | Graph global (Barycenter node) |

### Souplesse : per-move OU global

L'utilisateur peut choisir le niveau d'application :
- **Transform dans le sub-graph** : s'applique per-move (le worker l'applique avant d'écrire dans le buffer)
- **Transform dans le graph global** : s'applique global (le merge thread l'applique après le merge)

Exemple : un node `Scale` dans le sub-graph de Move A scale seulement A. Un node `Scale` dans le graph global scale tous les moves mergés. **Mêmes nodes, deux niveaux d'application.**

---

## Per-track parameters — modélisation

### Le problème

`depth` et `phase_offset` sont des arrays per-track :
```
Objet 0 → depth 0.3
Objet 1 → depth 1.0
Objet 2 → depth 0.7
```

Un Transform node standard retourne une valeur globale. Il faut un node qui **indexe par object_index**.

### Solution : PerTrackParameter node

```rust
NodeType::PerTrackDepth => {
    // Prend un array de valeurs per-track
    // Retourne values[object_index]
    let depths = node.params.get("depths").as_array();
    Box::new(move |t, i, merged, macros, audio| {
        let depth = depths.get(i).unwrap_or(1.0);
        origin + (merged[i] - origin) * depth * fade
    })
}
```

**Phase_offset** reste dans le sub-graph (per-move, temporel). **Depth** monte dans le graph global (spatial, post-merge).

### UI : depth per-track

Dans le Perform Panel, un slider par track pour la depth. Pas un node qu'on connecte — une **vue projetée** du PerTrackDepth node.

---

## ManualPositions — override de position

### Le problème

Le drag d'objets individuels dans le 3D view modifie `manualPositions`. C'est un override : la position manuelle remplace la position calculée, pour certains objets seulement.

### Solution : ManualPosition node

```rust
NodeType::ManualPosition => {
    // Pour chaque objet, si manual_position[i] existe, l'utiliser
    // Sinon, garder la position calculée
    let manual = manual_positions_ref.lock();  // Arc<Mutex<HashMap<usize, Vec3>>>
    Box::new(move |t, i, merged, macros, audio| {
        if let Some(manual_pos) = manual.get(&i) {
            *manual_pos  // override
        } else {
            merged[i]  // position calculée
        }
    })
}
```

Placé **après** le merge, **avant** l'output. L'utilisateur peut le bypass en le déconnectant.

### Interaction avec le 3D view

Quand l'utilisateur drag un objet dans le 3D view :
1. La position est écrite dans `manual_positions_ref` (atomic, fast path)
2. Le ManualPosition node la lit à la frame suivante
3. L'objet saute à la position manuelle
4. Pour "libérer" l'objet : retirer l'entry du HashMap → l'objet revient à la position calculée

---

## AudioState — partagé entre workers et merge thread

### Le problème

Les engines audio (BPM, AudioAmplitude, AudioSpectrum) utilisent des closures qui capturent `Arc<Mutex<AudioState>>`. Les workers ont besoin d'AudioState pour ces engines. Le merge thread a besoin d'AudioState pour les AudioFalloff nodes du graph global.

### Solution : un seul AudioState partagé

```rust
// AppState
audio_state: Arc<Mutex<AudioState>>,  // un seul, partagé

// Chaque worker reçoit un clone du Arc
worker_runtime.set_audio_state(audio_state.clone());

// Le merge thread reçoit aussi un clone
merge_runtime.set_audio_state(audio_state.clone());
```

Déjà le cas aujourd'hui (chaque runtime a un clone du Arc). **Pas de changement nécessaire.**

---

## Cue system — adaptation

### Cue snapshot étendu

```rust
pub struct Cue {
    // Actuel
    pub graph: GraphJson,           // sub-graph du move
    pub macros: MacroSnapshot,      // macros (scale, rotation, shift)
    pub track_indices: Vec<usize>,
    pub fade_duration: f64,
    pub cue_number: String,
    
    // Nouveau (Phase 2+)
    pub global_graph: Option<GraphJson>,     // graph global (Transform nodes)
    pub active_move_ids: Vec<String>,        // quels moves sont actifs
    pub audio_mods: Option<AudioModSnapshot>, // audio mods (devenus nodes)
    pub per_track_depths: Vec<f64>,          // depth per-track
    pub manual_positions: HashMap<usize, [f64; 3]>, // overrides manuels
}
```

### Recall

1. Désactiver les moves qui ne sont pas dans `active_move_ids`
2. Activer les moves qui y sont (avec fade)
3. Hot-swap le graph global si `global_graph` est présent
4. Restaurer les macros (fast path atomic)
5. Restaurer les per-track depths
6. Restaurer les manual positions

---

## Implications Backend

### Compiler

**Actuel** :
```rust
compile_graph(graph, audio) → PositionFn  // fn(t, i) → Vec3
```

**Proposé** :
```rust
// Phase 1 : compiler chaque sub-graph indépendamment (inchangé)
compile_sub_graph(move_graph_a, audio) → PositionFn  // f_a
compile_sub_graph(move_graph_b, audio) → PositionFn  // f_b

// Phase 2 : compiler le graph global (post-processing)
compile_post_process(global_graph, audio, track_positions) → PostProcessFn
// PostProcessFn: fn(t, merged_positions, &macros, &audio, &track_positions) → transformed_positions
```

### Merge Node (nouveau)

Stratégies de merge :
- `Override` : dernier move actif gagne
- `Crossfade` : blend avec durée de fondu
- `Blend` : moyenne pondérée
- `Priority` : move avec priorité la plus haute gagne
- `Spatial` : position la plus proche de l'origin gagne

Le compiler a déjà Mix (blend), Group (split), Sequence (temporal), Crossfade (fade). Le Merge node généralise : au lieu de mixer 2 branches d'un même graph, il merge N sub-graphs indépendants.

### Runtime — Architecture hybride

**Actuel** : N `Runtime` indépendants avec threads + sockets séparés.

**Proposé** : N `Runtime` workers (sans OSC, sans post-processing spatial) + 1 `MergeRuntime`.

```rust
// Workers existants — modifiés minimalement
// Le Runtime existant continue d'évaluer f(t,i) avec speed, loop, direction, phase_offset
// Mais au lieu d'envoyer OSC + post-process spatial :
// → écrit dans un buffer
struct PositionBuffer {
    positions: Mutex<Vec<(usize, Vector3<f64>)>>,
}

// Nouveau : MergeRuntime
struct MergeRuntime {
    thread: Option<JoinHandle<()>>,
    running: Arc<AtomicBool>,
    socket: UdpSocket,
    osc_sender: Arc<Mutex<OscSender>>,
    // Buffers par move (lock simple, ~200 bytes par buffer)
    move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
    // Active moves with fade state
    active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
    // Post-processing (compiled closure, atomic params)
    post_process_fn: Arc<Mutex<PostProcessFn>>,
    // Macros = fast path (atomic, pas de recompilation)
    // Seulement scale, rotation, shift, radius_scale, height_offset
    // PAS speed (speed reste per-move dans les workers)
    macros: Arc<MacroState>,
    // Audio state partagé (workers + merge thread)
    audio_state: Arc<Mutex<AudioState>>,
    // Track positions depuis .hol (pour Barycenter node)
    track_positions: Arc<RwLock<HashMap<u32, [f64; 3]>>>,
    // Manual positions (pour ManualPosition node)
    manual_positions: Arc<Mutex<HashMap<usize, [f64; 3]>>>,
    // Origin global
    origin: Arc<Mutex<Vector3<f64>>>,
    // OSC ids (tracks sélectionnées)
    osc_ids: Arc<RwLock<Vec<u32>>>,
    // Merge strategy
    merge_strategy: Arc<RwLock<MergeStrategy>>,
    // Performance monitor global
    perf: Arc<PerfMonitor>,
    // Position callback (un seul event Tauri)
    position_callback: Arc<Mutex<Option<Box<dyn Fn(f64, &[(usize, Vector3<f64>)]) + Send + Sync>>>>,
}

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

**Boucle du MergeRuntime** :
```rust
loop {
    // 1. Lire tous les buffers (latest frame)
    let all_positions: HashMap<String, Vec<(usize, Vec3)>> = 
        move_buffers.iter().map(|(id, buf)| (id.clone(), buf.read())).collect();
    
    // 2. Merge par track (résoudre conflits)
    let merged = merge_strategy.resolve(&all_positions, &active_moves);
    
    // 3. Post-process (compiled closure, atomic params)
    //    Scale → Rotate → Shift → AudioMod → PerTrackDepth → ManualPos → Barycenter
    let transformed = post_process_fn(t, merged, &macros, &audio_state, &track_positions);
    
    // 4. Séparer display vs OSC (preview mode)
    let display_positions = transformed.clone();  // 3D voit tout
    let osc_positions: Vec<_> = transformed.iter()
        .filter(|(i, _)| !is_preview(i))
        .collect();  // OSC exclut les moves en preview
    
    // 5. OSC output (une seule socket)
    for (i, pos) in &osc_positions {
        let osc_id = osc_ids[i];
        sender.send(osc_id, pos);
    }
    
    // 6. Callback (un seul event Tauri)
    emit("global-positions", display_positions);
    
    // 7. Perf monitor
    perf.record_frame();
    
    sleep(frame_duration);  // 60fps
}
```

**Avantages** :
- Workers en parallèle → engines complexes (Swarm O(n²)) ne bloquent pas les autres moves
- Crash isolation → un worker crash, le merge skip son buffer, les autres continuent
- Une seule socket → plus de conflits OSC
- Macros spatiales appliquées **une fois** sur l'output merged
- Speed reste per-move (dans les workers)
- Un seul callback de position → frontend simplifié
- Refactor minimal → les `Runtime` existants restent quasi-intacts

### Buffer — lock simple, pas de double buffer

```rust
struct PositionBuffer {
    positions: Mutex<Vec<(usize, Vector3<f64>)>>,
}

impl PositionBuffer {
    fn write(&self, positions: Vec<(usize, Vector3<f64>)>) {
        *self.positions.lock().unwrap() = positions;
    }
    
    fn read(&self) -> Vec<(usize, Vector3<f64>)> {
        self.positions.lock().unwrap().clone()
    }
}
```

Pour 9 objets (~200 bytes), la copie prend des nanoses. Pas de contention mesurable. Le double buffer front/back + swap est overkill pour ce volume de données. **Mutex simple suffit.**

### Fast path pour live control

Les params des Transform nodes du graph global sont stockés dans des `Arc<AtomicU64>` (comme MacroState actuel). Le compiler lie ces refs dans la closure compilée. Changer un slider = update atomique, pas de recompilation.

```
Slider "Scale" → set_atomic(scale_ref, 1.5) → lu par la closure à chaque frame
```

**Speed** n'est **pas** un AtomicU64 global — il reste per-move dans le `RuntimeConfig` du worker.

### Post-processing parallèle (optionnel)

Le post-processing est **indépendant par objet** : Scale, Rotate, Shift appliqués à l'objet 0 ne dépendent pas de l'objet 1. Donc :

```rust
let transformed: Vec<(usize, Vector3<f64>)> = merged
    .par_iter()  // Rayon: parallèle automatique
    .map(|(i, pos)| {
        let scaled = pos * scale_atomic.load();
        let rotated = rot_matrix * scaled;
        let shifted = rotated + shift_atomic.load();
        let with_audio = apply_audio_falloff(shifted, i, &audio_state);
        let with_depth = origin + (with_audio - origin) * depth[i];
        let with_manual = manual_positions.get(&i).unwrap_or(with_depth);
        (*i, with_manual)
    })
    .collect();
```

Pour 9 objets, Rayon peut paralléliser sur les cores disponibles. Mais honnêtement, le post-processing est si léger (mult/add) que la parallélisation n'apporte presque rien. **Le vrai gain de parallélisation est sur les worker threads** (engines complexes).

### Commands IPC

| Actuel | Proposé | Changement |
|---|---|---|
| `play_movement` | `activate_move` | Démarre worker + enregistre buffer |
| `stop_movement` | `deactivate_move` | Fade out, retire buffer quand fini |
| `stop_all_movements` | `deactivate_all_moves` | Fade out tous |
| `set_macro` | `set_macro` (fast path) | Atomic, une seule fois (scale/rot/shift seulement) |
| `set_movement_macro` | `set_move_speed` | Speed reste per-move |
| `update_movement_graph` | `update_move_graph` | Hot-swap sub-graph (worker) |
| — | `update_global_graph` | Hot-swap post-processing (merge) |
| `set_audio_state` | `set_audio_state` | Inchangé (partagé workers + merge) |
| — | `set_manual_position` | Override position d'un objet (drag 3D) |
| — | `clear_manual_position` | Libérer un objet du override |
| — | `set_track_positions` | Mettre à jour les positions .hol (pour Barycenter) |

### Events

| Actuel | Proposé |
|---|---|
| `movement-positions-{id}` (N events) | `global-positions` (1 event) |
| `movements-update` | `active-moves-update` |

---

## Implications Frontend

### Node Editor

Deux niveaux :
- **Vue globale** : graph global avec MoveRef, Merge, Transform, AudioMod, PerTrackDepth, ManualPos, Barycenter, Output
- **Vue sub-graph** : double-cliquer un MoveRef → ouvre le sub-graph du move

React Flow : tabs (vue globale / vue sub-graph par move).

**Souplesse** : un node `Scale` peut être placé dans le sub-graph (per-move) OU dans le graph global (post-merge). Même node, deux niveaux d'application.

### Inspector

- **Section Node** : params du node sélectionné
- **Section Perform** : duration, direction, loop, fade, **speed** (per-move, reste ici)
- **Section Tracks** : sélection + depth per-track
- **Pas de section Macros globales** : macros spatiales = params de Transform nodes du graph global
- **Pas de section Audio** : audio mods = nodes AudioFalloff

### Perform Panel (nouveau)

Vue sliders des params des nodes du graph global. Pour le live — pas de manipulation de nodes en concert.

```
Node Editor (design time)          Perform Panel (live time)
┌──────────────────────┐          ┌─────────────────────┐
│ [Scale node]         │ ←même──→ │ Scale: ────●── 1.5  │
│ [Rotate node]        │ ←data──→ │ Yaw:    ──●──── 45° │
│ [AudioFalloff node]  │ ←même──→ │ Amount: ──●──── 0.7 │
│ [PerTrackDepth node] │ ←data──→ │ Depth:   ──●──── 0.8 │
└──────────────────────┘          └─────────────────────┘
```

**Intuitivité** : le musicien voit des sliders, pas des nodes. Mais derrière, ce sont les params des nodes du graph global. Deux vues, mêmes données.

### State Management

```
useGlobalGraphStore: globalNodes, globalEdges (graph global)
useMoveGraphStore: { [moveId]: { nodes, edges } } (sub-graphs)
useMacroStore: macroValues (vue projetée depuis les Transform nodes du graph global)
useSpeedStore: { [moveId]: speed } (per-move, reste séparé)
useManualPositionsStore: { [objIdx]: [x, y, z] } (overrides manuels)
// useAnimationStore → supprimé (audio mods = nodes, depth = PerTrack node)
```

### Visualizer

Un seul callback avec positions déjà mergées et transformées. Render loop simplifié — plus besoin de merger côté frontend.

**ManualPositions** : le drag dans le 3D view écrit dans `useManualPositionsStore` → invoke `set_manual_position` → le ManualPosition node l'applique. L'objet reste à sa position manuelle jusqu'à ce qu'on le "libère" (clear_manual_position).

### MovesTable

Plus simple : juste template + tracks + play/stop + **speed** (per-move). Macros spatiales et audio mods montent dans le graph global.

---

## Ce qui casse / ce qui est difficile

### Ce qui casse

1. **Indépendance des movements** : partiellement résolu. Un worker crash → merge skip, autres continuent. Mais si le merge thread crash → tout s'arrête. Mitigation : watchdog + restart du merge thread uniquement.

2. **Per-movement macros spatiales** : les macros spatiales (scale, rotation, shift) deviennent globales (appliquées par le merge thread). Mais : les transforms per-move peuvent être des nodes dans le sub-graph (compilés, évalués par le worker). **Souplesse préservée.**

3. **Preview mode per-movement** : géré au niveau du merge thread. Le worker écrit dans le buffer quoi qu'il arrive. Le merge thread sépare display positions (tout) de OSC positions (exclut preview). Le 3D voit le move en preview, l'OSC ne l'envoie pas.

4. **Setlist workflow** : le setlist déclenche des activations de MoveRef en séquence. Un cue recall peut activer/désactiver des moves + swapper le graph global.

5. **Latence buffer** : 0-1 frame de latence ajoutée (16ms max). Acceptable pour du spatial, mais à documenter.

6. **OSC profile globalisé** : actuellement per-movement (host/port/profile). En global, un seul receiver. En pratique, on envoie toujours au même receiver (Holophonix). Si on veut plusieurs receivers, il faudra un routing node dans le graph global (Phase 3+).

### Ce qui est difficile

1. **Compilation du graph global en temps réel** : post-processing simple (mult/add), compilation rapide (<1ms). Hot-swap avec crossfade.

2. **UI de nested graphs** : React Flow ne supporte pas nativement le nesting. Tabs ou sub-patches avec double-clic.

3. **Migration des données existantes** : moveSlots actuels ont macros + audio mods. Script de migration → créer des Transform nodes dans le graph global avec les valeurs du slot. Speed reste dans le slot.

4. **Fast path pour live control** : params des Transform nodes en `Arc<AtomicU64>`. Compiler lie les refs. Slider = update atomique.

5. **Gestion des workers** : démarrage/arrêt propre, gestion des crashes, timeout si un worker est trop lent.

6. **Per-track parameters dans le graph** : PerTrackDepth node doit indexer par object_index. L'UI expose un slider par track dans le Perform Panel.

7. **ManualPositions sync** : le drag 3D écrit dans le store → invoke → atomic update → le node lit à la frame suivante. Pas de recompilation. Mais : si le graph global n'a pas de ManualPosition node, le drag ne fait rien. Il faut soit toujours inclure un ManualPosition node (default), soit le créer automatiquement.

---

## Phases d'implémentation

### Phase 1 : Merge Node + MergeRuntime (court terme)

**Objectif** : résoudre les conflits OSC, paralléliser les engines, poser les fondations.

**Changements** :
- Workers existants modifiés : retirer OSC + post-processing spatial, écrire dans buffer
- Nouveau `MergeRuntime` : lit buffers, merge, applique macros spatiales (encore externes), envoie OSC
- Une seule socket, un seul event de position
- Speed, loop, direction, phase_offset restent dans les workers
- Les macros spatiales restent externes (pour l'instant)

**Inchangé** :
- UI (MovesTable, Inspector, Node Editor)
- Sub-graphs compilés indépendamment
- Macros spatiales = sliders (fast path atomic dans le MergeRuntime)

**Bénéfice** : plus de conflits OSC, engines en parallèle, crash isolation.

### Phase 2 : Post-processing graph (moyen terme)

**Objectif** : unifier macros spatiales + audio mods + depth + origin + manual positions dans le graph.

**Changements** :
- Macros spatiales → Transform nodes dans un graph global
- Audio mods → AudioFalloff nodes dans le graph global
- Depth → PerTrackDepth node dans le graph global
- Origin → Barycenter node dans le graph global
- ManualPositions → ManualPosition node dans le graph global
- Le MergeRuntime n'a plus de chaîne hardcoded — tout est dans PostProcessFn
- Speed reste per-move (dans les workers, pas dans le graph global)

**Inchangé** :
- Sub-graphs (moves) compilés indépendamment par les workers
- Fast path (AtomicU64) pour params live
- Speed, loop, direction, phase_offset dans les workers

**Bénéfice** : ordre configurable, transformations composables, audio mods unifiés, per-track ou global au choix.

### Phase 3 : Unified graph (long terme)

**Objectif** : tout est graph, nested editor, MoveRef nodes.

**Changements** :
- MoveRef nodes dans le graph global
- Nested graph editor (sub-patches)
- Perform Panel (vue sliders des nodes)
- Suppression de la distinction move graph / global graph
- Cue system étendu (snapshot du graph global + moves actifs)

**Bénéfice** : système unifié, tout est graph, comme Max/PureData mais compilé pour les engines.

---

## Référence : Sweet Spot Hybride

```
TOUT COMPILÉ ←─────────────────────────────→ TOUT INTERPRÉTÉ
                                                        (Max/PD)
     │                                        │
     │    ┌───────────────────────────────┐   │
     │    │ SWEET SPOT HYBRIDE            │   │
     │    │ • Engines compilés (f(t,i))   │   │
     │    │ • Workers parallèles          │   │
     │    │ • Speed/loop/dir per-move     │   │
     │    │ • Post-processing interprété  │   │
     │    │ • Fast path pour live (atomic)│   │
     │    │ • Merge explicite (1 thread)  │   │
     │    │ • Crash isolation             │   │
     │    │ • Per-track ou global au choix│   │
     │    └───────────────────────────────┘   │
     │                                        │
  Stagespace actuel                       Stagespace proposé
  (trop compilé, macros externes)        (sweet spot hybride)
```
