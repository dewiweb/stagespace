# Score — multitrack automation sequencer (design)

> **Status: design note.** Vision: the score is the *ultimate* level of
> show programming — a timeline where the show IS the structure, above
> the discrete cue machine of Conduite.
> Implementation status & phased plan live in
> [score-sequencer-plan.md](score-sequencer-plan.md).

## Why

The score is a **backend-executed multitrack sequencer** AND a
**recorder**: it plays the partition from the backend clock and
captures live busking into editable clips. It replaces the earlier
embryos — a frontend-timed `setTimeout` tape and a backend-clocked
command tape (S1, removed).

The user's framing: a **multitrack automation sequencer** (audio/video
sequencer metaphor) — its own surface, where you place moves and cues
as clips and write per-object / global-parameter / modulation
evolutions as continuous curves. It surpasses Conduite: Conduite is a
discrete state machine (cue→cue recall), the Score makes the show a
timeline.

References already in the repo: `RESEARCH_STATE_OF_ART.md` (IanniX
poly-temporal score, ossia score) and `dev-plan-spatial.md` A1.6
"diffusion score view" (marked long-term).

## Conceptual model

```
SCORE = transport + tracks + evaluation engine

Transport : play / pause / seek / scrub / loop / TC chase
Track     : typed lane holding clips or automation
Clip      : { t_start, duration, payload } placed on a track
Automation: { param_ref, keyframes[], interpolation } on a track
```

### Track types

| Track | Payload | Backed by (existing primitive) |
|---|---|---|
| `slots` | Move clips `{slot_id, fade}` — start/stop at timestamps | `activate_move` / `stop_slot`, `hold`/`anchor current` chaining |
| `cues` | Recall markers `{cue_id}` on a conductor lane | `cue/recall`, atomic recall, `pre_wait` |
| `macros` | Automation `{macro, keyframes}` — speed, scale, shift, yaw, radius… | `/stagespace/macro <name> <v>` (already continuous) |
| `modulations` | Envelopes / routing switches on the signal graph | `SignalMap`, `ChannelModulation` rules |
| `objects` | Per-object params: manual position curves, park windows, attention | `/stagespace/position`, `park`, `attention` |
| `gestures` | One-shot ballistic events at a timestamp | `/stagespace/gesture`, `throw` |

Ces types décrivent les *payloads* de clips. Le modèle de pistes a
depuis évolué (voir §Surface) : les pistes sont **par objet + master**
plutôt que par type — un type de clip détermine sur quelle piste il
peut vivre (objet → sa piste, global → master, cue/marker → master
ou piste dédiée).

### Automation data

```ts
interface Keyframe { t: number; v: number; ease?: 'linear'|'smooth'|'step' }
interface AutomationLane {
  target: string;            // e.g. 'macro:speed', 'obj:3:pos.x', 'mod:gain'
  keys: Keyframe[];          // sorted
  interp: 'linear' | 'smoothstep' | 'step';
}
interface ScoreClip {
  id: string;
  trackIds?: number[];       // override de couverture — absent = suit
                             // l'entité vivante (réassignations propagées)
  start: number;             // seconds, score time
  duration: number | null;   // null = event/marker
  curves?: Record<string, Keyframe[]>;  // t relatif clip (per-move)
  payload: SlotClip | CueMarker | GestureShot;
}
interface Score {
  id: string; name: string;
  duration: number;
  loop?: { start: number; end: number };
  laneStates: Record<string, LaneState>; // overrides des pistes dérivées
  clips: ScoreClip[];
  masterCurves?: Record<string, Keyframe[]>; // t absolu (macros globales)
  tc?: { fps: number; offset: number };  // reuses the TC engine
}
```

Persistence: `Score` joins the `.hfg` envelope (document, not runtime)
→ dirty tracking, save/load, autosave apply unchanged.

### Loop semantics — two distinct notions (S2.x)

- **In-clip loop** (`MoveSlot.loop_mode = 'loop'`, existing): the
  *trajectory* cycles continuously for the whole clip duration. One
  spawn, no re-articulation. A 30 s slot clip of a looped circle =
  30 s of uninterrupted orbiting.
- **Clip repeat** (`repeat_every_ms`, S2.x): the *clip itself*
  re-fires — the scheduler materializes bounded copies at
  `start + k·every` inside the clip's window (`duration_ms`, required).
  Each copy is a fresh spawn/pulse: re-anchored, re-faded —
  rhythmic re-articulation, not continuous motion. With
  `anchor: current` each copy chains from where the previous one
  ended → evolving patterns. Iteration movement-ids are suffixed
  (`sc-{clip}-{k}`) → deterministic deactivation, seek-safe (a seek
  landing mid-iteration starts it with `time_offset`). Expansion is
  materialized at play time (bounded to 4096 iterations) — no infinite
  scheduler, no unbounded worker fan-out.

The distinction matters musically: internal loop = continuous gesture;
clip repeat = the same *phrase* reiterated. A future "pattern clip"
(nested clip group that tiles) generalizes this to multi-lane phrases
(moves + cues + markers repeated together) — S3+ territory.

A third level landed in S2.y: **transport loop** (`loop_region` —
the `loop` field above). The whole arrangement wraps `[start,end)`
with hard-cut semantics: cycle moves are deactivated at `loop_end`,
the cursor re-bases, a fresh event list is generated. Events before
`loop_start` play once on the first pass → intro-then-loop.

### Cues on the timeline — lane CONDUCTOR + barrière d'état

Deux catégories ontologiquement différentes cohabitent sur la timeline :

| | Contenu continu (lanes) | Événements-barrières (globaux) |
|---|---|---|
| Entités | moves, courbes d'automation | cue recall, stopAll, panic |
| Composition | s'empilent dans le temps ; conflits tranchés par les règles de lane (`stacked`/`exclusive`) | **cassent** la composition — transition atomique instantanée |
| Portée | couverture par objet (`trackIds`) | tout le runtime |

Une cue est par nature la deuxième catégorie : `recall_cue_inner` est
une transition d'état **atomique et globale** — crossfade de l'output
layer entier (`begin_transition`), kill des moves non listés (mode
Full), respawn des `active_move_ids`, hot-swap des graphs, suppression
OSC-IN pendant fade+500 ms. La représenter "sur des lanes d'objets"
serait un mensonge sémantique : sa couverture réelle déborde toute
piste (et `track_indices` vide = **tous** les tracks, pas aucun).

**Modèle retenu — la cue reste une référence atomique :**

- **Lane CONDUCTOR** (la piste du chef d'orchestre) — pas `obj-N`.
  Une cue n'appartient pas à un objet, elle appartient au show.
  C'est la traduction timeline de la setlist de Conduite.
- **Blast radius visualisé** : le clip cue dessine son empreinte sur
  les lanes en dessous — lanes tuées (Full) ou touchées
  (Tracking/scope). `track_indices` vide → empreinte sur **toutes**
  les lanes.
- **Durée affichée = `fade_duration`** (le crossfade) — un tail, pas
  une fenêtre de clip : la cue n'a pas de fin propre, c'est un point.
- **Sémantique barrière côté backend** : au fire, `lane_active` est
  *released* — les moves score sont tués (Full) ou mergés (Tracking),
  le score perd l'autorité jusqu'au prochain clip. Les
  `active_move_ids` respawnés par la cue — connus statiquement dans
  le snapshot — sont enregistrés pour le cleanup au wrap/stop → pas
  de fuite entre cycles de loop, déterminisme garanti.
- **`pre_wait` / `follow` / `timecode` bypassés** : ce sont des
  sémantiques de *setlist* (timers frontend). Sur un score, la
  timeline EST le timing — le tir est instantané au timestamp du clip.
  Même cue, comportement différent Conduite (timing interne joué) vs
  Score (timing externe imposé) — c'est voulu, pas un bug.

**"Exploser la cue → clips"** (`flattenCueClip`, menu contextuel /
toolbar `◆ flatten` / MenuBar Edit) — *bounce to tracks* non
destructif : le clip cue est remplacé par l'arrangement contenu dans
son snapshot, la cue d'origine reste intacte dans la cuelist et
rappelable en Conduite. Matérialisé :

- `moves[]` → **nouveaux slots en banque** (`‹cue›·‹move›`, graphe /
  signal / end-mode / anchor / fades / loop du snapshot conservés,
  couverture `obj→track` convertie) + un clip slot **en suivi live**
  à l'instant du clip cue (durée = `move.duration`).
- `macros` + `spatial_macros` → keyframes **GLOBALFX** à l'instant du
  clip (les 8 champs `MacroSnapshot` + `radius_scale`/`height_offset`
  → param ids identiques).
- `manual_positions` → clip **`positions`** (marqueur par piste, la
  donnée est portée par le clip en `track_id`, convertie `obj_index`
  à la résolution — même chemin backend que `/stagespace/position`).
- `signal_graph` → clip **`modGraph`** sur la lane MODULATION (le clip
  porte le graphe ; au tir : compile + hot-swap de la SignalFn globale,
  même chemin que `update_signal_graph`).
- `global_graph` → clip **`postGraph`** sur la lane **SPATIALFX** (le
  clip porte le graphe post-process ; au tir : parse →
  `extract_graph_effects` → `compile_post_process` → swap de la
  `post_process_fn` + `set_graph_effects` + stratégie du node `Merge` —
  même chemin que `recall_cue` étape 1). C'est la moitié **déclarative**
  des zones/modulations (nodes `Zone`/`Velocity`), disjointe des tables
  manuelles `cue.zones`/`cue.channel_modulations` : matérialiser les
  tables sans le graphe perdrait silencieusement la moitié déclarative.
- `channel_modulations` → clip **`chanMods`** sur SPATIALFX — la table
  de règles cinématiques **manuelles** (clear + install au tir, même
  chemin que le recall) ; la moitié déclarative (nodes `Velocity`)
  revient via `postGraph`.
- `zones` → clip **`zones`** sur SPATIALFX — la table de zones
  **manuelles** (clear + install) ; les zones des nodes `Zone` du
  graphe reviennent via `postGraph`.
- `per_track_depths` → keyframes **`depth`** des lanes objet (courbes
  éditables, temps absolu → `set_track_depth` au tick — absent = 1.0)
- `object_channels` → keyframes **`gain`/`spread`/`distance`/`presence`/
  `yaw`/`aperture`/`lfe`** des lanes objet (mêmes noms que
  `SpatialChannel` → `set_object_channel`)

Ces types de clip sont les **exceptions au modèle par référence** :
le clip porte sa donnée (pas d'entité vivante correspondante —
matériau matérialisé, éditable indépendamment de la cue).

**"Arrangement → cue"** (`★ cue` dans le transport,
`snapshotScoreAt` → `store_score_cue`) — l'inverse exact du flatten :
l'état de la partition **au curseur** est matérialisé en nouvelle
cue (aucune capture runtime live — tout est évalué depuis le doc).
La boucle cuelist↔score est fermée : arranger une cue aplatie puis
la re-capturer produit le snapshot modifié.

- clips `slot` couvrant le curseur → `moves[]` (`MoveSnapshot`
  complets, reconstruits via `buildSlotActivation` — même chemin que
  la résolution des clips). Sémantiques du scheduler respectées :
  lane **exclusive** = le clip le plus tardif couvrant la lane tue
  le move des précédents ; **stacked** = coexistence ; **mutée** =
  la couverture du clip est restreinte aux tracks non mutées.
- `positions` + courbes `pos.*` → `manual_positions` (obj_index,
  courbes écrasant la table clip).
- `zones`/`chanMods` derniers tirés + courbes `zone:…`/`mod:…` à t →
  `zones`/`channel_modulations` (mêmes patchs que
  `eval_spatial_fx_param`).
- `postGraph`/`modGraph` derniers tirés → `global_graph`/`signal_graph`.
- macros de slot (appliquées au lancement du dernier clip survivant)
  + courbes GLOBALFX à t → `macros`/`spatial_macros`.
- courbes `depth`/canaux des lanes objet → `per_track_depths` (trous
  à 1.0 — défaut du recall) / `object_channels`.

Ce qui n'est **pas** un état n'est pas snapshoté — rapporté dans
`skipped` du toast : événements conductor (gesture/park/attention…),
clips cue imbriqués, courbes clip-scoped (elles vivent sur le worker
spawné — le cue recrée le seed du slot), courbes MODULATION (valeurs
SignalOsc, pas un champ de cue), `spatial` (compresseur — pas un
champ de cue).

**TC chase** (bouton `TC` du transport ou `/stagespace/score/chase
<0|1>`) — le transport score suit le timecode entrant
(`/stagespace/timecode`, même flux que les cues) : TC garé = locate
(le curseur suit, pas de lecture), TC qui roule = démarrage du
transport à la position TC (auto-play), en lecture = rebase quand la
dérive dépasse le deadband (~80 ms — en dessous, le bruit TC ne
justifie pas un seek). Flag runtime persisté (localStorage), jamais
dans le doc.

**Preflight** (`✓ check` dans le transport, `validateScore`) —
résolution sèche de la partition, aucun effet : **erreurs** (ça ne
jouera pas — slot/cue orphelin, partition vide, boucle inversée) et
**avertissements** (ça jouera autrement qu'attendu — couverture vide
ou entièrement mutée, tracks hors du patch OSC, clip au-delà de la
durée, courbes sur paramètres inconnus ou sans table à patcher
(`zone:i:` sans clip `zones`, `mod:` sans `chanMods`), courbes
clip-scoped sur un clip non-slot). Rapport en modale, erreurs
d'abord.

### Lane SPATIALFX — surcouche d'effets

La lane `spatialfx` (entre GLOBALFX et MODULATION) porte le périmètre
de l'onglet FX de l'Atelier en timeline : les clips `postGraph` /
`zones` / `chanMods` installent la **structure** (pipeline, tables de
contraintes et de règles — install clear+set comme le recall), et ses
courbes en temps absolu modulent les **scalaires** de ces définitions :

- `ksmooth` → `set_kinematic_smoothing` (lissage cinématique global)
- `zone:<i>:<field>` → patch en place de la zone `i` de la table
  courante (`update_zone`) : `falloff`, `strength` (des effets
  repel/attract/dampen/vortex), `enabled` (step, v ≥ 0.5). `i` est
  **positionnel** — le dernier clip `zones` tiré fixe l'ordre.
- `mod:<src>><ch>[@<obj>][#<n>]:<field>` → patch en place de la n-ième
  règle matchant `(source, channel, object)` (`update_modulation`) :
  `scale`, `offset`, `min`, `max`. La clé est stable entre les
  réinstallations de table ; `#n` départage les triplets en doublon.

**La courbe réécrit la définition, jamais l'influence** — une zone est
une contrainte évaluée par le merge à chaque frame depuis les positions
réelles (SDF → influence → lerp des canaux / déplacement). Le score
automatise « la zone grandit, se durcit, se coupe » ; le merge garde
« qui est dedans et à quel point ». Clé/index inconnu → skip honnête
(une courbe ne module qu'une contrainte installée).

Les **courbes des lanes objet** (`depth` + canaux + `pos.<axis>`) sont
une troisième couche de courbes du score — temps partition absolu
comme GLOBALFX/MODULATION, mais par lane `obj-<trackId>` : cliquer
l'en-tête de lane les édite en zone haute ; la lane mutée est skippée
à la résolution ; les lanes sont converties `track_id → obj_index` au
chargement (règle namespace). Ce sont de **vrais paramètres runtime**
— jamais dérivés d'un graphe (les nodes `PerTrackDepth` lisent les
depths, les canaux sont émis en OSC en sortie).

Les courbes **`pos.x` / `pos.y` / `pos.z`** écrivent une
`manual_position` au tick — trajectoire authored, le geste que la
conduite ne peut pas reproduire. Les axes sans courbe gardent la
position courante (manual_position si posée, sinon dernière émise) —
takeover partiel sans saut. Fin de courbe = **hold** : la dernière
valeur écrite persiste comme une position manuelle posée à la main
(un clip `manualClear` la relâche).

**Partition courbes-seules** : le transport joue dès qu'il y a du
contenu (clip OU courbe non vide) et vit jusqu'au **dernier keyframe**
— une prise qui n'est qu'une trajectoire enregistrée joue sans aucun
clip, et la queue d'une courbe au-delà du dernier clip continue
d'écrire.

### Lane OSC — orchestration externe

La lane `osc` fait du score le chef d'orchestre du **show entier**,
pas seulement du spatial : ses clips émettent des messages OSC
arbitraires vers le matériel externe (lumières, vidéo, consoles,
autres machines). Clip instantané édité dans l'inspector :

- `addr` — l'adresse OSC (`/light/go`, `/video/cue/12`…)
- `args` — mini-langage à tokens : `42` → int, `1.5` → float,
  `"texte"`/`'texte'` → string, `true`/`false` → bool
- `target` — cible override `host:port` ; vide = la sortie OSC du
  show (le renderer spatial)

Au tir, le backend encode le paquet (`rosc`) et l'émet en UDP,
fire-and-forget comme le reste du scheduler. **Gardes** : `osc_armed`
(dry-run = rien ne part), et les adresses `/stagespace/*` pointées
vers notre propre port d'entrée sont refusées — un clip qui
re-déclencherait le show-control bouclerait (footgun, pas feature).
Adresse vide → clip sauté (`validateScore` le signale en erreur,
adresse sans `/` ou cible malformée en avertissement).

### Lane CONDUCTOR — événements gestuels & contrôle

À côté des barrières (`cue`, `stopAll`, `panic`), la lane conductor
porte les **événements one-shot** d'opérateur — mêmes chemins backend
que les commandes OSC `/stagespace/*` (le score est un contrôleur de
plus, pas un runtime parallèle) :

| Clip | Effet au tir | Cibles |
|---|---|---|
| `gesture` | `gesture(name, strength)` — impulsion balistique explode/converge/orbit/front | tous les objets émis |
| `throw` | `throw_object(obj, vel)` par objet | couverture |
| `park` | `park_object` — fige + exempte des recalls | couverture |
| `unpark` | `unpark_object` par objet | couverture |
| `manualClear` | `clear_manual_position` par objet | couverture |
| `attention` | `attention_focus(1er couvert)` ; couverture suivie (aucune cible) → `attention_release` | couverture |

**Couverture = cible** : pour ces clips, `trackIds` n'est pas un
blast radius visuel mais la liste sémantique des objets visés —
`undefined` (suivi) = tout le patch à l'instant du play ; une liste
gelée = ces objets ; les lanes objet mutées excluent leurs cibles
(« lane mutée = le score n'y touche pas »). Les cibles sont
**toujours matérialisées** à la résolution — jamais un `objects: []`
que le backend lirait « clear global » : une couverture entièrement
mutée saute le clip (exception `attention` : couverture suivie →
`release` explicite, la forme « tout » du contrôle). Le mute de la
lane conductor saute tout l'événementiel. `strength`/`vel` s'éditent
dans l'inspector.

**Panic tue le transport** : `panic` (opérateur Esc, OSC
`/stagespace/panic`, ou clip `panic` du score) invalide la
génération de la timeline — le scheduler meurt, rien ne peut
re-tirer après un arrêt d'urgence. `stopAll` (`honor_end_mode`) ne
touche PAS le transport : un clip stopAll du score ne se suicide
pas, le score reste souverain de sa composition.

**Actions live — le score appuie sur le bouton** : les verbes de
l'opérateur qui n'ont pas de chemin backend direct vivent dans les
`do*` frontend. Le payload `LiveAction { name, arg }` re-émet
`score-live-action` vers l'UI, dispatchée vers les mêmes fonctions
que le show-control OSC :

| Clip | Action | Vocabulaire |
|---|---|---|
| `soundcheck` | sonde cyclique par objet (`start`/`stop`/`next`/`prev`, éditable) | `/stagespace/soundcheck` |
| `solo` | coupe les autres slots jouants puis joue le slot `n` (oscIndex) | `/stagespace/solo` |
| `unsolo` | rejoue les slots stoppés par le dernier solo | `/stagespace/unsolo` |
| `view` | bascule la surface opérateur (atelier/conduite/jeu/score) | `/stagespace/view` |
| `cueArm` | arme une cue sans la tirer (`cueId` → `cue_number` à la résolution) | `/stagespace/cue/arm` |
| `cueGo` | tire la cue armée (ou la suivante) | `/stagespace/cue/go` |

Ces clips vivent sur la lane **conductor** (mute = skip). `cueArm`
d'une cue supprimée saute honnêtement (`validateScore` erreur) ;
`solo` sans slot à l'oscIndex demandé est warné.

**Jeu — progression read-only** : la top bar de la surface Jeu
affiche `ScoreProgress` (curseur animé `▶ mm:ss / total`, barre de
progression, prochains événements façon « next cue », ⟳ si loop) —
l'opérateur voit l'avancement de la partition sans pouvoir l'éditer.

## Transport — sémantiques professionnelles

Le transport partage **une seule machine de rebase** —
`spawn_score_thread` + `kill_score_moves` + le miroir `tl.active`
(move_id → clip_id, lanes, fade, courbe) publié par le scheduler à
chaque événement :

- **`score_timeline_stop`** = le stop des autres modes : les moves
  `sc-*` sont désactivés selon leurs **fades et end_mode déclarés**
  (`honor_end_mode` — un `hold` écrit sa position tenue). Les moves
  opérateur ne sont jamais touchés (dual authority).
- **`score_timeline_seek` en lecture** = scrub : tous les moves
  score sont coupés net (fade 0, ids libérés), le scheduler repart
  au nouveau curseur — les clips chevauchant le point d'arrivée
  repartent avec leur offset de spanning. Arrêté : simple rebase.
- **`score_timeline_update`** = hot-swap de la partition **pendant
  la lecture** (édition live débouncée côté frontend). Le frontend
  calcule `dead_clip_ids` (clip.id disparu ou JSON modifié —
  `ScoreClip` est Deserialize-only) ; le backend coupe net les
  moves des clips morts et **hérite les moves des clips inchangés**
  via `tl.active` → pas de coupure audible. Les `EndMove` et les
  courbes des moves hérités continuent normalement.
- **`score_timeline_set_loop`** est live-safe : le scheduler relit
  `loop_region` à chaque événement — un changement s'applique dès
  le prochain événement/wrap, sans respawn.
- **`score_timeline_load`** = reset complet : stop + kill net des
  moves score + curseur à 0.

## Recorder — le séquenceur enregistre aussi

`doRehearsal record/stop` capture le busking (mêmes `do*` que
l'opérateur et l'OSC — Conduite, Jeu, GUI) en entrées horodatées
enrichies de **refs typées** (`RecRef` : slotId/cueId/trackIds/
positions résolus à l'enregistrement). Au stop, `recordingToScore`
matérialise la prise en clips + courbes ajoutés en fin de
partition :

- `doSlot`/`doSlotStop` s'apparient en clips bornés ; `doGo`/`doSolo`
  = stop-all + play ; panic/stop/cue Full ferment les clips ouverts ;
  la fin de prise ferme le reste au dernier événement.
- Positions → courbes **`pos.x/y/z`** des lanes objet : un drag
  enregistré devient une trajectoire keyframée éditable (pas un clip
  figé) ; un placement isolé = un point constant. Macros → courbes
  GLOBALFX (linéaires) ; `spatial` → courbe SPATIALFX (`spatial` =
  compresseur global, même chemin que `/stagespace/spatial`).
- Actions non convertibles (trackpos, config…) → `skipped` remonté
  à l'opérateur — jamais perdu silencieusement.
- Enregistrer pendant la lecture fonctionne (overdub) : les clips
  ajoutés rejoignent la lecture via le hot-swap.

Explicitement **non matérialisé** — rapporté à l'opérateur (toast +
`skipped`), jamais silencieusement perdu : `osc_mappings` (table
OSC-IN — config système, cas d'usage timeline discutable), `graph`
(legacy, quand `moves[]` est vide). La cue les conserve. Un clip cue
dont rien n'est matérialisable est **conservé**, pas effacé.
Modèle du clip imbriqué de DAW : référence vivante par défaut, flatten
quand on veut éditer l'intérieur — jamais l'inverse.

## The engine — backend-evaluated

The score is **evaluated inside the merge/runtime at the 60 Hz tick**,
never in JS:

- `ScoreRuntime` holds `cursor_t` (score clock), active clips, and
  evaluates automation curves each tick → writes macro values, manual
  positions, modulation params exactly like OSC-IN would (same command
  paths → same validation, same merge inputs).
- Clip boundaries emit the same commands the operator/OSC would send
  (`activate_move`, `cue/recall`, `slot/stop`…) — the score is *another
  controller*, not a parallel runtime.
- Commands: `score_timeline_load`, `score_timeline_play`,
  `score_timeline_stop`, `score_timeline_seek`, `score_timeline_set_loop`,
  `score_timeline_update` (hot-swap), `score_timeline_state`;
  state emitted as `score-timeline` events (cursor, playing, loop) →
  webview is a view, not the clock.
- TC chase: `cursor_t` can be *driven* by incoming timecode (existing
  `/stagespace/timecode/chase` machinery) — the score becomes the
  SMPTE-synced master plan of the show.
- Determinism: same input score + same t ⇒ same output; replay/tests
  can step the clock.

Conduite relationship: a `cues` track recalls cues at timestamps —
Conduite remains the *manual recovery* surface when the show deviates.
The score is the written plan; the console is the override.

## Surface

Fourth surface `SCORE` (`Atelier | Jeu | Score | Conduite`?) — a
composition mode, not a move-editing tool. Deux zones (décision de
design 2026-11-23) :

### Zone basse — la timeline à pistes

- Ruler + TC readout, transport cluster (play/pause/seek/loop, chase)
- **Les pistes SONT les objets** (implémenté S3) — une piste par
  `track_id` patché, **dérivées de la config** (pas des entités
  persistées — le doc ne stocke que leurs overrides mute/mode dans
  `laneStates`) **+ une piste "master"** pour tout ce qui s'applique
  à l'ensemble :
  - Master : courbes de macros globales (speed, scale, shift_xyz,
    yaw/pitch/roll, radius_scale, height_offset — merge,
    `/stagespace/macro`), markers stop/panic, à terme gestures,
    spatial k, attention.
  - Pistes objets : les clips move/cue qui les pilotent (copies
    liées — voir ci-dessous), à terme position manuelle (x/y/z
    courbes), park windows, throw/impulsions.
  - Une piste dont le `track_id` n'est plus patché mais qu'un clip
    couvre → **piste fantôme** (⚠, le clip y est muet).
- **Terminologie** : « piste » (pas « track » — collision avec les
  `/track/N` OSC) et « clip » pour les blocs posés sur les pistes.
  Renommage `ScoreTrack` → `ScoreLane` envisagé tant que la feature
  est jeune.
- **Clips superposés sur une piste** — `lane_mode` par piste :
  - `stacked` (pistes objets) : deux clips qui se chevauchent = deux
    moves simultanés dont les sorties se composent dans le merge —
    le chevauchement est une intention, la piste grandit
    verticalement (style éditeur vidéo / take lanes).
  - `exclusive` (cues, markers, master) : last-wins, le modèle
    console actuel — deux recalls simultanés ne veulent rien dire.
- **Couleur propre par type de clip** (slot / cue / marker / gesture /
  automation) + état visuel : clip « orphelin » (slotId/cueId
  supprimé) signalé en édition (hachuré/bord rouge), pas seulement
  en toast au play — `scoreResolve` remonte déjà ces erreurs.
- **Fades visibles dans le clip** (poignées triangulaires aux bords,
  comme un séquenceur A/V) : `fade_in_ms`/`fade_out_ms` clip-local
  optionnels (`None` = hérite du slot). Le chevauchement des fades
  entre deux clips consécutifs est un crossfade réel — l'ancien
  move s'éteint en fade pendant que le nouveau spawne. Fade shapes
  (lin/log/S) plus tard via `fade_shape`.
- ~~"record to score"~~ → **livré** : le recorder capture le busking
  en refs typées puis matérialise clips/courbes dans la partition
  (voir §Recorder — supersedes the old rehearsal tape, supprimée).

**Formations multi-objets — tranché (copies liées)** : un clip porte
sa **couverture** (`clip.trackIds` — les track-objets qu'il pilote)
et se rend **en copie liée sur chaque piste couverte** : une seule
entité clip, éditer un exemplaire (déplacer, fades, courbes) édite
tous les rendus. Sémantiques :

- **Slot** : la couverture est l'**assignation effective** du move —
  par défaut **suivie en live** (`trackIds` absent → dérivée de
  `slot.trackIds` à chaque rendu/play : une réassignation dans
  l'Atelier se propage au score automatiquement). L'inspector peut
  **geler** la couverture (toggle ⇄ → `trackIds` explicite = override
  local du clip : retirer un objet filtre les `osc_ids`/
  `track_indices` du spawn, en ajouter un étend le move). Le toggle
  ramène au mode suivi — la synchronisation avec les autres modes
  reste le défaut, l'override l'exception.
  Un seul spawn par itération (`sc-<clipId>`), enregistré dans toutes
  ses pistes — coupé si l'une d'elles (exclusive) reçoit un clip.
- **Cue** : la couverture est **dérivée du snapshot** (union
  `track_indices` scope + moves stockés + `manual_positions`,
  obj→track_id via la config courante) — info visuelle, le recall
  reste global.
- **Couverture vide** → le clip se rend sur la piste master (le
  contenu non-assigné/global reste visible) et est skippé au play.
- **Copie liée vs indépendante** : rendre le même clip sur N pistes
  = lié (couverture) ; dupliquer = copie indépendante dont la
  couverture peut diverger.

### Déliage — deux liens distincts (implémenté)

Un clip entretient deux liens, déliables séparément :

- **Couverture** (copies liées sur les lanes) → `Détacher T<n>`
  scinde le clip : l'original reçoit un override = couverture
  effective minus T<n> (suivre l'entité en excluant une piste est
  impossible par construction), un nouveau clip naît sur `[T<n>]`
  avec les mêmes placement/fades/courbes — **même entité**, le
  contenu reste synchronisé. Variante `Détacher T<n> → nouveau
  move` : le nouveau clip suit un **clone du slot** né assigné
  `[T<n>]` (nom `‹slot› ▸ T<n>`) — divergence de contenu possible,
  le move apparaît dans la banque (visible dans tous les modes).
- **Référence** (entité partagée) → `Rendre unique` clone l'entité
  et repointe la ref : slot → clone du move en banque
  (`‹slot› ▸ unique`) ; cue → duplication dans la cuelist
  (`‹cue› copy`, insérée après la source, `cue_number` null — à
  réassigner, deux cues au même numéro rendraient
  `/stagespace/cue/recall <n>` ambigu). En mode suivi le clip suit
  désormais le clone — le suivi live survit, seule la cible
  change. Le badge `lié ×N` indique combien de clips partagent
  l'entité.

Trois portes pour les mêmes verbes (même code, pas trois chemins) :

1. **Menu contextuel** (clic droit — `ui/ContextMenu`) : sur un
   rendu de clip (le couple clip×lane donne la piste), un en-tête
   de lane (mute/mode/ajout), le corps vide (ajouter à cet instant)
   et la ruler (bornes de loop).
2. **Toolbar** (`ScoreToolbar`) : ✂ split au curseur (`S`), ⧉ dup,
   ⌫, détacher ▾ (dropdown par piste), ⬡ unique ×N, toggle
   suivi⇄gelé.
3. **MenuBar global** : menu Show score (play/stop, désarmer la
   loop, stop all, panic) + section score dans Edit (mêmes verbes
   sur la sélection — qui vit désormais dans `useScoreStore` :
   `selectedClipId`/`selGlobalLane`).

### Zone haute — éditeur de courbes du clip sélectionné

Au lieu d'une sous-piste d'automation par paramètre (modèle DAW
classique — explosion de pistes), l'éditeur de courbes est
**attaché au clip sélectionné** : un sélecteur liste les courbes
éditables du clip + un éditeur visuel de keyframes. Modèle *clip
envelopes* (Live) plutôt que *track automation* :

- Les courbes ne sont évaluées que pendant la fenêtre du clip —
  évaluation bornée, pas de lanes toujours actives.
- Même idiome que l'app : sélection → éditeur dédié (cf. Atelier).
- **Courbe vs fades** : les fades restent des poignées de bord de
  clip (articulation), les courbes sont les paramètres continus.

## Phases

| Phase | Scope | Notes |
|---|---|---|
| **S1 — backend tape** | ~~timed command tape~~ → **supprimée** : remplacée par le recorder→clips (§Recorder) — plus de tape parallèle, une seule timeline | Done — le concept S1 n'existe plus |
| **S2 — clip timeline** | `slots` + `cues` lanes, Score model in the envelope, surface with ruler + clip editing | The "written linear show" case |
| **S3 — automation** | pistes objets (+ master), courbes clip→macros per-move & master→macros globales évaluées au tick, keyframe editor | En cours : lanes objets + courbes livrés ; reste position/park/throw clips |
| **S4 — TC & poly-temporal** | TC chase as clock source, loop regions, multiple cursors / relative speeds (IanniX territory) | Open — design with RESEARCH_STATE_OF_ART §IanniX |

## Open questions

- ~~Clip overlapping semantics on one lane~~ → **tranché** : par
  piste, `lane_mode: stacked | exclusive` (voir §Surface).
- Automation vs operator takeover: priority rules (park/freeze/manual
  interactions — manual must stay sovereign, like OSC). Proposition :
  pendant la fenêtre du clip la courbe écrit en continu, sauf si
  l'objet est parké ou en position manuelle — l'opérateur garde la
  priorité absolue.
- **Fin de courbe = hold ou revert ?** Même question que `end_mode`
  pour les moves — la valeur écrite par la courbe tient-elle après
  la fin du clip (console) ou revient-elle ? Réutiliser la notion
  end_mode serait cohérent.
- **Fade_out dans la fenêtre ou en tail ?** Aujourd'hui `EndMove`
  tire à `end_ms` et le move s'éteint pendant le fade, au-delà du
  bord du clip (visuellement : un tail). Alternative type audio :
  `EndMove` à `end - fade_out` pour que l'objet atteigne sa position
  finale exactement au bord. Choix conservé pour l'instant :
  tail model.
- Does a score own the setlist (clips spawn slots) or reference it
  (clips point at existing slots — simpler, S2 choice)? Tranché S2 :
  référence — reste valable.
- ~~Placement des formations multi-objets~~ → **tranché S3** :
  copies liées sur chaque piste couverte (voir §Surface).
- Loop region × TC chase interaction
