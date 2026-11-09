# Lot 2 — Panneaux de paramètres (audit complet)

Contexte : `App.tsx:233` — Inspector n'existe qu'en mode Atelier ;
`Scene3D.tsx:378` — MacrosPanel overlay canvas 3D ; `PerformView.tsx:940/984` —
NodeParamsPanel + AudioModList en drawers. **`MacroControls` n'est importé
NULLE PART en production** — dead code confirmé.

## 1. `components/Inspector.tsx` (680 lignes)

### Rôle
Panneau principal colonne droite (`App.tsx:485`). **God-panel à 3 sous-modes**
pilotés par `editingSlotId` (Global vs slot) et `showExpert` (Simple vs Expert).

### Structure
`Section` accordéon (10-28), `Inspector` (34-579), `InspectorSplineLibrary`
(584-680). Imports en milieu de fichier (30-32) — style inhabituel.

### Hiérarchie
```
Header (216-247) : nom + badge LIVE/PREVIEW
Zone scrollable (250-510) :
  [Global]  Moves · Macros 9 sliders SANS Speed · Audio
  [Expert]  Node params · Macros 10 sliders avec Speed
  [Simple]  Params = NodeParamsPanel + SplineLibrary · Perform duration/dir/loop/fades · Macros mixtes
  [Commun]  Audio · Tracks = TrackGrid + Spread + centroid
Footer fixe (513-576) : movements actifs + STOP + STOP ALL + PLAY/STOP + PANIC
```

### Interactions
`useMoveEditorStore` (current, updateCurrent, assignment, centroid, launchFlash)
+ `useGraphStore` (~25 sélecteurs). Pas d'IPC direct.

### Problèmes précis

| # | Problème | Lignes |
|---|---|---|
| P1 | **`performMode` dead code** — lu 36, utilisé 413/464, mais jamais monté en perform (App:233). `defaultOpen` toujours true, re-key jamais tiré | 36, 413, 464 |
| P2 | **`renderNodeParamInput` duplique `NodeParamField` en inférieur** : pas de Slider borné en Expert, accent blue vs cyan, **pas de schéma Plugin** (97 → "no parameters") | 97, 150-211 |
| P3 | **Double-write macros** : `handleUnified` écrit `current.*` ET `macros` global — les couches slot/global s'écrasent ; en mode Global, dead writes dans `current` | 109-140 |
| P4 | **`macroDebounce` partagé entre 3 actions** : pushMacros 100ms, updateGraphLive 150ms, save spline 150ms — un drag annule un hot-swap en attente → param jamais poussé | 104, 135-147, 402-403 |
| P5 | Section Macros Simple mélange `current.*` et `macros.*` sans distinction | 436-447 |
| P6 | Global : pas de slider Speed alors que `macros.speed` est global | 291-308 |
| P7 | Audio en mode Global édite `current.audio_mods` → dead write | 313-315 |
| P8 | Cibles <44px partout : headers ~32px, toggle 20px, boutons ~22px, Square size=10 | passim |
| P9 | `text-xs` ~100% du contenu | passim |
| P10 | Bilinguisme : "Sélectionnez un node" FR + sous-titre EN ; "Aucun slot" FR vs "No track available" EN | 261, 345-348, 490 |
| P11 | `updateCurrent({name, id: current.id})` — renvoie l'id à lui-même | 222 |
| P12 | Plages divergentes : shift ±5 ici vs ±3 MacroControls vs ±10 PerformView ; pitch ±90 vs ±180 | 293-298, 367, 443 |

**Verdict : god-panel 3 modes avec dead code, renderer params dupliqué
inférieur en Expert, sémantique macro slot/global qui s'écrase. Haute
priorité — surface d'édition principale.**

## 2. `components/NodeParamsPanel.tsx` (305 lignes)

### Rôle
Éditeur de params **partagé** : Inspector Simple (:386) + drawer Perform
(:940). Pattern "pin to Perform" documenté (9-22).

### Problèmes
- Chips `px-2 py-1` ≈24px ; pin toggle `Pin size=10` sans padding ≈10px ; `Pin size=8` (131).
- `text-[11px]` (138).
- `col-span-2` vec3/text déborde si conteneur <22rem (272, 290).
- `sameLabel` recalculé par chip O(n²) + `plugins.find` imbriqué (110-116).
- `live` ne change que la couleur du texte — affordance faible.
- Version "bonne" du renderer, **non utilisée en Expert** (voir P2 Inspector).

**Verdict : composant partagé propre et documenté ; hit targets minuscules +
vec3 fragile en grille étroite. Moyenne priorité.**

## 3. `components/MacroControls.tsx` (213 lignes) — DEAD CODE

**Non monté.** Aucun import en production (uniquement
`__tests__/MacroControls.test.tsx`, 24 références) — ancêtre supplanté par
Inspector/PerformView/MacrosPanel.

- Dead code **avec suite de tests complète** → fausse couverture.
- `pushMacrosToRuntime()` à chaque input sans throttle (22-25).
- `setLoopMode`/`setDirection` = global blast sur tous les movements.
- Plages divergentes : shift ±3, pitch ±180.
- État local `loopMode`/`direction` jamais resynchronisé depuis le store.

**Verdict : composant mort gardé en vie par ses tests. Priorité : suppression.**

## 4. `components/MacrosPanel.tsx` (87 lignes)

Overlay canvas 3D si `manipulateMode` (`Scene3D:378`). Titre "Manipulate",
8 sliders, Clear All Overrides (`clear_all_manual_positions`), Reset.

- **Mismatch nom/contenu** : "Manipulate" mais contenu = macros globales — le
  manipulate réel n'est qu'en texte d'aide.
- **3e couleur d'accent** : défaut `blue` (Slider:49). Inspector=purple,
  PerformView=orange, ici=blue.
- Plages divergentes : scale 0.1-4, shift ±5, speed 0-4 ; ±180 rotations.
- **8 sliders seulement** : `radius_scale`/`height_offset` absents vs Inspector (10).
- "Yaw°" + `unit="°"` — double unité.
- **3 stratégies de pacing** pour `set_global_macro` : throttleTrailing 40ms ici
  vs debounce 100ms Inspector/PerformView vs rien MacroControls.

**Verdict : 3e surface macros redondante, mal nommée, accents/plages
divergents, macros incomplètes. Moyenne — fusionner en `MacrosSurface`
partagé ou restreindre aux overrides 3D.**

## 5. `components/AudioModControls.tsx` (128 lignes)

Éditeur audio-mods du `current` : `AudioModAdder` + `AudioModList`. Monté 3×
(Inspector Global 314, commun 456, drawer Perform 984).

- **`spectrum_band` inaccessible** : type supporté + label "Band n" existent,
  mais le select n'offre que les 5 sources string — capacité morte en UI.
- Vocabulaire : "Offset X/Y/Z" (audio target) vs "Shift X/Y/Z" (sliders) —
  même donnée `offset_x`↔`shiftX`, deux noms.
- "Lissage" FR au milieu d'EN ; guillemets FR dans phrase EN.
- `base_value: 0` hardcodé — écrase la valeur de base sans l'exposer (66).
- `key={i}` index ; delete ~11px ; `smoothing` max 0.95 arbitraire.
- En mode Global : dead write (P7 Inspector).

**Verdict : vocabulaire divergent + source spectrum_band non créable en UI.
Moyenne-basse.**

## Chevauchements fonctionnels

### A. Les macros ont 4 surfaces actives + 1 morte

| Surface | Scope réel | Accent | Fichier |
|---|---|---|---|
| Inspector Simple "Macros" | mixte current+macros | purple | Inspector:436-447 |
| Inspector Expert "Macros" | macros global | purple | Inspector:353-376 |
| Inspector Global "Macros" | macros global (sans Speed) | purple | Inspector:289-310 |
| MacrosPanel "Manipulate" | macros global (8 sliders) | blue | MacrosPanel:43 |
| PerformView "Global" | macros global | orange | PerformView:828-848 |
| PerformView "Playback" | slot.macros | green/purple | PerformView:852-934 |
| ~~MacroControls~~ | mort | purple | MacroControls |

→ **3 couches sémantiques** (global merge / per-slot / brouillon current)
sous le même vocable "Macros", accents contradictoires.

### B. Duplication renderer params
`renderNodeParamInput` (Inspector 150-211) vs `NodeParamField` (207-303) :
même contrat, divergences (pas de Slider, accent, pas Plugin, pas pin).
→ Supprimer `renderNodeParamInput`, réutiliser `NodeParamsPanel` en Expert.

### C. Section
`Inspector.Section` (accordéon) vs `SpatialFxPanel.Section` (statique+count/clear)
— même nom, sémantiques différentes → `ui/Section.tsx` unifié.

### D. Vocabulaire incohérent
Shift vs Offset ; `one_shot` vs `oneshot` ; "→ Fwd/← Bwd/↔ Ping" vs
"forward/backward/pingpong" ; "Lissage" vs EN.

### E. Pacing IPC divergent `set_global_macro`
Debounce 100ms · throttleTrailing 40ms · aucun — à unifier dans
`pushMacrosToRuntime`.
