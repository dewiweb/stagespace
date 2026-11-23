# Score — multitrack automation sequencer (design)

> **Status: design note.** Vision: the score is the *ultimate* level of
> show programming — a timeline where the show IS the structure, above
> the discrete cue machine of Conduite.
> Implementation status & phased plan live in
> [score-sequencer-plan.md](score-sequencer-plan.md).

## Why

Today `ScorePanel` is a *command tape*: `rehearsal` records timestamped
busking actions (`liveActionsRehearsal.ts`, ~160 lines, frontend-only)
and replays them through a chain of `setTimeout`. It captures the right
verbs but is the embryo, not the concept:

- **Frontend-timed** — jitter, dies on webview reload, violates the
  "backend owns runtime truth" rule.
- **Flat** — one linear tape, no parallel lanes, no continuous
  automation.
- **No persistence in the show** — lives in `localStorage`, not the
  `.hfg` envelope.

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

**"Flatten cue → clips"** existe comme *opération d'éditeur* (menu
contextuel, non-destructif — la cue vivante reste référencée) :
`moves[]` → clips slot sur les lanes obj- ; `macros`/`spatial_macros`
→ keyframes GLOBALFX ; `signal_graph` → clip MODULATION ;
`manual_positions` → marqueurs de position ; les métadonnées timing
se résorbent dans la position temporelle. Modèle du clip imbriqué de
DAW : référence vivante par défaut, flatten quand on veut éditer
l'intérieur — jamais l'inverse.

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
- Commands: `score_load`, `score_play`, `score_pause`, `score_seek`,
  `score_set_loop`; state polled/emitted like movements (`score/state`
  event: cursor, playing, active clips) → webview is a view, not the
  clock.
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
- Optional "record to score" — capture live busking *into* tracks ;
  les pistes par objet rendent le dépôt naturel : une prise = des
  clips éparpillés sur les pistes objets + les événements globaux
  sur le master (supersedes today's rehearsal tape as an import path).

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
- **Référence** (entité partagée) → `Rendre unique` clone le slot
  en banque et repointe `ref.slotId` : en mode suivi le clip suit
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
| **S1 — backend tape** | Move today's rehearsal model backend-side: timed command entries evaluated at tick, `score/*` transport commands, `.sscore` kept as export | Quick win: fixes `setTimeout` replay, survives reload; UI unchanged |
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
