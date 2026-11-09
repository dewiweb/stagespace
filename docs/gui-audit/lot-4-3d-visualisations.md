# Lot 4 — 3D et visualisations (audit complet)

`tailwind.config.js:16-22` impose les tokens z-index (overlay:20, raised:30,
popover:50, menu:70, toast:9999) — `z-10` (Scene3D:418,490) et `z-50`
(PerformView:539) restent des violations.

## 1. `components/Scene3D.tsx` (505 lignes)

### Rôle + montage
Preview 3D central. **Monté 2×** (deux contextes WebGL) : `App.tsx:429` (Edit,
jamais démonté — `hidden` en focus) et `PerformView.tsx:530` (plein cadre).

### Les 7 overlays `absolute inset-0` — inventaire exact

| # | Couche | Lignes | z | Quand |
|---|---|---|---|---|
| 0a | `renderer.domElement` WebGL | useRenderLoop:157-162 | `'1'` inline | toujours |
| 0b | `labelRenderer.domElement` CSS2D | useRenderLoop:166-171 | auto, pointerEvents:none | toujours |
| 1 | `<canvas>` draw 2D | 416-429 | `z-10` ad hoc | toujours monté, events seulement drawMode |
| 2 | État vide "No move running" | 489-498 | `z-10`, pointer-events-none | conditions asymétriques |
| 3 | Zone-edit | 431-441 | `z-overlay` | zoneEditMode |
| 4 | Zone-place | 442-448 | `z-overlay` | zonePlaceMode |
| 5 | Assign | 449-455 | `z-overlay` | assignMode |
| 6 | Manipulate | 456-468 | `z-overlay` | manipulateMode |
| 7 | Fallback WebGL | 356-376 | `z-raised` | webglFailed |

Couches 3-6 mutuellement exclusives via `interactionModesSlice:42-58` → max
une couche interactive. + overlays non-plein-écran : banners `top-2 left-1/2`,
ModeButtons `bottom-2 left-2`, MacrosPanel `top-2 left-2`, DrawModeOverlay
deux coins, indicateur movements `bottom-2 right-2`, DebugPerfOverlay
`top-2 left-2 z-raised`.

### Problèmes précis
- **F1 — ModeButtons recouverts** : rendus ligne 400, couches `inset-0 z-overlay`
  431-468 — même z=20, plus tard dans le DOM → les couches interceptent les
  clics sur les boutons Manipulate/Assign visibles en bas-gauche. En mode
  actif, les boutons semblent cliquables mais sont morts — seule issue : Esc.
- **F2 — drawMode non exclusif côté entrée** : `setDrawMode` ne purge QUE
  drawMode ; `ModeButtons:57` fait `setDrawMode(true); setManipulateMode(false)`
  mais pas `setAssignMode(false)` ni zones → Draw + Assign actifs : la couche
  assign (z=20) couvre le canvas draw (z=10) → **dessin impossible**.
- **DebugPerfOverlay non exclusif** : z=30 `top-2 left-2` recouvre MacrosPanel
  et DrawModeOverlay Z (tous `top-2 left-2` z=20) → sliders inaccessibles.
- **État vide : conditions asymétriques** (489) — masqué pour manipulate/draw
  mais PAS pour assign/zonePlace/zoneEdit → coexiste avec un banner.
- `z-10` numérique (418, 490) — hors tokens.
- `(window as any).__debugPerf` global à l'import (13).
- **`sceneReady` fragile** (331-342) : effet à dep `[sceneReady]` seul — si
  `sceneRef.current` null après le `setTimeout(0)` unique, aucun re-check →
  `useObjects3D` ne crée jamais les meshes. Fonctionne par hasard.
- `nObjects` lit `getState()` dans useMemo (83) — non-réactif.
- Hardcodes : 800×600 init (40), `Math.max(rect,100)` (288), throttle 33ms
  (254), steps resize 0.25/0.05 (274-275), chips couleurs + emojis (476-482).

**Verdict : orchestrateur massif mais bien refactoré en hooks ; les 7 couches
cohabitent par l'exclusion mutuelle du slice — sauf drawMode non exclusif et
ModeButtons réellement recouverts (bug fonctionnel).**

## 2. `components/TrackGrid.tsx` (254 lignes)

### Rôle
Grille sélection/assignation tracks + depth. `Inspector:466-486` (×2, fallback
`manualOscIds` avec couleurs HSL reconstruites inline — duplication
`colorForIndex`) et `PerformView:954-972` (compact).

### Problèmes précis
- **S7 — Rafale IPC par pattern** (53-102) : `even/odd/half/all` font
  `deselectAllTracks()` puis N×`toggleTrackSelection` + N×`updateAssignment`
  = N×`updateLiveAnimation` IPC dans le même tick.
- **Slider depth non throttlé** (196-203) — IPC par tick de drag.
- **`inverse` ne touche pas les depths** (97-100) — incohérent avec les
  autres patterns qui forcent `depth:1.0`.
- **S9 — `colorForIndex` diverge** : HSL `i/total` index tableau (26-29) vs
  `track_index/nObjs` 3D — IDs non contigus → dot grille ≠ ligne 3D pour la
  même track.
- Labels `'1 of 2'` vs `'Odd'`, `'1st half'`/`'2nd half'` (34-42) ; `Σ=` jargon (138).
- `grid-cols-4`/`max-h-40` vs `auto-fill`/`max-h-44` — deux layouts (152-154).
- `compact` + depth = `col-span-2` — densité divisée sans indication (166).

**Verdict : utilitaire propre mais coûteux — rafales IPC non batchées, depth
non throttlée, couleur HSL divergente de la 3D pour la même track.**

## 3. `components/ZoneVisualization.tsx` (162 lignes)

Injecte les volumes zones (sphere/box + falloff) dans la scène Three —
`Scene3D:415` (rend null côté DOM).

- **S8 — Rebuild total à chaque changement** (113-147) : `zonesKey =
  JSON.stringify([zones, graphZones])` comme dep → toute édition (drag 30Hz
  via `updateZone`, Scene3D:254) détruit et recrée tous les meshes.
  `eslint-disable exhaustive-deps` (146). `JSON.stringify` dans le render body.
- Couleurs hex ad hoc `0x22d3ee`/`0x8b5cf6` (9-10) — hors thème.
- Permutation d'axes manuelle extents box (76-79) — asymétrique avec `toThree`.
- **Falloff box vs sphere incohérent** : sphere `radius+falloff`, box
  `falloff*2` par dimension — même param, sémantique différente.
- Zones disabled rendues en fantôme (34-49) — aucune option hide.

**Verdict : visualisation efficace mais rebuild-all à chaque delta y compris
pendant drag 30Hz — correct <10 zones, coûteux et fragile au-delà.**

## 4. `components/TrajectoryVisualization.tsx` (159 lignes)

Échantillonne le runtime et dessine les chemins `THREE.Line` — `Scene3D:407-413`.

- **F3 — Ghost lines** : `if (!(isPlaying || hasMovements) || …) return;`
  ligne 64 — **early-return sans nettoyer `pathLinesRef`** → au stop-all,
  les derniers chemins restent dans la scène indéfiniment. Le cleanup du
  return (136-142) n'annule que le timer.
- `animKey` = `JSON.stringify(graph_json)` à chaque render (50-59).
- Couleur `track_index/max(nObjs,1)` (109-111) — diverge de TrackGrid.
- `duration` devinée depuis un node "Duration", default 4.0 (85-86) —
  échantillonnage tronqué si durée différente.
- Invoke séquentiel par movement — N round-trips (92-121).
- Catch silencieux (118-129) — pas même `console.error`.
- Opacités hardcodées 0.2/0.35 — peu lisibles sur fond sombre.

**Verdict : sampling propre mais bug visible — les trajectoires ne sont
jamais effacées à l'arrêt du dernier move.**

## 5. `components/DrawModeOverlay.tsx` (50 lignes)

UI draw mode : slider Z + Done/Cancel (`top-2 left-2`), label (`top-2 right-2`).
`Scene3D:377` si drawMode.

- **Recouvert par DebugPerfOverlay** — même coin, z 20 vs 30.
- **Done non protégé** : si `finalizeDrawing` throw, `setDrawMode(false)`
  jamais atteint → utilisateur piégé (seule issue : Esc) (30).
- `drawZ` range `-3..3` hardcodé, Three Y-up vs backend Z-up — sémantique
  implicite (23).
- Palette orange ad hoc ; ligne 3D `0xff8800`/`0xffaa00` — 3e teinte.
- Deux overlays indépendants, pas de collision gérée.

**Verdict : petit overlay ciblé ; fragilités : coin partagé avec 2 autres
panneaux, Done non protégé, mode d'entrée incomplet (assign reste actif).**

## 6. `components/DebugPerfOverlay.tsx` (58 lignes)

HUD dev : fps render/IPC, stutter, timings. `Scene3D:500` si `debugPerfVisible`
(DEV-only). Lit le singleton mutable `debugPerf`, force re-render ~5Hz.

- **Collision de coin** : `top-2 left-2` z=30 → MacrosPanel + Draw Z masqués
  et incliquables.
- Seuils hardcodés (25/15/10/15) non configurables.
- **rAF tourne même quand `show===false`** — 5 renders/s pour rien.
- Lecture de mutable global hors React (documenté).

**Verdict : outil dev bien isolé ; défaut : squatte le coin haut-gauche au z
le plus haut.**

## Synthèse lot 4

| Problème | Fichiers |
|---|---|
| Couches couvrent ModeButtons | Scene3D:400 vs 431-468 |
| drawMode non exclusif | drawModeSlice:38, ModeButtons:57 |
| Ghost lines après stop-all | TrajectoryVisualization:64 |
| Collision coin haut-gauche ×3 | MacrosPanel:43, DrawMode:20, DebugPerf:29 |
| z numériques vs tokens | Scene3D:418,490 ; PerformView:539 |
| Couleur track divergente | TrackGrid:26 vs TrajectoryViz:109 |
| Rafales IPC non batchées | TrackGrid:53-102 |
| Rebuild-all stringify deps | ZoneVisualization:113-147 |
| Globals window | Scene3D:13, useRenderLoop:525 |

Recommandations : (1) remonter ModeButtons/banners après les couches
d'interaction ou z-raised + pointer-events propres ; (2) `setDrawMode` setter
exclusif ; (3) cleanup lignes avant early-return ; (4) fonction couleur track
unifiée ; (5) batcher patterns TrackGrid en un `updateLiveAnimation`.
