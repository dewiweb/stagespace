# Plan — Lot 2 0.8.0 : vraie transform per-move + clarification UX des deux scopes

## Décision owner (29 nov.)

**Les deux scopes, clarifiés** : transform global ET transform per-move,
l'UX doit rendre la distinction évidente (aujourd'hui contre-intuitive).
Révision de l'estimation voie 2 : XL → **M** — l'architecture backend
existe déjà (audit T2), c'est essentiellement du câblage frontend.

## Le modèle réel (vérifié dans le code)

**Backend — tout existe :**
- Chaque worker a son `MacroState` propre, appliqué en **espace local**
  par `move_transform` à chaque frame :
  `raw → radius/height → fade → scale (pivot=centre traj) → rotation (pivot=centre traj) → + origin + shift`
- `SpatialMacroInit` au spawn (utilisé par le chemin legacy + cues, PAS
  par le chemin slot — `spec_from_request` met `spatial_macros: None`)
- `update_animation_state` écrit speed+scale+shift+rotation **au worker**
  — le live-update per-move est déjà câblé côté backend
- Composition : worker local → merge monde. Pas de contradiction
  multi-moves possible : chaque move transforme ses objets AVANT le merge.

**Sémantique des espaces — le cœur de la clarification UX :**
| Contrôle | Per-move (worker) | Global (merge) |
|----------|-------------------|----------------|
| scale | grossit la trajectoire **sur place** (pivot = centre du move) | écarte tout du **centre de la scène** |
| rotation | pivote la trajectoire **sur place** | tourne toute la scène autour de l'**origin** |
| shift | repositionne le move dans la scène (espace monde) | translate tout (espace monde) |
| speed | per-move (déjà) | — |

**Frontend — ce qui doit changer :**
1. `spec_from_request` : `spatial_macros: Some(...)` lu du payload
   animation (le backend sait déjà faire — chemin legacy). **Couvre
   playSlot ET score timeline** (même fonction partagée).
2. `playSlot` : ne plus pousser le spatial au global (`set_global_macro`).
   Le move porte sa transform ; le global reste où l'opérateur l'a mis.
3. Hot-swap (`throttledPushAnimationState`) : ne plus neutraliser le
   spatial — les vraies valeurs partent au worker, en live.
4. Speed : inchangé (déjà per-move partout).

## UX — la clarification

**Naming distinct et constant :**
- `Move transform` — « this move only · around its own center »
- `Global transform` — « whole scene · around the scene origin »

**Placement :**
| Surface | Move transform | Global transform |
|---------|---------------|------------------|
| Inspector + slot (Simple) | ✓ section dédiée (ex-« Transform ») | ✓ section (déjà ajoutée) |
| Inspector + slot (Expert) | — (expert = graphe, params) | ✓ (existant) |
| Inspector sans slot | — | ✓ (existant) |
| LiveDrawer playback | speed (existant) — extension optionnelle | — |
| LiveDrawer global / ViewerToolbar | — | ✓ (existant) |

**Hints d'espace — le pivot est le contre-intuitif :**
- Sous-titre de section Move transform : « this move only — scale/rotate
  around its own center, shift repositions it in the scene »
- Sous-titre Global transform : « whole scene — around the scene origin »
- Tooltips par contrôle sur scale/rotation (le pivot y est visible)
- Badge live existant (« N live ») conservé ; Move transform badge
  « live » quand le slot joue (les edits sont immédiats).

**Fin de la fiction preset :** les valeurs stockées SONT la transform du
move — live quand il joue, effectives au prochain lancement sinon. La
modale MovesTable perd son libellé « Applied on launch and GO » (devenu
faux) → « this move's transform — live while playing ».

## Migration comportementale

Shows existants avec `slot.macros` ≠ neutre : avant, scale/rotation
s'appliquaient en pivot scène (global) — après, en pivot move (local).
Visuellement différent. Accepté : l'ancien comportement était la fiction
visée par A5, 0.8.0 est le bon moment (pre-1.0). À documenter dans les
release notes. Shift : quasi-identique (monde dans les deux cas).

## Hors scope

- radius_scale/height_offset per-move (le worker les applique mais ni
  `SpatialMacroInit` ni `MoveMacros` ne les portent — restent globaux)
- Visualisation du pivot dans la vue 3D (idéal mais chantier propre)
- Extension LiveDrawer playback au spatial complet (speed suffit en jeu)

## Tests

- Backend : test spawn_move avec spatial_macros — le worker restitue la
  transform (positions émises scalées/rotées/shiftées) ; test composition
  per-move + global.
- Frontend : régression — playSlot ne pousse PAS set_global_macro ;
  hot-swap envoie les vraies valeurs (pas neutralisées).
- Live bridge : un move scale 1 + scale 2 visuellement distincts ;
  édition live du scale per-move n'affecte que ce move.
