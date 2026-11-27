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

## J. Corrections — contexte de capture vs production (ajout post-revue)

Les captures initiales ont été prises en mode **headless dev bridge +
vite dev** (pas l'app Tauri de production). Réévaluation honnête des
findings à travers cette lentille :

### Ce qui change en production desktop

En app Tauri desktop, webview et backend partagent la durée de vie du
process — un refresh isolé de la webview n'arrive quasiment jamais
(crash webview uniquement). La « fracture reload » (section D) n'est
donc **pas un scénario desktop quotidien**.

### Ce qui reste vrai en production — le cas Remote UI

**Remote UI est une feature de production** (Settings → Réseau →
Remote UI, persistée) : des navigateurs distants pilotent le même show
vivant. Or un navigateur distant se rafraîchit volontiers en plein show
(onglet fermé, tablette rechargée, reconnexion réseau) — et là la
fracture est réelle et complète : slots restaurés avec `movementId:
null`, orphelins backend, « Aucun slot » affiché pendant que le
spectacle tourne. U1 (re-attach) reste donc justifié — re-scopé :
**scénario remote-UI + recovery crash webview**, pas desktop nominal.

### Artefact de test identifié — « Aucun slot »

Dans le script de capture, les pages puppeteer étaient ouvertes AVANT
la création du slot — or le store zustand n'hydrate depuis localStorage
qu'au démarrage. Les pages jeu/conduite, chargées avant que le slot
existe, ne pouvaient pas le voir quoi qu'il arrive. Le constat « les
slots n'ont même pas réapparu » (D point 3) est donc **non concluant** —
ni preuve de bug, ni preuve de fiabilité. U8 (vérifier le flush) reste
ouvert mais sans présomption.

### Ce qui est invariant plateforme (findings non affectés)

Tout ce qui relève du layout/composants React purs : espace mort
conduite, pile de toasts recouvrant la télémétrie, legend park/freeze,
accès soundcheck absent, nommage « Score » trompeur, menu View sans
Score, unsolo invisible, densité 9-10px. Le frontend est le même code
en webview et en navigateur — ces findings tiennent en production.

## K. Enrichissement — inventaires exhaustifs croisés (validation/corrections)

Inventaires code-vérifiés des 4 surfaces croisés avec l'exploration
directe. Corrections d'abord, puis les findings nouveaux majeurs.

### K0. Corrections à l'audit initial

- **Unsolo n'est PAS invisible** — un bouton `UNSOLO` conditionnel existe
  dans la gesture strip jeu (`PerformView.tsx:331-339`) quand
  `soloRestoreCount > 0`, et le bouton `S` du pad actif bascule en unsolo.
  Le vrai problème est ailleurs : le commentaire MenuBar promet solo/unsolo
  dans le menu Show jeu mais les entrées n'y sont **pas** (`MenuBar.tsx:169-187`
  vs commentaire `:32-38`) — promesse de menu non tenue.
- **Les rows de CuelistPanel montrent plus que je ne le créditais** :
  badges TRK / w(pre-wait) / f(follow) / TC + compte de moves + fade.
  Le constat « entrées minimales » ne vaut que pour **ConduiteView**,
  la console — pas pour CuelistPanel.

### K1. FRAGMENTATION DE L'ARM — finding architectural majeur

Deux modèles d'arm coexistent sans se parler :
- `ConduiteView` et `CuelistPanel` arment en **state React local** ;
- `/stagespace/cue/arm`, `/cue/go` et le menu Show utilisent
  `useCuelistStore.armedCueId` (store global).

Conséquences mesurées : armer une cue en Conduite n'affecte ni le menu
CUE GO ni l'OSC ; une cue armée par OSC n'apparaît pas armée dans la
liste Conduite ni dans son NEXT ; fenêtres interne/détachée ont des
armes indépendantes ; `Shift+Enter` ignore l'arme locale et tire la
suivante séquentielle. **Le concept console « arm puis GO » est cassé
en morceaux selon le chemin de contrôle** — c'est le plus gros défaut
de cohérence live de l'app.

### K2. Fenêtre conduite détachée — trous de sécurité

- Pas de chemin retour LIVE→DRY-RUN : le bouton n'apparaît que disarmed ;
  pas de StatusBar ni menu dans la fenêtre détachée.
- Pas de raccourcis clavier (useLiveShortcuts non monté) — Esc panic
  inopérant au clavier dans la fenêtre FOH.
- État muet avant le premier broadcast (500ms) : « Waiting for main
  window… ».
- Les commandes wire `tcchase/tcfps/cuego/prev` sont routées côté main
  mais **aucun contrôle ne les émet** dans la page détachée — capacités
  latentes mortes.

### K3. Features sans aucun chemin UI — précisions factuelles

- **trackpos** : `doSetTrackPosition` n'est appelé que depuis
  `useShowControl` (OSC). Zéro UI. `clearHol` n'a **aucun caller UI**.
- **pos-tape** : aucune route OSC non plus — entièrement atelier-only,
  prisonnier de l'onglet mal nommé.
- **soundcheck** : confirmé absent de tout UI direct (jeu, menus,
  atelier) — seuls les clips score et l'OSC le déclenchent.
- **OSC-IN mappings** : éditables UNIQUEMENT dans le drawer jeu — or
  c'est de la donnée de préparation (persistée .hfg, capturable en cue)
  sans aucun accès atelier.

### K4. Contradictions internes jeu

- **Le jeu n'est pas la surface réduite annoncée** : la palette d'outils
  3D expose Assign et Draw en fenêtre principale — de l'édition de move
  et du spline studio en pleine surface live. Doctrine vs réalité à
  trancher (feature ou fuite ?).
- **Slider spatial menteur** : state React local initialisé à 1, ne
  reflète jamais les changements OSC externes.
- **Gestes à deux forces** : strip = 3.0, menu Show = 1.0, défaut OSC
  = 3.0 — même nom, deux puissances.

### K5. Strings stales (documentation interne de l'UI)

- `TrackGrid.tsx:160`, `useMoveEditorStore.ts:481`, `WelcomeModal.tsx:79`
  parlent d'une **Toolbar qui n'existe plus**.
- `ShortcutsModal.tsx:51` parle de la **« MANUAL bar »** remplacée par
  les chips OVERRIDE/PARKED.
- Empty state Conduite : « créez-en dans l'atelier » alors que jeu
  (★ Store) **et score** (★ cue dans ScoreTransport) créent des cues —
  trois sources, un hint qui n'en nomme qu'une.

### K6. Log opérationnel — trois défauts

- Le TC roulant inonde l'historique (pas de filtrage/coalescence).
- `logAction` saute le logging quand `from` est truthy — or la conduite
  passe `'conduite'` : **les actions conduite ne sont pas loguées**.
- Pas d'auto-scroll ; commentaire « 8 lignes » vs slice(30) réel.

### K7. Détails conduite confirmés

- Rows = numéro+nom uniquement ; fade/mode/scope/timing absents.
- Pas d'audition (confirmé) — elle vit dans CuelistPanel.
- TC display-only, conditionnel au chase ; chase toggle absent de la
  surface (menu Show uniquement) et totalement absent du détaché.
- Countdown pre-wait/follow potentiellement non-tickant en fenêtre
  interne (calcul au render, pas d'interval).
- `PosesPanel` vit dans `components/conduite/` mais n'est monté **ni en
  conduite ni dans la fenêtre détachée** — ironie de placement ; le
  commentaire LiveDrawer (« contrairement à la conduite, aveugle »)
  prouve que l'équipe le sait.

### K8. Numérotation objet — risque de confusion opérateur

Les menus objet affichent `obj + 1` (obj_index+1) alors que la doctrine
opérateur est en track_id. Pour des tracks 1-based identiques ça
coincide, mais dès qu'un mapping custom existe, « obj 3 » du menu et
`/stagespace/position 3` ne désignent plus la même chose que « T3 »
du TrackGrid. Audit de cohérence nécessaire avant d'ajouter des contrôles.

### K9. Score surface — création de cues

`★ cue` dans ScoreTransport snapshotte l'arrangement au curseur → cue
Full/fade 0.5/osc_mappings:false. La création de cues a donc TROIS
sources (atelier, jeu, score) aux sémantiques par défaut différentes —
à documenter/unifier.

### K10. Export — inventaire complet (partage/show)

`.hfg` (interchange complet) · pos-tape `.sstape.json` (seul download
browser du codebase) · clipboard JSON de chaînes de nodes (cross-machine)
· Remote UI (sans auth — averti) · media sync out vers régies. Pas
d'export PNG/vidéo/log — non nécessaire mais à acter comme choix.

### K11. Recommandations ajoutées

| # | Chantier | Impact | Effort |
|---|---|---|---|
| U9 | **Unifier l'arm dans le store** — local arm = store arm, broadcast au détaché ; tous les chemins (clavier/menu/OSC/UI) tirent la même cue | critique live | moyen |
| U10 | **Fenêtre détachée sûre** — chemin disarm, Esc panic clavier, contrôles TC | fort live | moyen |
| U11 | **Trackpos UI** — éditeur d'origines (TrackGrid menu ? Settings Show ?) ; clearHol à exposer ou supprimer | moyen | moyen |
| U12 | **Mapper les strings stales** — Toolbar/MANUAL bar/hint conduite | faible | trivial |
| U13 | **Trancher jeu-édition** — Assign/Draw en jeu : feature assumée (documenter) ou à verrouiller | doctrine | faible |
| U14 | **Log opérationnel** — filtrer TC, loguer les actions GUI quelle que soit `from`, auto-scroll | moyen | faible |
| U15 | **Slider spatial** — binder au state backend réel | faible | faible |
| U16 | **Gestes uniformes** — une seule force (3.0) ou exposer le paramètre | faible | trivial |
| U17 | **OSC-IN en atelier** — dupliquer le panel mappings dans un onglet panneau (donnée de préparation) | moyen | faible |

## L. Delta de version — périmètre exact de validité (ajout post-vérification)

L'audit a été mené sur `feat/swarm-leader-rules` à `f83d4f3`. Cette branche
est entièrement mergée dans `main` (`47defc2`) mais main porte 8 commits
supplémentaires (0.6.6 → 0.6.7). Impact mesuré fichier par fichier :

**Périmé (détails d'inventaire uniquement) :**
- Picker tracks MovesTable — désormais réutilise TrackGrid (`2fb39c9`) :
  l'inventaire « modal custom » est obsolète, et cette unification va
  dans le sens des recommandations de cohérence de cet audit.
- Playback drawer jeu — inclut désormais duration éditable, libre au-delà
  de 30s, avec le nouveau mode Slider `editable` clic-pour-saisir
  (`dc48eaf`). L'inventaire du scope Playback est à relire avec duration.
- `Slider.tsx` a gagné un pattern d'interaction (valeur cliquable) qui
  post-date l'audit.

**Intact (vérifié par diff de fichiers) :** aucun des 8 commits ne touche
ConduiteView, useCuelistStore, le soundcheck, la pos-tape, le trackpos,
les menus objet, le radar ou les mappings OSC-IN. Les 17 recommandations
U1-U17 sont donc toutes encore valides à l'état 0.6.7.

**Règle pour la suite :** le travail UX repart de `main` — plus jamais
d'audit sur branche mergée.

## M. Suivi d'implémentation

| Chantier | Statut | Commit |
|---|---|---|
| U9 unification arm | **fait** (feat/ux-finitions) — store unique, ConduiteView props-driven, broadcast détaché, arm consumée au recall/désarmée au delete ; 620/620 verts | `U9 — unification de l'arm de cue` |
| U10 fenêtre détachée sûre | **fait** — bouton LIVE/DRY-RUN symétrique dans les deux états, chip TC cliquable (toggle chase — le routing tcchase: dormait sans émetteur), Esc/Enter/Shift+Enter/Backspace montés dans ConduitePage | en cours de vérif |

| U1 re-attach orphelins | **fait** — reattachOrphanMovements (slots coquilles, movementId repris) + chip orphelin cliquable dans la top bar jeu ; graphJson null honnete, transport retrouve | ce commit |
| U2 foyer répétition + soundcheck | **partiel** — tab panneau Score renommé Rec (collision de nommage résolue), soundcheck accessible dans les menus Show jeu+conduite (avant : zéro accès direct) ; bouton FOH avec état reste à faire (state machine module-privée à sortir en store) | ce commit |
| U3 conduite habitée | **fait** — audition extraite en CueAuditionRadar partagé + rendue au centre de la conduite (interne et détachée via broadcast), rows enrichies (méta TRK/fade/pre-wait/follow/TC sans interaction), hint corrigé (jeu Store) | ce commit |
| U5 menu View+Score / unsolo | **fait** — Score ajouté au menu View (titlebar-only avant), unsolo dans le menu Show jeu (promis par le commentaire, absent) | batch |
| U12 strings stales | **fait** — Toolbar inexistante (TrackGrid, useMoveEditorStore), MANUAL bar (ShortcutsModal) corrigés | batch |
| U6 legend radar | **fait** — freeze hollow (ring) vs park plein, points radar ET légende cohérents | batch |
| U11 trackpos UI | **fait** — « Set origin here » dans le menu objet (radar/3D/TrackGrid) : capture la position actuelle comme origine de track (où panic/revert ramènent) ; avant : OSC ou import .hol uniquement | ce commit |
| U4 toasts | **fait** — ancre bottom-16 (au-dessus statusbar + légende radar), dédup ×N des rafales identiques, cap 3 visibles + « +N more » | ce commit |
| U15 slider spatial menteur | **fait** — k tracké dans useSpatialKStore au niveau de doSpatial (couvre menu/OSC/strip), slider bindé | batch |
| U16 gestes à deux forces | **fait** — menu aligné sur 3.0 (strip + défaut OSC) | batch |
| U14 log opérationnel | **fait** — (1) bug de suppression corrigé : seule la provenance réseau « osc: » est couverte par le broadcast backend, les actions GUI taguées (menu/conduite) sont enfin loguées ; (2) dedup par préfixe de commande avec badge ×N — le TC roulant n'inonde plus ; (3) auto-scroll conditionnel (seulement si déjà près du bas) | ce commit |
| U2 complétion soundcheck | **fait** — état exposé (useSoundcheckStore), menu start/stop état-dépendant, next/prev grisés hors sonde | ce commit |
