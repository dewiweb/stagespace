# Audit UX/UI profond — features × usage × ergonomie (2026-11)

> Croisement de l'inventaire complet des fonctionnalités avec les
> workflows opérateur réels et l'accessibilité UI. Complète
> `gui-ergonomics-audit.md` (tactile/layout) et `gui-refonte-v2.md`
> (structure). Méthode : code lu directement (shell, surfaces, panels,
> menus, stores) + captures vides/live des 4 surfaces + manuel utilisateur
> (partiellement stale — section surfaces pré-refonte).
>
> Cadre : le logiciel a grandi par accrétion organique — les features ont
> atterri où c'était commode au moment de leur écriture. Cet audit mappe
> les écarts domaine↔placement, les fractures de workflow et les écarts
> promesse↔réalité, puis priorise.

## A. Synthèse exécutive

L'app est **structurellement saine dans son squelette** (refonte v2 R0-R2
tenue : SafetyBar globale, jeu = un instrument, conduite opérable) mais
souffre de trois maux distincts :

1. **L'accrétion organique** : les features arrivées après la refonte ont
   été logées au plus proche, pas au plus juste — le domaine « répétition »
   est éclaté, la sonde soundcheck n'a pas de foyer, l'audition de cue
   n'est pas sur la surface où elle sert.
2. **La fracture reload** : les slots persistent mais leur `movementId`
   est nullé — tout refresh de page transforme le spectacle en cours en
   « orphelins » sans chemin de reprise propre. La promesse de persistance
   du manuel est techniquement tenue, fonctionnellement trompeuse.
3. **L'espace mal habité** : plusieurs surfaces gaspillent leur zone
   centrale (conduite vide, score vide, jeu sans slots) pendant que
   l'information dense se tasse dans des chips de 9-10px et des piles de
   toasts qui recouvrent la télémétrie.

## B. Accrétion organique — la carte des écarts domaine↔placement

| Feature | Domaine réel | Placement actuel | Écart |
|---|---|---|---|
| Recorder busking→clips + pos-tape 30Hz (rec/play/export/import) | répétition | onglet « Score » du panneau atelier | **double collision** : l'onglet s'appelle Score sans être le séquenceur ; la répétition n'a pas de foyer — introuvable sans documentation |
| Soundcheck (sonde cyclique) | prépa salle / soundcheck | uniquement comme clip du picker Score | pas d'accès direct — or la sonde sert AVANT le spectacle, jamais dans une partition ; un opérateur en soundcheck ne devrait pas ouvrir le séquenceur |
| Audition de cue (mini-radar) | conduite | CuelistPanel atelier uniquement | absente de la surface Conduite — la seule où l'opérateur en a besoin live |
| Log opérationnel | live/conduite | onglet Log atelier + strip 8 lignes conduite | dispersé, deux implémentations partielles |
| Mappings OSC-IN + LEARN | setup ET exploitation live | onglet du drawer jeu (fermé par défaut) | enterré — l'apprentissage d'un fader externe est un geste de soundcheck, le réglage live un geste de jeu ; ni l'un ni l'autre n'est à portée |
| Poses (morph/capture) | composition ET jeu | panneau atelier (+ conduite) | dupliqué partiellement — deux contextes, même composant |
| Copy/paste position objet | exploitation live | menu objet contextuel ✓ + menu Edit | correctement placé côté objet ; l'entrée Edit est un bonus — PAS un problème |
| Unsolo | busking | menu Show contextuel jeu + conduite | correct mais invisible — aucun bouton/hint sur les pads après un solo |

## C. Les fractures de workflow — le cycle de vie d'un spectacle

### C1. Setup salle (avant composition)
Tâches : import .hol, config OSC, origines (trackpos), zones, merge.
- trackpos = origines objets — visible en radar (fantômes) ; pas de
  surface « salle » dédiée : la préparation spatiale est dispersée entre
  Settings, radar et le .hol importé.
- Zones déclarées dans le graphe Global FX mais éditées dans SpatialFxPanel
  (onglet FX atelier) — le lien zone↔node Zone est invisible.

### C2. Composition (atelier)
Surface la plus aboutie. Frictions résiduelles :
- Le drag template→slot n'a pas d'affordance visuelle (workflow textuel
  dans l'empty state).
- « Global — no move » : le panneau transform global est visible même sans
  move — le label prête à confusion (il agit sur le merge, toujours actif).
- L'onglet « Score » du panneau n'est pas le séquenceur (cf. B) — piège
  de nommage pour quiconque cherche la partition.

### C3. Soundcheck / répétition — LE maillon faible
- La sonde cyclique (identification spatiale des enceintes) n'a **aucun
  accès UI direct** — ni bouton jeu, ni conduite, ni atelier. Seuls les
  clips score et l'OSC `/stagespace/soundcheck` la déclenchent. Or c'est
  LE geste de soundcheck par excellence.
- Le recorder busking→clips et la pos-tape vivent dans l'onglet « Score »
  du panneau atelier — nommage trompeur, domaine « répétition » sans foyer.
- La pos-tape export (.sstape.json) — la relecture est aveugle : rien ne
  visualise la bande dans radar/3D.

### C4. Jeu (busking) — solide, défauts localisés
- Pads permanents + radar + gestes + sources = instrument complet (R2 tenu).
- Scene3D reste monté en hidden — bonne ingénierie (WebGL préservé).
- Slots vidés au reload (cf. D) — la surface affiche « Aucun slot » avec un
  move backend qui tourne : dissonance maximale pour l'opérateur.
- LIVE (rouge, arm OSC) et PANIC (rouge) adjacents dans la top bar —
  deux rouges de nature différente côte à côte ; leurs tailles diffèrent
  mais la proximité reste un risque de confusion au stress.
- Unsolo invisible après un solo (cf. B).
- Legend radar : park et freeze = même pink (doctrine stase voulue) mais
  listés comme deux entrées indiscernables — la légende semble cassée.

### C5. Conduite — opérable mais inhabitée
- R1 tenu : cue list (arm/dblclick), NOW/NEXT, transport, log.
- **~60% d'espace vertical mort** au centre — l'audition de la cue armée
  (mini-radar + scope + contenu) devrait habiter cet espace ; elle est
  restée dans l'atelier.
- Hint stale : « créez-en dans l'atelier » — les cues se stockent aussi
  depuis jeu (★ Store, feature 0.6.5).
- Entrées de cue minimales — fade/mode/scope invisibles sans interaction.
- SETLIST GO (target teal) et CUE GO (live green) coexistent — la
  distinction est doctrinalement correcte mais subtile au stress.

### C6. Score — le plus jeune, le plus creux
- Entry points faibles : `+cue` transport et bibliothèque discrets.
- Lane labels 9px — lisibilité limite en régie.
- Colonne gauche haute gaspillée en instructions redondantes.
- Les clips soundcheck y vivent — mais la sonde n'est pas un contenu de
  partition, c'est une action (cf. C3).

## D. La fracture reload — analyse détaillée

Constat code : `persistenceSlice` restaure les slots avec
`movementId: null` — correct en soi (l'id backend ne survit pas au
restart). Mais le backend continue de faire tourner les
moves. Résultat observé en capture : jeu affiche « Aucun slot » + toast
« 1 orphan move(s) running without a slot — use STOP ALL to clear ».

Trois problèmes distincts :
1. **Dissonance** : l'opérateur voit « aucun slot » pendant que le spectacle
   tourne — le pire message possible en live.
2. **Pas de chemin de reprise** : impossible de ré-adopter un orphelin dans
   un slot — seul STOP ALL est proposé. Un « re-attach » (créer un slot
   coquille autour du movementId) serait le geste juste.
3. **Persistance intermittente** : dans le test, les slots n'ont même pas
   réapparu — à vérifier si le flush localStorage est fiable (debounce,
   timing de fermeture). Bug potentiel au-delà de l'UX.

## E. Promesse ↔ réalité (hérité de la refonte v2, toujours ouvert)

| Promesse UI | Réalité mesurée | Statut |
|---|---|---|
| Audition cue = « à quoi ressemble la cue » | montre positions de repos, pas le mouvement — les trajectoires de la cue sont invisibles | ouvert |
| Unsolo « restore » | restaure la capture du solo — les slots joués PENDANT le solo ne sont pas repris | ouvert |
| Pad « playing » | movementId persiste pendant le fade-out et même si le spawn a échoué | ouvert |
| « emitted » | = dernier envoyé, pas confirmé par le renderer (UDP) — le titre LIVE le dit honnêtement mais l'attente utilisateur reste « reçu » | mitigé (label honnête) |

## F. Chrome transversal

- **Pile de toasts** : 3+ toasts empilés bas-droite recouvrent la légende
  radar (jeu), la statusbar et les lanes score — la télémétrie critique
  devient illisible exactement quand il y a le plus à signaler.
- **Menu View sans Score** — navigation incohérente.
- **Menu Show contextuel invisible** — aucune affordance du caractère
  contextuel ; la découverte est accidentelle.
- **Textes 9-10px** généralisés — limite lecture à un bras (confirmé).
- **Manuel stale** sur l'organisation des surfaces — la doc utilisateur ne
  reflète plus l'outil (section 2 pré-refonte).

## G. Recommandations priorisées

| # | Chantier | Impact | Effort |
|---|---|---|---|
| U1 | **Re-attach des orphelins** — bouton sur le toast/chip orphelin : crée un slot coquille autour du movementId backend | critique live | moyen |
| U2 | **Foyer répétition** — renommer l'onglet « Score » panneau en « Rec » ou déplacer recorder/tape vers surface SCORE ou onglet « Répétition » ; sonde soundcheck = bouton direct (jeu/conduite) | fort | faible-moyen |
| U3 | **Conduite habitée** — audition de la cue armée au centre (mini-radar + scope + contenu) ; hint corrigé (jeu Store) ; entrées cue avec fade/mode visibles | fort | moyen |
| U4 | **Toasts** — zone dédiée ne recouvrant ni legend radar ni statusbar (décalage ou dock) ; dédup des toasts répétés | moyen | faible |
| U5 | **Menu View + Score** ; unsolo visible post-solo (chip/bouton sur pads) | moyen | faible |
| U6 | **Legend radar** — freeze en hollow/dashed vs park plein (même hue, shape distincte) | faible | faible |
| U7 | **Reprise pos-tape visualisée** — replay montre les positions dans radar/3D | moyen | moyen |
| U8 | Vérifier la fiabilité du flush slots→localStorage (reload test) | inconnu | faible |

## H. Ce qui est SOLIDE (ne pas casser)

- StatusBar = console de sécurité exemplaire (R0) — arm master, RECALL,
  PARKED, overrides, PSN, perf — présente partout.
- Menu objet contextuel radar/3D synchronisé (release/park/attention/copy).
- Jeu = un instrument complet (R2) — pads/radar/gestes/sources.
- Doctrine couleur appliquée — lecture fonctionnelle cohérente post-H4.
- Transport morphing PLAY/STOP (le bouton dit ce qu'il fera).
- Confirmations sur actions destructives ; recall guards nack/busy.
- Télémétrie niveau console pro (fps, osc/s, merge µs, lock).

## I. Matrice de couverture UI — la table OSC comme inventaire produit

Chaque commande `/stagespace/*` est une feature produit de première classe
(sinon elle n'existerait pas au wire). Lecture croisée : quelles features
ont un chemin UI découvrable ?

| Commande OSC | Chemin UI direct | Couverture |
|---|---|---|
| go / cue next/prev/recall/arm/go | menus, shortcuts, pads conduite | complète |
| panic / stop | statusbar, menus | complète |
| timecode chase | menu Show, transport score | complète |
| macro speed/scale/rotate/translate/radius/height | sliders transform (atelier+jeu drawer) | complète |
| arm/disarm (LIVE/DRY-RUN) | chip statusbar master | complète |
| park/unpark | menu objet, chip statusbar | complète |
| slot play/stop/solo | pads jeu | complète |
| unsolo | menu Show seulement | **partielle — invisible** |
| position/clear (manual) | radar grab, menu objet | complète |
| trackpos (origines) | fantômes radar ; édition ? | **partielle** |
| pose capture/snap/goto | PosesPanel | complète |
| throw (grab & throw) | radar drag-and-release | complète (découvrabilité faible) |
| spatial k | strip jeu | complète |
| attention | menu objet + strip jeu | complète |
| gesture explode/converge/orbit/front | strip jeu | complète |
| rehearsal record/stop/play/clear | onglet « Score » panneau atelier | **partielle — mal logée** |
| soundcheck start/stop/next/prev | clips score + OSC seulement | **ABSENTE de l'UI directe** |
| show/load | menu File | complète |
| view atelier/conduite/jeu | onglets titlebar (+score absent du menu View) | quasi |
| positions/pos/state dump | — | debug, ok |

**Verdict : 3 features de première classe sans chemin UI direct ou mal
logées** — soundcheck (absente), rehearsal/pos-tape (mal logée),
unsolo (invisible). Ce sont exactement les écarts d'accrétion organique
de la section B, confirmés par l'inventaire wire.
