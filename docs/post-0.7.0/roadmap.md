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
| A2.1 | Validation owner du domaine signal existant | — | prérequis, aucune prod |
| A2.2 | Clic-droit sur param modulable → « Modulate » créant un SignalOut pré-câblé | M | raccourci d'accès, pas nouveau moteur |
| A2.3 | Dot-modulation cliquable (navigue vers la modulation source) | S | |
| A2.4 | Section manuel + capture dédiée au domaine signal — y compris le **modèle de scope** per-move/global | S | |
| A2.5 | Limite by design à documenter : params structurels non modulables (compile-baked) | — | doc seulement |
| A2.6 | Badge de scope dans l'onglet signal : « modulation de ce move » vs « modulation globale » explicite en permanence | S | clarification UX |
| A2.7 | Accès explicite à la modulation globale (aujourd'hui enfoui derrière « All » du drawer live) — entrée dédiée, p.ex. dans l'inspecteur global ou le menu | S | clarification UX |
| A2.8 | ModChips distinguent l'origine : macro globale vs `param:` per-move | S | clarification UX |

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

| # | Item | Taille |
|---|------|--------|
| A5.1 | Unification UI transform (voie 1) + libellés honnêtes | M |
| A5.2 | Documentation du modèle (stocké per-move, appliqué global) | S |

## A6 — Ergonomie des track IDs

Format actuel : string de nombres séparés par virgules (node Objects,
settings). Le CLI sait déjà parser `1-5` — la syntaxe range existe dans
l'outil CLI mais pas dans l'UI. La TrackGrid du picker de capture de
pose est un composant de sélection visuelle déjà disponible.

| # | Item | Taille |
|---|------|--------|
| A6.1 | Syntaxe ranges dans l'input (`1-4, 7, 9-12`) — parseur partagé avec le CLI | S |
| A6.2 | Picker visuel TrackGrid dans le node Objects (popup ou inline) | M |
| A6.3 | Affichage compact/chips lisible des ids dans les pads et listes | S |

---

## Backlog technique reporté de 0.7.0

| # | Item | Taille | Origine |
|---|------|--------|---------|
| ~~B1~~ Poseramp endpoint — **traité** : frame finale exacte à t=T avant la sortie du worker (+ fade-out clampé à 0), test de régression dédié | ~~M~~ | sessions 0.7.0 |
| B2 | Findings F1–F5 de la validation e2e 0.6.8 | ? | e2e-validation-0.6.8.md (dossier courant) |
| ~~B3~~ plugin-examples — **traité** : clés `ports` obsolètes retirées des 3 manifests, chemin packer lemniscate corrigé | ~~S~~ | audit 0.7.0 |
| ~~B4~~ Exemple enrichi — **traité** : 3 poses canoniques dans le .hfg, round-trip live vérifié, 10/10 tests gardiens | ~~S~~ | captures |
| B5 | Question sémantique du geste/axe `front` — contradiction gelée, à trancher | — | gelé en 0.6.x |
| B6 | **Bug de sérialisation du signal graph global** : `buildShowEnvelope` écrit le *buffer d'édition courant* du signal store dans la section globale du show, quel que soit le contexte — un Ctrl+S pendant l'édition d'une modulation de slot écrit le graphe per-move (cibles `param:`) dans la section globale ; au reload il échoue à compiler (scope global sans nodes) et le vrai graphe global est perdu du fichier. Fix : sérialiser depuis la source canonique (localStorage global) ou flusher/rebasculer le contexte avant sauvegarde. La copie per-move dans les slots est saine (écrite en continu). | S | analyse scope A2, 28 nov. |

---

## Phasage proposé

**0.7.x (patchs)** — ~~B1, B3, B4~~ **traités** (28 nov.) — la voie est libre pour 0.8.0

**0.8.0 « ergonomie & vérité »** — le lot cohérent UX+doc, faisable sans
changement architectural :
- A5.1+A5.2 transform honnête · A6.1+A6.2+A6.3 track IDs
- A3.1+A3.2+A3.3 toggles viewers
- A2.2+A2.3+A2.4 accès modulation (après validation A2.1)
- A2.6+A2.7+A2.8 clarification du scope modulation per-move/global
- A4.1+A4.5 infra doc minimale (skeleton + lint)
- B2 si périmètre confirmé · B6 (fix sérialisation signal — petit,
  pourrait aussi passer en patch 0.7.x si on veut le sortir vite)

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
