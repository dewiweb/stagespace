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
## État d'avancement (au commit e585ffb)

| Phase | État |
|---|---|
| **H1 — fondations** | ✅ fait — tokens target/derived/info, `uiColors.ts`, CLIP_COLORS par familles (v2 validée au swatch : objectCtl fuchsia, zones→indigo) |
| **H2 — surfaces live** | ✅ fait — StatusBar/PerformView/CuelistPanel migrés, convergé sur StatusChip/STATUS_TONES, arm unifié, sémaphores healthTone |
| **H3 — viz 3D/radar** | ✅ fait — `VIZ` étendu (env/obj/draw/labels), violet pose-ghost → `target` vérifié end-to-end, hex three.js centralisés |
| **H4 — ratissage + enforcement** | ⬜ à faire — chrome indigo (toggles), couleurs-décor SettingsModal, règle lint anti-palette brute hors allowlist |

Branche : `feat/color-harmonization`. Reprise : lire les décisions
H1/H2/H3 ci-dessous puis attaquer H4 — les points d'entrée sont les
toggles chrome indigo (pads/3d, radar), le SettingsModal, puis la
règle lint anti-palette (allowlist `uiColors`, même mécanique que
z-index).

### Décisions H3 actées (viz 3D/radar)

- **`VIZ` structuré en sous-groupes** — `env` (décor structurel : fond,
  lumières, grilles — centralisé sans être fonctionnel), `obj` (états
  émissifs : drag/preview/selected/hot/assignMember/off), `draw`
  (tracé utilisateur vs courbe fittée). Les valeurs préexistantes ont
  été reprises telles quelles : H3 ne re-tinte que ce que la doctrine
  exige.
- **Violet pose dissous** — pose-ghost patché : `#a78bfa` → `target`
  teal (vérifié end-to-end dans le radar : `#2dd4bf`). Non-patché :
  amber `#f59e0b` → `targetInvalid` orange warning (`#f97316` rendu,
  parité avec le badge ⚠ des panels). Labels : violet-300/amber-400 →
  `targetLabel`/`targetInvalidLabel`. Le violet « pose » était une
  couleur-entité — la cible d'une pose EST une destination, même
  vocabulaire que les ancres.
- **Flèche de lancer cyan → `target`** — une prédiction de destination
  est une visualisation de cible (doctrine), pas un message osc.
- **Identités track préservées** — `trackHue()` HSL procédural et
  `track.color` hol restent des exceptions légitimes (la couleur EST
  l'identité de l'objet, pas une fonction). Fallback neutre
  `VIZ.trackFallback` pour les tracks sans couleur.
- **Zones** — les duplications `0x22d3ee`/`0x8b5cf6` (useRenderLoop,
  ZoneVisualization, Radar2D) pointent toutes vers `zoneManual`/
  `zoneGraph` — une seule source.
- **Vérif** — capture radar (bridge réel + pose seedée) : patchés
  teal, non-patché orange, distinction nette. Tout hex du SVG radar
  provient d'un token. 612/612 vitest, tsc propre.

### Audit exhaustif H4 (4 passes par surface — live, score, atelier, chrome)

Mesures : ~874 classes chromatiques brutes dans 69 fichiers, 54 hex
hors modules légitimes (uiColors/sourceColors). Atelier et score :
zéro token consommé. Trois générations de couleurs coexistent :
chrome décoratif pré-tokens, couleurs fonctionnelles correctes non
migrées, couleurs-entités contraires à la doctrine.

**Bugs de lecture live (P0) — pas du cosmétique :**

1. LIVE audio en ROUGE vs vert partout ailleurs (`CustomNode.tsx:223`)
2. Cyan = 9 fonctions dont preview — la couleur-réseau pour l'état
   « rien ne sort sur le réseau » (cohérent cross-surface, mais
   collisionne osc/hold)
3. Park cyan (ParkedChip, ObjectInspectBar) vs amber canonique
   (radar/pads/sourceColors)
4. Warning déguisé en amber/yellow — partagé, orphelin, non-patché,
   stale-psn, dirty, toasts, `.rf-node-warning` — inversion complète
   amber/orange (l'orange sert à du non-warning : solo, hot-swap)
5. ConduiteView viole H2 — cue courante purple, DRY-RUN/TC emerald
   (banni en H2) — CuelistPanel migré, pas ConduiteView
6. Violet pose-entité persistant dans PosesPanel + ScorePoseEditor
   (H3 dissous dans viz, pas dans les panels)
7. Toggle booléen : 2 couleurs dans le même composant
   (`ParamInput:94` blue vs `:105` cyan)
8. Attention/freeze = 3 couleurs (amber GestureStrip / purple
   SlotTile / indigo sourceColors)
9. Modulation = 3 couleurs (cyan AudioModControls / amber NodeEditor
   + dot CustomNode / purple ModChips)
10. Omissions : orphelins seulement désaturés, delete/clear neutres
    — la doctrine exige warning/danger (Score)

**Arbitrages doctrinaux requis (bloquants pour la migration) :**

1. `park` == `conduite` hex-identique (#f59e0b) — une couleur = une
   fonction, à trancher. Même question pour manual==warning,
   hold==osc, move==live, psn==tracking (recouvrement voulu ?)
2. Contradiction interne du doc : `derived` couvre les projections
   MAIS « projection = teinte parent translucide » — blast radius
   concernés. Écrire la règle finale.
3. Preview → `derived` (recommandation unanime des 4 passes, migrer
   aussi `VIZ.obj.preview` en même temps) ou token dédié
4. Modulation → nouveau token ou famille `graphs` formalisée
5. Couleurs de catégories de nodes — l'audit recommande la
   SUPPRESSION pure (entité, statique, collisionne live/osc ;
   discriminants défaillants : Spline=PostProcess=cyan,
   Source=Plugin=yellow). Icônes/regroupement à la place.
6. Ports/edges triple contradiction (connectionRules ≠ index.css ≠
   légende palette) — tokens graphe ou retrait couleur
7. Chrome accent : `stagespace.accent` existe et est INUTILISÉ —
   indigo/blue/cyan/purple se partagent sélection/focus/CTA.
   Sélection = 4 conventions concurrentes (ring-white clips, cyan
   lanes, bleu segmented, indigo pads)
8. Solo : warning (tue les autres moves) vs objectControl-fuchsia
9. Setlist NOW/NEXT : 4 schémas concurrents — extension de `target` ?
10. TC chase : cyan (Score) vs live (Perform/Cuelist) — divergent
11. CUE GO vert vs table « conduite = cues GO » — écrire la règle
12. Stop-fade yellow : gradient de sévérité hors tokens → danger à
    opacités différenciées ?

**Bloqueurs structurels avant la règle lint :**

- `Slider.tsx` — ACCENTS expose la palette brute : le composant
  partagé institue la violation (15+ consommateurs)
- `index.css` — 25 hex overrides React Flow, pas tokenisables sans
  variables CSS `--stagespace-*` à créer
- `CHIP_SOLID` existe mais n'est consommé nulle part
- `SOURCE_CHIP` dupliqué par badges hardcodés (SlotTile P/H)
- 20 `focus:border-*` en 7 teintes (SettingsModal déjà migré accent)

**Séquençage proposé :** P0 sécurité live (~75 occ) → P1 arbitrages
+ architecture (~120) → P2 migrations mécaniques (~200) → P3 chrome/
décor (~450) → règle lint (sinon CI rouge massive).

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
### Décisions H2 actées (migration surfaces live)

- **Architecture convergée sur `StatusChip`** — le composant existait
  déjà avec le vocabulaire token+opacités ; `STATUS_TONES` exporté pour
  les chips interactifs. Le `CHIP` map intermédiaire de uiColors a été
  supprimé (duplication). uiColors ne garde que CHIP_SOLID et
  healthTone (sémaphore ok/dégradé/critique — un seul orange pour
  « dégradé », fini les yellow/amber/orange concurrents).
- **Arm/DRY-RUN unifié** — TROIS implémentations contradictoires du
  même contrôle (armed rouge/gris/inversé). Sémantique retenue :
  armed = danger-rouge (« sortie chaude », convention record-arm),
  dry-run = neutre pulsant (le vert pulsant lisait « tout va bien »
  alors que la sortie est muette — pire lecture possible). DryRunChip
  du cuelist supprimé au profit d'OscArmToggle.
- **teal réconcilié** — le SETLIST GO teal pré-existait, documenté et
  cross-surface (« jamais confondu avec le vert CUE GO »). Plutôt que
  le casser, unification sous `target` : teal = transition vers un
  état cible — spatial (poses/placement) ou scénique (avance setlist).
  PLAY indigo (arbitraire) → vert live : « rendre live ».
- **cuelist** — TRK badge cyan→tracking-purple (inversion corrigée) ;
  NOW/ARMED purple→conduite-amber (états opérationnels, pas expert) ;
  audition amber→derived (le token créé pour ça). Conservé purple pour
  l'édition experte (store, focus) — split documenté du token.
- **emerald éliminé des surfaces live** — réservé à rien, il était un
  quasi-green arbitraire (tc-active, chase) → live-green partout.
- **différé à H4** — chrome indigo des toggles (pads/3d, radar) :
  question app-wide de la couleur d'accent chrome, pas des surfaces
  live. Couleurs-décor de sections du SettingsModal.

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
