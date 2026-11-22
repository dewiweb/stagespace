# Audit UX/UI — STAGESPACE

Audit heuristique + parcours cognitif réel (captures : audit-atelier,
audit-expert, audit-conduite, audit-jeu — session du bridge dev).
Complément des tests fonctionnels `e2e-findings.md` : ici on évalue la
**complexité perçue** pour un opérateur qui ne connaît pas l'interne.

## Ce qui fonctionne (à préserver)

- **Conduite lisible à distance** : NOW/NEXT, gros CUE GO, PANIC rouge —
  la surface fait son métier.
- **WelcomeModal** : le modèle mental Template→Move→Setlist→Cue est
  explicité — la seule fois où il l'est.
- **États vides honnêtes** : « + Move creates a slot · a template fills
  it · ▶ launches it » guide réellement.
- **Erreurs parlantes** : « OSC destination unreachable — nothing is
  listening » au lieu de codes cryptiques.
- **Status bar pro** : FPS/OSC/cpu/merge — la télémetrie show est là.

## Problèmes — par impact

### P1 — Terminologie : 5 noms pour le même concept

Le même objet s'appelle selon l'écran : **move** (WelcomeModal,
MovesTable), **slot** (empty state « creates a slot », Inspector
« Select a slot », code), **pad** (Jeu), **layer** (« Launch —
layered », badge NOW sur layer), **animation** (AnimationList.tsx,
update_animation_state). WelcomeModal enseigne « Move », le canvas dit
« slot » dès la première minute — le modèle mental donné au welcome est
immédiatement contredit.

**LIVE a 4 sens distincts** sur une même capture : nb de moves live
(`1 LIVE`), OSC armé (`● LIVE` vs DRY-RUN), slot playing vs preview
(`LIVE`/`PREV`), chip `LIVE 1` (compteur). Un opérateur ne peut pas
dire lequel clignote.

**track/object** fuit dans le graphe : le node `Objects` édite
« Linked Tracks » — l'utilisateur écrit des track_ids dans un node
nommé Objects.

### P1 — Trois systèmes de progression qui se recouvrent sans explication

**Cues** (CUE GO / Prev / Next — snapshots), **Setlist** (SETLIST▶ —
moves ordonnés), **busking** (pads — libre). Sur Conduite : `CUE GO` et
`SETLIST▶ Pursuit` côte à côte — deux boutons GO, conséquences
radicalement différentes (recall = tue la scène / GO = crossfade).
Sur Jeu : les trois coexistent + `PLAY tap a move` grisé.
NOW reste vide quand un move tourne hors cue — l'écran ne dit pas
pourquoi.

### P2 — Deux listes « Moves » face à face (Atelier)

Table gauche SHOW>Moves (13 items, ordre SET) et panneau droit MOVES
(14 items) — même concept, deux ensembles, libellés identiques.
Différence (setlist ordonnée vs bibliothèque ?) jamais expliquée.

### P2 — Densité Jeu

~10 contrôles en top bar (PLAY/SETLIST▶/CONDUITE/2 icônes/LIVE/PANIC) +
SPATIAL/ATTN/STOP ALL + setlist + cues + 14 pads + radar 6 légendes +
6 chips d'inspecteur (Params/Playback/Tracks/Audio/OSC IN/Global =
le même éditeur qu'Atelier). Tout est visible, rien n'est prioritaire.
Le radar n'auto-zoome pas : cluster de 64 objets = point minuscule.

### P3 — Node Editor : catégories par implémentation

`MATH ENGINES` (15) / `PHYSICS ENGINES` (6) — vocabulaire interne, pas
des tâches opérateur (Trajectoires / Modificateurs / Contrôles).
3 onglets de graphes (Move graph / Global FX / Modulation) + tiroir
Ports = trois modèles mentaux dans un éditeur. Ports = points
minuscules, direction implicite ; minimap blanche illisible.

### P3 — Jargon exposé

`hold=bump` (chaque pad), `·unverified` (status bar), `ATTN`, `trk`,
`merge 22µs lock`, `GO AVANCE ICI`, `0/13`, `PREV`. La status bar
mélange show-critical (armed, panic) et debug (merge lock).

### P4 — Affordances & espaces morts

- Pads = `pointerdown` (pas click) — cohérent tactile, non signalé
- `Draw` désactivé silencieusement (pas de node dessinable — bon,
  mais aucun tooltip ne dit pourquoi)
- Assign pick : cible 3D petite, aucun retour visuel sur l'objet
  survolable
- `PLAY tap a move` grisé : le label sert d'hint — bouton ou message ?
- Settings > Audio : modal 520px avec un seul select et 80% de vide ;
  « Microphone / audio interface » ne dit pas comment capter la sortie
  (monitor PipeWire — le cas réel fooyin)
- Toolbar : undo/redo/save/load en icônes nues

## Pistes d'amélioration — classées

### Rapide (wording/visuel, pas de restructure)

1. **Glossaire unifié** : choisir UN nom (move) → corriger empty state,
   Inspector, tooltips « slot/layer ». Renommer `LIVE` selon le sens :
   `● OSC OUT` / `PLAYING` / `N live` / pad = pas de badge (la couleur
   suffit).
2. **Expliquer les 3 GO** : sous-titre sous CUE GO (« recall — remplace
   la scène ») et SETLIST (« next move — les layers continuent »).
3. **Dé-jargonner** : `hold=bump`→`hold to bump`, `unverified`→tooltip
   complet, `trk`→`tracks`, chips `ATTN`→`ATTENTION`, log > debug
   dans StatusBar repliable.
4. **Hints sur éléments désactivés** : tooltips « Draw: no drawable
   node in this graph », « PLAY: select a move first » (remplace le
   label-hint).
5. **Settings > Audio** : remplir le modal — device + état capture +
   note « pour capter la sortie système : source par défaut sur le
   monitor » + lien panneau Audio.

### Moyen (restructure légère)

6. **Unifier les deux listes Moves** : la table gauche = source unique
   (ordre setlist), le panneau droit devient filtre/groupe de la même
   source — ou renommer explicitement leurs rôles (« SETLIST » vs
   « LIBRARY »).
7. **Jeu — hiérarchiser** : pads+radar = primaire ; replier setlist/
   cues/inspecteur dans le drawer existant (les chips y sont déjà).
8. **Node palette par tâche** : renommer catégories (Trajectories /
   Modifiers / Control / Output), ports plus gros avec labels, flèches
   directionnelles sur les edges, minimap contrastée.
9. **Radar auto-zoom** : cadrer sur le rayon max du champ (avec marge).

### Structurel (à décider, impact conception)

10. **NOW sémantique** : afficher le(s) slot(s) live quand aucune cue
    courante (« busking — OrbTest ») plutôt que vide.
11. **Slot→cue association** : permettre « cette cue inclut ces slots »
    visible dans les pads (numéro de cue sur le pad).
12. **Expert/Simple = 2 apps dans une** : envisager mode « patch »
    dédié (le graphe mérite sa surface plutôt qu'un toggle qui écrase
    le canvas).
