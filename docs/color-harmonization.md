# Harmonisation des couleurs — design doc

> **Statut : validé-en-principe, pré-implémentation.** Chantier H1-H4.
> Le principe directeur est DÉJÀ tranché dans le code — il s'agit de
> l'appliquer, pas de l'inventer : `tailwind.config.js` documente les
> tokens de rôle avec la doctrine « **la couleur code la fonction, pas
> le goût** ». L'adoption mesurée : **34 usages de tokens contre 932
> occurrences de palette brute** — la migration a été amorcée (tokens
> surface + z-index, tous deux adoptés pour z-index) puis abandonnée
> pour les couleurs.

## 1. État des lieux (mesuré, pas opinions)

### Les 5 systèmes concurrents

| Système | Fichier | État |
|---|---|---|
| Tokens de rôle (thème) | `tailwind.config.js` — live/conduite/osc/warning/danger/tracking/dim | ✅ doctrine correcte, ❌ adoption 34/966 |
| Source-de-contrôle | `utils/sourceColors.ts` — move/manual/park/hold/psn/freeze × variants hex/text/chip | ✅ le modèle à suivre — module unique, rôles sémantiques, adoption complète dans son domaine |
| Types de clips (score) | `components/score/scoreUtils.ts` — `CLIP_COLORS`, 24 types | ⚠️ organisé mais auto-référencé : collisions internes, aucun lien avec les tokens |
| Identités entités | éparpillé — pose=violet (`poseGhosts.ts`, panel, radar), zones graph=violet / manuel=cyan (`useRenderLoop`) | ❌ pas de module, couleur-entité contraire à la doctrine |
| Tracks (identité persistante) | procédural `setHSL(objIdx/N, .7, .55)` ou `.hol` | ✅ exception légitime — voir §2 |

Plus le bruit de fond : **932 occurrences de classes palette brute**
(`amber-400`, `red-600`…) et **25 hex hardcodés uniques** dans
components/hooks/utils. L'audit gui-v2 avait mesuré ~112 occurrences
dans les 6 fichiers live sans traiter : StatusBar 52, SettingsModal 54,
PerformView 30, CuelistPanel 29 (re-mesuré).

### Les collisions actives — même couleur, sens multiples

| Couleur | Sens coexistants aujourd'hui |
|---|---|
| **amber/orange** | clip cue · source park · warning non-patché · dirty « modifié » · blast radius cue · badges warning (6 sens — dont certains incompatibles : park ≠ danger, cue ≠ warning) |
| **violet/purple** (95 occ., 33 fichiers) | source psn · zones graph · ghosts pose · clip chanMods · clip slot · sélection morph |
| **teal** | clip `positions` · clip `pose` — collision **dans la même surface**, les deux côte à côte sur CONDUCTOR |
| **cyan** | source hold · zones manuelles · clip park · accents osc |

Et la collision inverse (un sens, deux couleurs) : pose = violet en
3D/radar, teal dans le score — corrigée dans le score en faveur du type
parent, mais la divergence inter-surfaces demeure par construction.

### Ce que la lecture de show exige

Les running sheets (A-D) fixent le critère de vérité : en exploitation,
l'opérateur lit **qui pilote quoi** (source-de-contrôle), **ce qui est
armé/dangereux** (conduite/danger), **ce qui est cassé** (warning) —
à distance, en un coup d'œil. Toute couleur qui ne sert pas l'une de
ces lectures est du bruit. C'est ça, « code la fonction ».

## 2. Doctrine

> **La couleur encode la fonction, jamais l'entité ni le goût.**

1. **Une fonction = une couleur, une couleur = une fonction** — dans
   chaque surface, et idéalement à travers les surfaces. Une couleur
   partagée entre deux fonctions est un bug de lecture, au même titre
   qu'une variable partagée entre deux rôles.
2. **Exception identité — les tracks uniquement** : la couleur d'une
   track (.hol ou procédurale) est un **nom visuel persistant**, pas
   une fonction. Elle ne collide pas avec les couleurs de fonction
   parce qu'elle ne code rien d'autre qu'elle-même. Toute autre
   « couleur d'entité » (pose violet, etc.) est dissoute : soit elle
   devient une fonction, soit elle disparaît.
3. **La hiérarchie de lecture prime sur la beauté** : danger >
   conduite/armé > source-de-contrôle > structurel. Une même fonction
   peut varier d'intensité selon l'emphase (clip plein / projection
   translucide / texte) — c'est la même couleur, pas une autre.
4. **Les tokens sont la seule source** — aucune classe palette brute
   (`amber-400`…) ni hex brut dans les composants. Tolérance zéro
   enforcement par lint (H4), comme pour z-index (déjà acquis).

### Fonctions identifiées (inventaire exhaustif des usages)

| Token (existant ou à créer) | Fonction |
|---|---|
| `live` ✅ | playing/armé/GO — vert |
| `conduite` ✅ | cues NOW/NEXT/armed, GO — amber |
| `osc` ✅ | liens réseau OSC in/out, learn — cyan |
| `warning` ✅ | orphelin, partagé, non-patché, dirty — orange |
| `danger` ✅ | panic, delete, stop-structurel — rouge |
| `tracking` ✅ | cues tracking, psn — violet |
| `dim` ✅ | secondaire/inerte — gris |
| `control.*` ✅ (module sourceColors) | qui pilote l'objet — 7 rôles |
| **`target`** 🆕 | visualisation de destination — ghosts pose, ancre, prédiction. Distinct de `tracking` (violet=qui pilote) et de `live` : proposition teal/cyan-fondu — à trancher au swatch en H1 |
| **`derived`** 🆕 | états dérivés/projetés non-actionnables (blast radius, projections, audition) — toujours translucides, jamais pleins |

## 3. Architecture cible

```
tailwind.config.js tokens  ←  primitives de rôle (bg/text/border auto)
utils/sourceColors.ts      ←  domaine contrôle (existant, référence)
utils/uiColors.ts    🆕    ←  pont sémantique pour les domaines hors
                              thème : score.clipType, viz (3D/radar),
                              variants hex pour three.js/SVG/canvas
```

Trois règles de câblage :

1. **Composants DOM** → classes tokens thème (`text-stagespace-warning`).
2. **Canvas/SVG/three.js** → hex exportés de `uiColors` (une seule
   définition par rôle, dérivée des mêmes valeurs que le thème — la
   duplication hex est centralisée là, pas dispersée).
3. **Score** — les 24 types de clips ne peuvent pas avoir 24 hues
   distinctes : regroupement par **famille fonctionnelle**, teinte de
   famille + intensité de sous-type. Mapping proposé :

   | Famille | Types | Couleur |
   |---|---|---|
   | conduite | cue, cueArm, cueGo | `conduite` (déjà amber — convergent) |
   | danger | panic, stopAll | `danger` |
   | positions/déplacements | pose, positions, throw, gesture | `target` — pose et positions partagent la famille « placer des objets dans l'espace » : la collision teal actuelle devient une **cohérence** |
   | contrôle objets | park, unpark, manualClear, attention, solo, unsolo | control-adjacent (cyan/mint à fixer au swatch) |
   | graphes/modulation | modGraph, postGraph, chanMods, zones | indigo/sky (déjà proche) |
   | système | osc, soundcheck, view | `osc` / `dim` |
   | slots | slot | hors-famille — le contenu : violet profond (neutre) |

   Les projections (blast radius) = couleur du type parent, translucide
   — déjà acquis pour pose/cue, à généraliser comme règle écrite.

## 4. Plan phasé

| Phase | Contenu | Vérif |
|---|---|---|
### Décisions H1 actées (swatch review)

- **objectCtl = fuchsia, pas emerald** — la première passe (emerald)
  échouait au swatch : l'axe vert-cyan concentrait trois familles
  (teal/emerald/cyan) dans ~35° de hue, indiscernables à taille de
  clip. Fuchsia libère l'axe et ne collisionne que modérément avec
  le purple des slots (magenta vs violet-bleu — tranché par les
  labels, slots omniprésents donc vite appris).
- **zones réintégrées dans graphs (indigo-400)** — la rupture fuchsia
  n'avait pas de justification fonctionnelle : un clip zones EST une
  opération de pipeline. C'est ce qui libère fuchsia pour objectCtl.
- **green/emerald réservés** — green = token `live` cross-surface,
  interdit aux familles de clips pour ne pas créer de faux sens
  (« ce clip est en train de jouer »).
- Point faible accepté : `view` cyan-900 vs teal à petite taille —
  system et placement coexistent rarement ; labels obligatoires.

| **H1 — fondations** | tokens `target`/`derived` + module `uiColors.ts` · re-teintage CLIP_COLORS par familles · correction des collisions actives du score (positions/pose) · swatch review visuelle avec l'utilisateur | capture score avant/après, collisions teal résolues |
| **H2 — fichiers live ad-hoc** | migration StatusBar (52), SettingsModal (54), PerformView (30), CuelistPanel (29), RunView — les surfaces d'exploitation d'abord | compteur palette brute ÷2 dans ces fichiers, captures de non-régression |
| **H3 — viz** | unification 3D/radar/ghosts/zones dans `uiColors` — hex three.js centralisés, dissolution des couleurs-entités (pose violet → `target`) | captures 3D/radar, ghosts toujours distincts des rest-ghosts |
| **H4 — ratissage + enforcement** | migration du reste · règle lint interdisant classes palette brute et hex hors `uiColors` (allowlist) — même mécanique que z-index | 0 occurrence brute hors allowlist en CI |

### Explicitement hors scope

- Thème clair / personnalisation utilisateur — le système de tokens le
  permettra mais ce n'est pas l'objet.
- Refonte des surfaces elles-mêmes (densité Jeu, NOW sémantique…) —
  chantier UX séparé déjà documenté dans `ux-audit.md`.

## 5. Points de décision ouverts

1. **Teinte de `target`** — teal est le sortant presque-acquis
   (positions/pose y sont déjà) mais teal≈cyan=`osc` : risque de
   collision inter-surfaces. Alternative : conserver teal en admettant
   que la famille osc (liens réseau) ne coexiste jamais visuellement
   avec les cibles spatiales ? À trancher au swatch H1.
2. **Couleurs de tracks procédurales** — `HSL(objIdx/N)` arc-en-ciel
   positionnel vs palette discrète distincte-maximum : hors scope
   strict (identité) mais à noter en H3.
3. **Le violet pose en 3D disparaît-il vraiment ?** — doctrine dit oui
   (→ `target`, partagé avec toute visualisation de destination). Le
   perdant est la distinction pose-vs-autres-cibles, mais il n'existe
   pas d'autres cibles visualisées aujourd'hui : la généralisation ne
   coûte rien.
