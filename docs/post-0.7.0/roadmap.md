# Roadmap post-0.7.0

Élaborée à partir de `owner-audit.md` (réflexions owner,
numérotées A1–A6 ci-dessous), du backlog technique reporté de 0.7.0 et
de l'analyse du code au 28 nov. 2026. Document vivant — chaque item
indique sa source, sa taille estimée (S/M/L/XL) et ses dépendances.

---

## A1 — Moteurs physiques avancés (inspiration Blender)

**Constat** : le chantier swarm a déjà produit de vraies sims — `swarm`
(boids Reynolds complets : wander, leader, virage incliné), `avoidance`
(répulsion 1/d² + rebonds), `spring`, `bouncing`, `pendulum` — avec le
pattern déterministe résolu (intégration incrémentale de fenêtre,
rewind déterministe au seek arrière). Toute sim future doit respecter
ce contrat : c'est la vraie frontière technique, pas la physique.

**Direction** : les *champs de force environnementaux* (vortex,
turbulence, attracteur, vent) — le concept Blender clé qui nous manque.
Le champ affecte ce qui entre dans sa zone, contrairement aux sims
fermées par objet. Parallèle exact avec les zones spatial FX existantes
(gain/spread) transposé au mouvement.

**Limite connue** : les plugins WASM sont stateless — les sims physiques
restent natives (ou extension ABI d'état, chantier séparé non requis
à court terme).

| # | Item | Taille | Notes |
|---|------|--------|-------|
| A1.1 | Design note « champs de force » : catalogue (vortex/turbulence/attracteur/vent), modèle environmental vs closed-sim, place dans le graphe, contrainte déterminisme | S | préalable à tout code — à écrire ensemble |
| A1.2 | Premier champ : attracteur/vortex ponctuel comme nœud composite du graphe | M | dépend A1.1 |
| A1.3 | Composabilité champ × trajectoire (somme vectorielle dans le graphe) | M | dépend A1.2 |

## A2 — Modulation de paramètres : le fossé UX, pas architectural

**Constat majeur** : la capacité existe déjà de bout en bout. Le domaine
signal (onglet Modulation de l'éditeur) — `SignalLfo → SignalMap →
SignalOut` — cible macros **et** `param:<NodeType>:<key>` de tout param
modulable du move édité. Le dropdown se peuple dynamiquement, les
params portent un flag `modulable` (spec ts-rs), les slots sont stables
à travers recompiles et relus live. Le LFO positionnel (x/y/z/all) que
l'audit mentionne est un *modificateur de position* sans rapport.

**Les deux scopes existent, câblés end-to-end** (vérifié au code,
28 nov.) : per-move (`update_signal_graph` avec `movement_id` — graphe
du move recompilé avec le signal, table de slots partagée, swap
atomique ; persisté dans le document de chaque slot) **et** global
(`movement_id` null — MergeRuntime, cibles macros uniquement, `param:`
rejeté à la compile par construction ; persisté dans la section
top-level du show + localStorage). Le chemin d'édition principal est
même per-move : l'onglet signal édite la modulation **du slot ouvert
dans l'éditeur**.

**Le vrai problème : découvrabilité — et invisibilité du modèle de
scope.** Le modèle mental attendu (Max/MSP : tirer un câble vers le
param) n'est pas celui d'un graphe séparé dans un onglet. Et le
scope lui-même est invisible : rien dans l'onglet n'indique si l'on
édite la modulation *de ce move* ou la modulation *globale* ; l'accès
au global est enfoui derrière le bouton « All » du drawer live
(`editingSlotId = null`) ; les ModChips ne distinguent pas l'origine
(macro globale vs param per-move). Conséquence : même un utilisateur
qui trouve l'onglet ne peut pas construire le bon modèle mental.
Corollaire technique : la confusion de scope a déjà produit un bug
de sérialisation — voir **B6**.

**À vérifier d'abord** (bloquant la suite) : l'owner teste l'onglet
Modulation existant et confirme/infirme qu'il fait le job fonctionnellement.

| # | Item | Taille | Notes |
|---|------|--------|-------|
| ~~A2.1~~ | ~~Validation owner~~ — **validé 28 nov.** : dropdown peuplé (preuve visuelle), persistence per-move OK, macros+params ciblables en per-move ; le fossé confirmé = invisibilité du scope (+ un bug trouvé et corrigé : B8) | — | fait |
| A2.2 | Clic-droit sur param modulable → « Modulate » créant un SignalOut pré-câblé | M | raccourci d'accès, pas nouveau moteur |
| A2.3 | Dot-modulation cliquable (navigue vers la modulation source) | S | |
| A2.4 | Section manuel + capture dédiée au domaine signal — y compris le **modèle de scope** per-move/global | S | |
| A2.5 | Limite by design à documenter : params structurels non modulables (compile-baked) | — | doc seulement |
| ~~A2.6~~ | ~~Badge de scope~~ — **traité** : sélecteur segmenté `Move: <slot> / Global` dans la barre de tabs de l'onglet Modulation, validé en live | ~~S~~ | lot 1, 29 nov. |
| ~~A2.7~~ | ~~Accès global~~ — **traité** : unifié avec A2.6, le sélecteur bascule `setContext` localement | ~~S~~ | lot 1 |
| ~~A2.8~~ | ~~ModChips~~ — **traité** : globales lues depuis la copie canonique (visibles en tout contexte) + chips per-move préfixées du slot pour les slots en lecture | ~~S~~ | lot 1 |
| ~~A2.9~~ | ~~Labeling + précision~~ — **traité** : fallback friendly (`signalTargetLabel` — type-wide affiché `All Circular · Radius`), saisie libre `editable` câblée sur tous les sliders de params | ~~S~~ | lot 1 |

## A3 — Toggles de visibilité multi-accès

Toggles `viewerTrajectories`/`viewerShowIdle` (menu View seul) → accès
au niveau des viewers, raccourcis, menus contextuels. Décision de
design prise à l'analyse : rester **global** (pas de granularité
par-viewer) sauf retour d'usage contraire.

| # | Item | Taille |
|---|------|--------|
| A3.1 | Icônes toggle overlay dans le radar et le viewer 3D (même famille que top/front/side) | S |
| A3.2 | Clic-droit sur canvas viewers → options de vue | S |
| A3.3 | Raccourcis clavier (`T`/`I` candidats — vérifier conflits live) | S |

## A4 — Infrastructure documentaire

Objectif : doc complète et structurée (exemples, cas d'usage), en ligne
**et** dans l'app, qui reste à jour avec l'app.

**Analyse des options** :

1. **Docs-as-code dans le repo (recommandé)** — markdown déjà versionné
   avec le code (la source unique existe déjà : `docs/user-manual.md`).
   Une seule source → pas de divergence.
2. **Rendu en ligne** : GitHub Pages + générateur statique. Candidats :
   - **mdBook** (Rust, léger, une commande) — bon fit culturel
   - **VitePress** (la toolchain front est déjà là, markdown+Vue)
   - Docusaurus — plus lourd, surdimensionné
   Déploiement CI automatique à chaque push sur main.
3. **Dans l'app** : le même markdown servi dans un panneau d'aide
   embarqué (l'app embarque déjà ses assets ; un viewer markdown léger
   suffit) — zéro duplication.
4. **Fraîcheur garantie par outillage, pas par discipline** :
   - captures d'écran **régénérables** (déjà fait : `scripts/capture-screenshots.mjs`)
   - lint CI : référence image cassée = fail
   - idéalement à terme : job CI qui détecte une capture visuellement
     divergente (pixel-diff) et ouvre une issue
   - le wiki reste la porte d'entrée communautaire, la doc structurée
     devient la référence canonique

| # | Item | Taille |
|---|------|--------|
| A4.1 | Choix du générateur (mdBook vs VitePress) + skeleton GitHub Pages déployé en CI | M |
| A4.2 | Restructuration du contenu existant en chapitres (manuel → livre) | M |
| A4.3 | Rédaction cas d'usage concrets (les 4 conduites A–D sont la matière) | M |
| A4.4 | Panneau d'aide in-app servant le même markdown | M |
| A4.5 | Lint CI des références d'images + doc de la recette captures | S |

## A5 — Transform per-move : la fiction de l'inspecteur

**Constat confirmé par le code** : l'audit a raison. Les sliders
« Transform » (scope annoncé per-move) et « Global transform » écrivent
dans **les mêmes stores** et poussent vers le même `pushMacrosToRuntime`
→ `set_global_macro` (`Inspector.tsx:130-146`). Au runtime, les macros
spatiales sont **globales** (MergeRuntime) — seul `speed` est per-move
(workers). La seule chose réellement per-move : les valeurs sont
stockées dans le document du move et **ré-appliquées au global au
lancement/GO** (modèle console « preset appliqué à l'activation » — le
dernier move lancé écrase).

**Deux voies, décision owner requise** :

1. **Assumer le global** (S) — supprimer la duplication d'UI : une seule
   section transform, clairement globale ; le stockage per-move devient
   explicite (« valeurs appliquées au lancement », déjà annoncé dans
   l'UI macros des slots). Honnête, cheap, mais perd l'ambition per-move.
2. **Vraie transform per-move** (XL) — pipeline de transform dans chaque
   worker avant le merge. Changement architectural profond (ordre des
   ops, interaction avec anchor/hold, modulation, merge multi-moves).
   Le vrai pouvoir (chaque move sa propre échelle/rotation live) mais
   le merge multi-moves devient sémantiquement épineux : que signifient
   deux moves avec des transforms contradictoires sur les mêmes objets ?

Recommandation : **voie 1 à court terme** (0.8.x), voie 2 seulement si
un cas d'usage concret la justifie — à re-discuter après usage réel.

**Résolution (28 nov.) — les deux scopes, clarifiés** : l'exploration a
révélé que l'architecture per-move existait déjà dans le backend (audit
T2 — `MacroScope`, `SpatialMacroInit`, `move_transform` worker en espace
local) mais que le chemin slot la désactivait (`spatial_macros: None`).
La voie 2 était donc M et non XL — retenue avec exigence UX de
clarification. Traitée en lot 2 :

| # | Item | Taille |
|---|------|--------|
| ~~A5.1~~ | ~~Unification UI transform~~ — **traité autrement** : vraie transform per-move câblée (seeding spawn, `set_move_macro`, hot-swap réel, cues capturant/restaurant la transform) + sections distinctes « Move transform » (ce move, pivot propre centre) / « Global transform » (toute la scène, pivot origin) dans l'Inspector | M |
| ~~A5.2~~ | ~~Documentation~~ — **traité** : modèle deux scopes documenté (README + AGENTS.md) — composition worker local → merge monde | S |

## A6 — Ergonomie des track IDs

Format actuel : string de nombres séparés par virgules (node Objects,
settings). Le CLI sait déjà parser `1-5` — la syntaxe range existe dans
l'outil CLI mais pas dans l'UI. La TrackGrid du picker de capture de
pose est un composant de sélection visuelle déjà disponible.

| # | Item | Taille |
|---|------|--------|
| ~~A6.1~~ | ~~Syntaxe ranges~~ — **traité** (lot 3, 28 nov.) : `utils/trackIds.ts` parse/format partagés (miroir du parseur CLI — ranges inclusives, mixité, ranges inversées acceptées, cap anti-typo), 12 tests. Le node Objects accepte `1-4, 7, 9-12` | ~~S~~ |
| ~~A6.2~~ | ~~Picker visuel~~ — **traité** : bouton grille dans le champ Linked Tracks du node Objects → modal TrackGrid (même composant que le picker de la table) | ~~M~~ |
| ~~A6.3~~ | ~~Affichage compact~~ — **traité** : format condensé partagé (`1-4, 7` au lieu de `1,2,3,4+3`) dans la table des moves ; SlotTile dédupliqué vers l'util | ~~S~~ |

---

## Backlog technique reporté de 0.7.0

| # | Item | Taille | Origine |
|---|------|--------|---------|
| ~~B1~~ Poseramp endpoint — **traité** : frame finale exacte à t=T avant la sortie du worker (+ fade-out clampé à 0), test de régression dédié | ~~M~~ | sessions 0.7.0 |
| B2 | Findings F1–F5 de la validation e2e 0.6.8 | ? | e2e-validation-0.6.8.md (dossier courant) |
| ~~B3~~ plugin-examples — **traité** : clés `ports` obsolètes retirées des 3 manifests, chemin packer lemniscate corrigé | ~~S~~ | audit 0.7.0 |
| ~~B4~~ Exemple enrichi — **traité** : 3 poses canoniques dans le .hfg, round-trip live vérifié, 10/10 tests gardiens | ~~S~~ | captures |
| B5 | Question sémantique du geste/axe `front` — contradiction gelée, à trancher | — | gelé en 0.6.x |
| ~~B8~~ Faux positif « missing required node signalout » — **traité** : le validateur exigeait SignalOut même sur graphe vide, alors que vide = « pas de modulation » (état par défaut, accepté comme reset à la compile). Tout utilisateur ouvrant l'onglet Modulation d'un move sans modulation voyait « 1 error ». Fix : exigence seulement si le graphe est non-vide + test de régression | ~~S~~ | validation owner A2.1, 28 nov. |
| B7 | **Console web/remote sans chargement de show** : File→Open utilise le dialog natif Tauri, inexistant dans un navigateur — or le dev-bridge sert explicitement l'opération à distance (`0.0.0.0:4173`). Fallback requis : saisie d'un chemin serveur (résolu côté backend, comme `/stagespace/show/load`) ou upload fichier→temp backend. Le flux doit aussi proposer « stop & load ? » au lieu du refus sec pendant la lecture (le garde est correct, le UX non), et vérifier la visibilité du toast de refus | M | session owner 28 nov. |
| B9 | **Resync d'état d'une page fraîchement connectée** : un browser qui se connecte au bridge après le chargement d'un show ne resynchronise pas les slots (état purement frontend, aucune réconciliation au boot) — cause des échecs de capture en série puppeteer. À caractériser : faut-il un bootstrap d'état backend→frontend ou documenter la limitation ? | M | chantier captures + session A2.1 |
| ~~B6~~ **traité** (29 nov.) : copie canonique `global` dans le store — `buildShowEnvelope` et le cue store la lisent au lieu du buffer d'édition. Bug cousin corrigé au passage : capture de cue en contexte slot (même corruption) + `resetToDefault` qui écrivait le localStorage global en contexte slot. 6 tests de régression | ~~S~~ | lot 1 |

---

## Phasage proposé

**0.7.x (patchs)** — ~~B1, B3, B4~~ **traités** (28 nov.) · ~~B8~~ faux positif validation signal **traité** (28 nov., session A2.1) — la voie est libre pour 0.8.0

**0.8.0 « ergonomie & vérité »** — le lot cohérent UX+doc, faisable sans
changement architectural :
- ~~A5.1+A5.2~~ transform (lot 2) · ~~A6.1+A6.2+A6.3~~ track IDs (lot 3) — **traités**, 28 nov.
- A3.1+A3.2+A3.3 toggles viewers
- A2.2+A2.3+A2.4 accès modulation (~~prérequis A2.1~~ **validé** le 28 nov. —
  le cœur fonctionne, le problème est l'invisibilité du scope)
- ~~A2.6-9~~ clarification scope — **traitée** (lot 1, 29 nov.)
- A4.1+A4.5 infra doc minimale (skeleton + lint)
- B2 si périmètre confirmé · ~~B6~~ **traité** (lot 1)
- B7 console web (fallback chargement + « stop & load ? ») · B9 resync état
  — les deux ensemble : même chantier « opération à distance »

**0.9.0 « documentation structurée »** — A4.2+A4.3+A4.4 : le livre
complet en ligne et in-app, cas d'usage.

**1.0.0 « champs de force »** — A1.1 (design note en amont, dès que du
temps de réflexion est disponible) puis A1.2+A1.3. Le jalon physique
majeur.

**Pistes de recherche parallèles** (sans engagement de release) :
contradiction `front` (B5), ABI plugins stateful (pré-requis éventuel
de physics-in-plugins), granularité par-viewer des prefs si l'usage
la réclame.

---

*Owner : compléter `owner_audit` au fil de l'eau — ce document sera
révisé à chaque nouvelle réflexion. Les items passent en plan détaillé
(doc dédiée) avant d'entrer en production, comme le veut l'usage du repo.*
