# Position presets (« poses ») — design complet

> Investigation + spec. Statut : **P1 + P2 + P3 implémentés** (branche
> `feat/position-poses`) — modèle backend, capture, snap, OSC
> capture/snap/list, section `.hfg`, panel Conduite, **goto animé**
> (engine `poseramp` + résolution compile via `LiveInputs.pose_resolver`
> + capture-then-clear, vérifié live : smoothstep textbook, cible exacte
> au millimètre, hold enchaînable), **morph A→B** (distribution définie
> par la pose B, départ pose A même si l'objet est physiquement ailleurs,
> fallback live pour les tracks de B absentes de A — vérifié e2e : départ
> à 12cm de la position réelle, arrivée au mm). Reste : ancre (P4),
> score (P5), ghosts (P6).
> Note e2e : la course « manuel opérateur posé pendant la fenêtre de mort
> d'un move en hold » est gagnée par le hold (6.1a) — le manuel est
> écrasé si posé dans les ~200ms précédant l'écriture du hold.
> Question origine : enregistrer des presets de positions nommés,
> les rappeler (snap ou animé), animer A→B, les utiliser comme ancre —
> sans créer de conflit ni casser les mécanismes actuels.

## 1. Naming — « pose », pas « formation »

`Formation` est **déjà pris** : `rust-engines/src/engines/formation.rs`
est un engine de distribution géométrique (circle/grid/sphere/line…).
L'entité introduite ici s'appelle **pose** — une photographie nommée de
positions par track. Terminologie console la plus proche : *position
palette* (ETC/MA) — « pose » est retenu pour sa brieveté en UI et en OSC.

## 2. État des lieux (investigation)

### Ce qui existe déjà

| Mécanisme | Fichier | Proximité |
|---|---|---|
| Cues — capturent `manual_positions` par objet, scope à flags dont `positions` | `cuelist.rs` | Recall = repositionnement instantané partiel. Mais : snapshot de show lourd, pas d'animation, pas utilisable en ancre |
| `track_positions` — origine de repos par track, **track_id-keyed** | `state_ops.rs` | Positions nommées implicites, une seule par track |
| Clip score `Positions` — écriture instantanée de positions manuelles sur la timeline | `scheduler.rs:670` | Placement instantané, pas d'interpolation |
| `PresetManager` — store nommé de config JSON générique | `presets.rs` | Plomberie de nommage, rien de positionnel |
| Throw / gestures — balistique amortie depuis la position canonique | `state_ops.rs:425` | Animation sans cible |
| `AnchorMode::Current` — capture des positions live au spawn | `runtime/mod.rs` | Capture, mais pas de positions prescrites |
| Chaîne de priorité documentée : **park > psn > hold > manual > move > track** | `state_ops.rs:534` | Le modèle de contrôle auquel toute nouvelle primitive doit se conformer |

### Le gap central

**Aucune primitive « va à X en T secondes ».** Une position manuelle est
un override absolu immédiat — les objets sautent. Les clips `Positions`,
le recall de cue, `/stagespace/position` : tous instantanés.

### Faits architecturaux décisifs

1. **Manual gagne sur move dans le merge** (`helpers.rs:171`) — toute
   animation écrite en positions manuelles frame-par-frame écraserait la
   reprise opérateur. Une animation de pose doit donc être un **move**,
   pas des writes manuels.
2. **`play_compiled` compile un graphe** — mais rien n'empêche de
   **synthétiser le GraphJson au moment du fire** avec les données
   cuites dedans. Le graphe synthétisé est sérialisable → les snapshots
   de cue, le hot-swap, la persistance marchent sans aucun cas spécial.
3. **`end_mode: hold`** écrit les positions finales en manuel à la mort
   du move — exactement la sémantique « la pose est atteinte et tenue ».
4. **`register_move` consomme les holds** des tracks reprises — le
   chaînage move-to → move-to est déjà correct par construction.
5. **La capture d'ancre est injectée** au runtime (`anchor_capture`) —
   un spawn peut pré-calculer la capture par objet.
6. **Espace canonique pré-postprocess** — les seeds d'ancres/throw et
   `last_position` vivent en espace canonique. Les poses doivent être
   stockées dans cet espace (cohérence sous macros).
7. **Namespace** — les positions sont track_id-keyed côté opérateur
   (règle AGENTS.md : une position de repos appartient à l'identité
   opérateur, survit au remapping). Conversion obj_index à l'usage.

## 3. Modèle de données

```rust
Pose {
    id: String,              // uuid interne
    name: String,            // label opérateur, unique
    /// track_id → position canonique [x, y, z] — partiel par nature :
    /// seules les tracks renseignées sont concernées par la pose.
    positions: HashMap<u32, [f64; 3]>,
}
```

**Backend-owned** (`AppState.poses: RwLock<HashMap<String, Pose>>`) —
source de vérité unique. Justification : le scheduler score tourne
backend-side et doit résoudre les clips pose au fire ; l'OSC show-control
peut alors être backend-direct (pas de roundtrip webview — même latence
que `/stagespace/position`). Le frontend interroge/édite via commandes.

**Persistance** : section `poses` de l'enveloppe `.hfg` — le frontend
fetch les poses au save, les pousse au load (pattern `oscMappings` :
sections absentes = préservées, sections vides = effacées).

## 4. Les cinq opérations

### 4.1 Capture — `pose_capture(name, track_ids?)`

Pour chaque track demandée (ou toutes les tracks ayant une position
connue) : résolution obj_index courant → `merge.last_position(obj)`
(même chaîne de fallback que les ancres : canonique → manuelle →
origine trackpos → skip). Écrit la pose en backend. Tracks sans aucune
position connue : skippées + warning.

L'opérateur choisit donc ses tracks, les place (drag 3D, moves, PSN,
peu importe — la capture lit l'état **résultant**), puis capture. Les
positions peuvent aussi être éditées numériquement après coup (UI table).

### 4.2 Snap — `pose_snap(name)`

Rappel instantané : pour chaque track de la pose résolvable en objet
patché → `set_manual_position`. **Même chemin que `/stagespace/position`**
— reprise opérateur, priorité manual, persiste jusqu'à override/clear.
Tracks absentes de la pose : non touchées (partiel par nature).

Sémantique de conflit : les objets sous move sont masqués (manual >
move) — c'est le comportement de takeover existant, cohérent.

### 4.3 GoTo — `pose_goto(name, duration, easing?)`

**La primitive centrale.** Animation de chaque objet depuis sa position
**live actuelle** vers la pose :

1. **Capture-then-clear** (voir §6.9 — critique) : pour chaque objet
   membre, les positions manuelles opérateur sont effacées. Sans ça,
   manual > move masquerait la rampe entière et l'objet sauterait à la
   cible à la fin au lieu d'y ramper. La continuité est garantie : la
   résolution `live` du compile lit la même position (chaîne canonique)
   — à t=0 le move émet exactement là où l'objet était.
2. Construction du graphe standard `poseramp(from: "live",
   to: "pose:<name>") → output` — le graphe est littéral, aucune
   donnée n'est cuite dedans. La distribution (osc_ids) est pré-filtrée
   aux tracks résolubles de la pose — la résolution compile est totale.
3. Spawn via `spawn_move` — le pipeline normal, sans exception :
   compile (→ résolution des poses et des positions live, voir §5) →
   Runtime → PositionBuffer → register_move.
3. Config du move : `oneshot`, `forward`, `end_mode: hold`, durée T.
   À la fin naturelle, les positions finales (= la pose, exactement)
   deviennent des positions manuelles tenues — l'objet reste sur la
   pose, prêt à être repris par le prochain move (`AnchorMode::Current`
   ou consommation du hold).

Le move est **visible dans la liste des moves** (`pose-goto-<n>`),
stoppable, speed-contrôlable, mergeable — un citoyen de première classe.

### 4.4 Morph — `pose_morph(poseA, poseB, duration, easing?)`

Identique au goto, mais `from: "pose:<A>"` au lieu de `"live"`.
**Fallback** : track absente de A → départ depuis la position live
(documenté, c'est le même fallback que l'ancre current) — le resolver
applique cette cascade au compile.

**La cible définit la distribution** : une track participe si et
seulement si elle est dans B. (Track dans A mais pas dans B → ne bouge
pas — le morph est une transition *vers* B.)

### 4.5 Pose comme ancre — `AnchorMode::Pose(name)`

Capture par objet depuis la pose au spawn, fallback position live.
**Implémentation minimale** : la capture d'ancre est déjà injectée au
runtime — le chemin de spawn pré-calcule `capture[obj] = pose[track] ??
last_position(obj)` et utilise la mécanique `Current` existante.
Aucun changement worker — uniquement la plomberie de spawn + l'enum
exposé en UI/OSC.

Usage : « le cercle part de la formation line » — la trajectoire est
translatée pour démarrer là où la pose place les objets, sans qu'ils y
soient réellement.

## 5. Le node `poseramp` — référentiel, pas synthétisé

> **Révision majeure** (après discussion « éditeur de graphe ») : le node
> ne cuit PAS les positions dans ses params — il **référence les poses
> par nom** et la résolution se fait au compile. Justification : un
> graphe cuit est opaque et non éditable dans l'éditeur — un citoyen de
> second rang. Le canal `LiveInputs` (audio, valeurs OSC, plugins,
> param slots, positions freezées) est le pattern établi pour injecter
> le monde au compile — les poses s'y ajoutent proprement.

```rust
// engines/poseramp.rs — stateless, déterministe, pur
// params :
//   from: "live" | "pose:<name>"   — résolu au compile
//   to:   "pose:<name>"            — résolu au compile (requis)
//   easing: "smooth" | "linear" | "easeinout"
//   duration: <s> — durée de la rampe (= durée du move oneshot)
position(t, obj) = lerp(from[obj], to[obj], easing(t / duration))
```

### La résolution au compile

Nouvelle entrée `LiveInputs.pose_resolver` — construite par le chemin
de spawn (qui connaît le mapping track↔objet courant et les positions
live) et injectée au compile comme l'audio ou les plugins :

- `from: "live"` → `last_position(obj)` par objet du move (chaîne de
  fallback existante : canonique → manuelle → trackpos → skip+warning)
- `from`/`to`: `"pose:<name>"` → positions de la pose résolues en
  obj_index via le mapping **courant** (règle namespace)
- **Fallbacks collectés à la résolution** — tracks non patchées,
  positions inconnues, objets parkés/PSN : warnings remontés par le
  spawn (nack OSC / toast UI / preflight score), jamais inventés
- Résolution = **snapshot au compile** : le move joue avec les positions
  résolues à cet instant. Ré-éditer la pose ne modifie pas un move en
  vol (pas de recompile automatique — même sémantique que les refs de
  slots dans les clips score pendant la lecture).

### Conséquences — le node est un citoyen du catalogue

- **Hand-authorable** — un slot « ramp to line-up » construit à la
  main dans l'éditeur, sauvé dans le show, rejoué : la résolution se
  fait au play comme tout le reste. Le goto n'est plus une voie
  spéciale — `pose_goto` spawne littéralement le graphe standard
  `poseramp → output`. Aucune synthèse de données, aucune voie
  parallèle.
- **Inspectable/éditable** — ouvrir le graphe montre l'intention
  (« vers pose line-up, depuis live, smooth, 2 s »), pas deux tableaux
  de floats. Éditer `to`/easing/duration est sensé.
- **Composable** — `Mix`, `Sequence`, modificateurs, courbes
  `param:PoseRamp:*` : tout s'applique.
- **Morph** = le même node avec `from: "pose:A"` — pas de variante.

### Propriétés

- **Stateless** — pas de réjection backward/pingpong nécessaire
  (contrairement aux physics), même si la config spawnée est forward.
- En dehors de [0, T] : clamp (la mort du oneshot intervient à T de
  toute façon ; le clamp protège les cas speed/seek).
- `t = T` → `to` exact : la position finale écrite par le hold est la
  pose au centimètre près, pas une approximation.

### Conséquences sémantiques assumées (documentées)

1. **Hot-swap = re-résolution** — éditer le graphe en vol recompile,
   donc recapture `live` à cet instant : discontinuité possible en
   milieu de rampe (la phase virtuelle continue, les endpoints
   changent). Acceptable : l'édition live d'un move de 2 s est un cas
   expert, et pour les slots hand-authored c'est le comportement
   attendu (rebind — même esprit que la recapture d'ancre current).
2. **Snapshots de cue = référentiels** — un goto capturé en vol par
   une cue rejoue avec les poses *courantes* au recall, pas celles du
   store. Cohérent avec la sémantique live-reference des refs de slots
   dans les clips score — et marginal (gotos éphémères). Documenté,
   pas de mécanisme de gel.
3. **Pourquoi pas les alternatives** :

| Alternative | Problème |
|---|---|
| `AnchorMode::Current` + trajectoire statique | L'ancre **translate** la trajectoire — elle préserve la forme, pas les extrémités. Les cibles seraient décalées — faux. |
| Lire les positions live dans l'engine à chaque frame | Les engines sont des fonctions pures de `(t, obj)` — casserait la pureté/testabilité du catalogue. La résolution au compile préserve la pureté de l'évaluation. |
| Positions cuitées en arrays dans les params (design initial) | Graphe opaque, non éditable finement — rejeté après discussion. |

## 6. Analyse de conflits — le cœur de la demande

### 6.1 Reprise opérateur pendant une animation ✅ résolu par construction

Pendant un goto/morph, l'opérateur drag un objet → position manuelle →
**manual > move dans le merge** → l'objet répond à la main, le move
continue pour les autres. C'est le comportement de takeover existant,
aucune exception introduite.

**Point de sémantique à trancher** : à la fin du move, le hold écrit la
cible pose pour *tous* les objets du move — y compris celui tenu par
l'opérateur (son manuel est écrasé). Deux options :
- **(a) simple** — le hold écrit tout : « le goto est allé au bout, la
  pose est atteinte ». L'opérateur re-drag après s'il veut.
- **(b) respectueuse** — le hold skip les objets ayant un manuel
  opérateur (non-held) au moment de la fin.

Recommandation : **(a)** pour la simplicité de la première version,
(b) en raffinement si le retour terrain le demande — (b) touche
`finish_move` qui ne connaît pas aujourd'hui la distinction
held/operator (l'info existe : `held_objects`).

### 6.2 Panic / stop-all ✅ aucun travail

Le goto est un move normal — tué par panic, stop-all, recall de cue
Full. Le panic envoie les origines trackpos : comportement homogène.

### 6.9 Le masquage manual×move — le piège central du goto ⚠️ résolu

**Constat d'audit** : `manual > move` dans le merge — si un objet a une
position manuelle au spawn du goto, la rampe est **invisible** pendant
toute la durée (l'objet paraît figé), puis le hold final écrase le
manuel avec la cible → **saut instantané à la fin au lieu de ramper**.
Or le cas d'usage principal des poses est précisément de repositionner
des objets placés à la main — le bug serait systématique.

C'est une sémantique **pré-existante** (tout move sur un objet tenu
manuellement est masqué — y compris `AnchorMode::Current` aujourd'hui),
mais le goto la rend centrale par nature. Solution retenue —
**capture-then-clear** au spawn du goto (§4.3) :

1. La résolution compile capture `from` — la chaîne `last_position` lit
   la position manuelle comme toute autre source.
2. Les manuels des objets membres sont effacés — le move prend le
   contrôle. Continuité exacte : `pos(t=0) = from =` la position
   effacée, aucun saut.
3. Justification : le goto est une **commande de takeover explicite** —
   « amène ces objets à la pose ». Effacer le manuel fait partie de la
   sémantique de la commande, au même titre que `register_move`
   consomme les holds. Les objets **non membres** ne sont jamais
   touchés — la reprise manuelle hors distribution reste sacrée.
4. Le takeover *pendant* la rampe reste possible : l'opérateur pose un
   nouveau manuel → masquage immédiat (la main gagne, toujours). Le
   hold final l'écrasera — c'est le point 6.1(a), assumé.

Slots hand-authored : pas de clear automatique (le slot est un move
comme un autre — sémantique générale inchangée). L'opérateur qui
hand-craft sait que manual masque. Documenté dans la fiche node.

### 6.3 Cues ✅ aucun cas spécial

Un goto en vol snapshoté par une cue : `MoveSnapshot.graph_json` = le
graphe synthétisé (from/to figés au fire) — le recall rejoue la fin de
l'animation depuis ses positions figées. Sémantiquement correct : la
cue capture ce qui jouait. Pas de champ nouveau, pas de migration.

Interaction inverse — une cue scopée `positions` rappelée pendant un
goto : les positions manuelles de la cue masquent le goto (manual >
move). Cohérent avec tout le reste.

### 6.4 Holds et chaînage ✅ correct par construction

`register_move` consomme le hold des tracks reprises — un goto qui
reprend un objet tenu par un goto précédent part bien de la position
tenue (lue via `last_position` avant le register). Le chaînage
goto(A) → goto(B) est fluide sans code nouveau.

### 6.5 Macros et post-process ⚠️ décision requise

Les positions de moves passent par les macros (scale/rotate/shift), les
positions manuelles par les macros de base sans les deltas signal. Les
poses sont stockées en **espace canonique** — sous macro active, la
position monde finale n'est pas exactement la pose. C'est **cohérent**
avec tout le système (trackpos, anchors, manual vivent dans le même
espace) — documenté, pas un bug. Un opérateur qui veut des positions
monde exactes neutralise les macros, comme aujourd'hui.

### 6.6 PSN / park ✅ la priorité tranche

`park > psn > hold > manual > move` — un objet parké ou sous PSN est
intouchable par le goto (son output merge est ignoré). Le spawn doit
**exclure les objets parkés/PSN de la distribution synthétisée** —
sinon ils occuperaient un slot du ramp pour rien. (Warning preflight.)

### 6.7 Score timeline

Nouveau payload de clip :

```rust
Pose {
    name: String,
    mode: PoseClipMode,         // Snap | GoTo | Morph { from_pose }
    duration_ms: u64,           // 0 = snap
    easing: String,
}
```

Résolution au fire dans `fire_clip` — le scheduler est backend, les
poses sont backend : pas de roundtrip. `Snap` = écritures manuelles
(même chemin que le clip `Positions` existant — qui reste tel quel,
c'est la version positions littérales). `GoTo`/`Morph` = synthèse +
`spawn_move`. Le clip respecte la durée timeline comme tout clip move
(end prématuré = fade_out du move, la cible n'est pas atteinte — cohérent).

### 6.8 Undo/redo, dirty tracking, .hfg

Les poses vivent backend — hors du graphe undo/redo (comme les cues et
les mappings OSC, déjà hors undo). Dirty tracking : la section `poses`
de l'enveloppe participe au diff `envelopeComparable` — éditer une pose
marque le show dirty. À câbler comme `oscMappings`.

## 7. Matrice de fallback (demande explicite)

| Situation | Comportement |
|---|---|
| Track dans la pose, patchée, position connue | Normal |
| Track dans la pose, **non patchée** | Commande goto/morph : exclue de la distribution avant spawn + warning. Slot hand-authored : objet figé sur place (voir ci-dessous) |
| Objet du move absent de la pose `to` (slot hand-authored — la résolution compile ne peut pas être sparse : `n_objects` est structurel) | **Freeze-in-place** : cible = sa propre position de départ (`lerp(x,x,t)=x` — il ne bouge pas, participe au merge normalement, takeover possible). Warning à la résolution |
| Objet sans position connue (`from` non résolvable : jamais émis, pas de trackpos) | **Appear-at-target** : départ = cible (il ne rampe pas, il est simplement là — la seule information honnête disponible). Warning. Jamais de `[0,0,0]` inventé |
| Morph : track dans B mais pas dans A | Départ = position live |
| Morph : track dans A mais pas dans B | Ne participe pas (B définit la distribution) |
| Anchor pose : objet absent de la pose | Fallback capture live (= `Current`) |
| Goto : objet parké/PSN | Exclu du move synthétisé + warning |
| Pose vide ou inexistante au recall | `nack` OSC / toast UI — aucune mutation |
| Remapping OSC après capture | Les poses sont track_id-keyed — la conversion obj_index se fait à l'usage avec le mapping **courant** (règle namespace AGENTS.md) |

## 8. Surface de contrôle

### OSC (backend-direct — pas de roundtrip webview)

| Address | Action |
|---|---|
| `/stagespace/pose/capture <name> [track…]` | capture les tracks (ou toutes les connues) |
| `/stagespace/pose/snap <name>` | rappel instantané |
| `/stagespace/pose/goto <name> [dur] [easing]` | animation vers la pose (durée s, défaut configurable ~2) |
| `/stagespace/pose/morph <A> <B> <dur> [easing]` | animation A→B |
| `/stagespace/pose/list` | dump `/stagespace/pose/state <name> <ntracks>` |

ack/nack standard. Refus pendant recall de cue comme les slot commands.

### UI — panel « Poses » (surface Conduite, duplicable en Jeu)

- Liste des poses : nom, nombre de tracks, aperçu.
- **Capture** : bouton « capture » — tracks sélectionnées si sélection
  active, sinon toutes les positions connues. Naming inline.
- **Recall** : boutons `snap` / `goto` avec champ durée + easing par
  ligne ou global ; morph via sélection A→B (deux poses cochées).
- **Édition** : table positions par track (x/y/z éditables, ajout/retrait
  de tracks) — pour les poses construites numériquement.
- **Visualisation** : ghost des cibles dans la 3D/radar (pattern des
  fantômes au repos — cercles pointillés + label du nom de pose) quand
  une pose est sélectionnée dans le panel. Option Settings existante
  « fantômes » étendue.
- Badge warning sur les poses partiellement patchées.

### Preflight `check` (score)

Les clips pose non résolubles (pose absente, tracks non patchées) →
warnings du check, même passe que les refs slot/cue orphelines.

## 9. Plan d'implémentation phasé

| Phase | Contenu | Dépendances |
|---|---|---|
| **P1 — modèle + snap** ✅ | `Pose` backend, CRUD commands, capture, snap, section `.hfg`, panel UI minimal (liste/capture/snap), OSC capture/snap/list | — |
| **P2 — goto animé** ✅ | engine `poseramp` + tests, synthèse de graphe au fire, `pose_goto` (Tauri + OSC), boutons goto du panel | P1 |
| **P3 — morph A→B** ✅ | `pose_morph`, OSC `/stagespace/pose/morph`, UI sélection A→B, fallback live matrice §7 | P2 |
| **P4 — ancre pose** | `AnchorMode::Pose` — plomberie spawn + enum + UI slot | P1 (indépendant de P2/P3) |
| **P5 — score** | clip payload `Pose`, résolution au fire, preflight check | P2 |
| **P6 — visualisation** | ghosts de pose dans 3D/radar | P1 |
| **P7 — raffinements** | hold-respecte-takeover (6.1b), easing additionnels, édition numérique avancée | selon retour |

Tests par phase : unitaires engine (poseramp : bornes, easing, clamp),
intégration merge (goto atteint la cible au centième, takeover masque,
hold final exact), Tauri (commands, fallbacks, nacks), frontend (panel,
enveloppe .hfg round-trip).

## 10. Points de décision ouverts

1. **6.1 (a) vs (b)** — le hold final écrase-t-il une reprise opérateur
   en cours ? Recommandation (a) simple d'abord.
2. **Easing par défaut** — `smooth` (smoothstep) recommandé : départ et
   arrivée à vélocité nulle, musical. `linear` disponible.
3. **Durée par défaut du goto OSC** — 2 s ? Configurable dans Settings ?
4. **Capture « toutes les positions connues »** inclut-elle les objets
   sous move (positions émises) ou seulement manual/hold ? Recommandation :
   tout ce qui a une position canonique — c'est la photographie de
   l'état visible, peu importe la source.
5. **Poses dans les cues ?** — une cue pourrait référencer « pose X
   armée » plutôt que des positions littérales. **Non recommandé** : la
   cue snapshotte des positions littérales, ce qui est plus sûr (la pose
   peut être éditée après — la cue ne doit pas changer). Les poses
   restent un outil de live/score, pas un ingrédient de cue. Note : les
   graphes `poseramp` capturés en vol par un snapshot de moves restent
   référentiels (§5.2) — accepté, documenté, marginal.
6. **Hot-swap et re-résolution** — faut-il geler le resolver après le
   premier compile d'un move (continuité garantie en édition live) ou
   re-résoudre à chaque recompile (rebind, discontinuité possible) ?
   Recommandation : re-résoudre — cohérent avec la recapture d'ancre,
   et l'édition live d'un goto est un cas expert.
