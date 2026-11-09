# Lot 3 — Listes et cues (audit complet)

Mesure confirmée : `PerformView.tsx:459` colonne `w-72` = 288px ; `:523` `h-56`
= 224px fixes → header ~30px + store-row ~34px → **~160px de liste utile ≈ 4
cues visibles**. En Edit, les tabs Moves/Cues/FX sont mutuellement exclusifs.

## 1. `components/MovesTable.tsx` (617 lignes)

### Rôle + montage
Table des **move slots** (template + tracks + macros). Tab `moves` (defaultTab)
de `TabPanel` (`App.tsx:186,272-286`). **Absente de PerformView** — qui
réimplémente `renderSlotRow` (~486) : **deux implémentations divergentes**.

### Structure
- Header (162-175) : badge "MV" w-6, titre `text-sm`, compteurs `text-xs`.
- Toolbar (178-206) : `+ Move`, `▶ GO All`, `■ Stop All` — `px-2 py-1 text-xs` ≈26px.
- Barre GO setlist (209-243) : position n/N, bouton `GO ▶` `text-sm font-bold`
  vert — l'élément dominant.
- Table (257-486) : 6 colonnes # / Nom / Template / Tracks / Set / Actions.
- Modales : track picker grille 6 (491-537), macros 9 sliders (540-595),
  ConfirmModal delete (598-614).

### Interactions
`useGraphStore` ~28 sélecteurs granulaires (24-52, commentaire anti-60fps) ;
click `#`/nom = `selectSlotForEditing` ; dbl-clic nom = rename inline ;
`useModalGuardOn` (127) bloque les raccourcis live pendant rename ;
`contestedBySlot` (74-95) warning `⚠ shared` tracks partagées.

### Problèmes précis
- **7 boutons icône dans une cellule w-20** (420-479) : preview, fade-stop,
  stop, play, edit, hot-swap, macros, delete — cibles ~16px, fade-stop (438)
  vs stop (443) distingués seulement par `fill` + couleur — cryptique en live.
- Glyphes incohérents : `▲` texte vs `<ChevronDown size={11}>` vs `<X>` vs `<Star>`.
- Toutes les cibles <44px sauf `GO ▶` (~36px).
- Bilinguisme : "Changer de template"/"Descendre" FR vs "Add to the show setlist"/"Immediate stop" EN.
- Vocabulaire : Move/slot/template/setlist vs Library/animations — le même
  graphe = template, animation, preset, move.
- Delete → ConfirmModal ✓ mais ✕ adjacent aux boutons play dans 80px —
  risque misclick.

**Verdict : fonctionnellement complet et défensif, mais densité extrême —
7 micro-actions ~16px par ligne, glyphes incohérents, duplication avec les
rows PerformView = bombe de divergence.**

## 2. `components/CuelistPanel.tsx` (466 lignes)

### Rôle + montage
Liste de **cues** (snapshot : graphes + macros + moves actifs + positions ;
recall = kill-all + respawn). Deux montages : `App.tsx:187` (tab) +
`PerformView.tsx:523-524` (**confiné h-56/w-72**, `w-96` touch).

### Structure
- Header (113-138) : "Cues" + `TcStatus` (DryRunChip, chase toggle, readout
  TC, select fps — tout `text-[10px]`, 423) + `◀` / compteur / `RECALL ▶`.
- Store row (141-166) : input nom, fade `w-14`, `★ Store` violet.
- Rows (180-334) : index, nom + **micro-badges `text-[9px]`** : `TRK` (204),
  `w{s}` (207), `f{s}!` (209-224 rouge si orphelin), `TC` (226), countdown
  (229). Row armée → form : fade `w-12`, select mode `text-[10px]` (271),
  **8 checkboxes `w-2.5 h-2.5` label `text-[8px]`** (452-462), inputs
  pre_wait/follow/TC `w-10`/`w-12`. Delete `<X size={11}>` (332).
- `PendingCountdown` (365), `DryRunChip` (381), `TcStatus` (396), `ScopeEditor` (446).

### Interactions
`useCuelistStore` + 3 stores graphe pour snapshot. Arm+dbl-click = recall ;
`isRecalling` disable flèches ; inputs `updateCue` **à chaque keystroke**
(249-289) — IPC spam. `DryRunChip` optimiste `armed=true` puis fetch — faux
"ARM" au mount possible.

### Problèmes précis
- **F4 — Asymétrie de protection** : rows exigent arm+dbl-click, mais les
  boutons header `◀`/`RECALL ▶` appellent `goToPreviousCue`/`goToNextCue` →
  `recallCue` **en un click ~20px** (119-137). La règle arm-first n'est pas
  appliquée aux boutons header.
- `text-[8px]` (ScopeEditor) — sous le seuil de lisibilité ; `text-[9px]` ×5.
- Badges jargon crypté sans légende ; `!` rouge follow-orphelin subtil (222).
- Delete ✕ 11px adjacent à la zone de recall — commentaire l.26-27 l'admet.
- Delete cue → ConfirmModal ✓. Recall pas de confirm (design), protégé par
  arm+dbl-click sur rows mais **pas sur boutons header**. `RecallGuard`
  backend empêche recalls concurrents.

**Verdict : composant le plus critique du show (chaque action modifie ou tue
la scène), le plus confiné (4 cues visibles, exclusif en Edit) et le plus
dense en micro-typo (8-10px) ; incohérence dbl-click row vs single-click
header = trou de sécurité live.**

## 3. `components/AnimationList.tsx` (240 lignes)

### Rôle
Navigateur de **presets** : templates built-in (`SHAPE_PRESETS`), graphe en
cours, bibliothèque utilisateur localStorage. `App.tsx:301` section 2 "Templates".

### Problèmes précis
- **`deleteAnimation` : aucune confirmation, aucun undo** — `filter` +
  `saveAnimationsToStorage` immédiat (store:321-325) ; bouton `opacity-0`
  hover-only (222) → **le pire destructif des 5 fichiers**.
- **Load animation écrase le graphe du slot sans confirmation** (click simple, 191).
- **Pas de `modalGuard` sur rename** — raccourcis live actifs pendant rename
  (Space peut stopper un move pendant qu'on tape) — contraire à MovesTable.
- Doublon de label : App "Templates" + AnimationList "Templates" (94).
- `animIcon` heuristique hardcodée 27 strings → `◆` fallback fréquent (9-25).
- Chevrons `▸`/`▾` texte vs lucide dans App — glyph set incohérent.
- `getSelectedOscIds` fallback 8 objets silencieux (68).
- Hint footer FR/EN dans la même phrase (230-236).

**Verdict : browser de presets propre mais maillon faible destructif — delete
sans confirmation ni undo sur bouton hover-only, load écrasant sans confirm.**

## 4. `components/TabPanel.tsx` (47 lignes)

Conteneur d'onglets générique, `App.tsx:283`, tabs Moves/Cues/FX.

- **`key={activeTab}` force un remount complet** à chaque switch : `MovesTable`
  re-`refreshMovements()`, `armedCueId`/`editingTracksFor` et tout l'état local
  **perdus** ; `TcStatus` recrée son interval (41).
- **Exclusion mutuelle structurelle** : Moves et Cues jamais visibles ensemble
  — un outil où le recall tue les moves, préparé à l'aveugle.
- Zéro ARIA : pas de `role="tablist"`, `aria-selected`, navigation clavier.
- `defaultTab` non réactif (15).

**Verdict : tab bar visuellement propre mais remount destructif d'état +
impossibilité de co-voir Moves/Cues — choix de layout coûteux pour du live.**

## 5. `components/SpatialFxPanel.tsx` (583 lignes)

### Rôle
Éditeur effets spatiaux : zones (sphere/box → canaux par région), modulations
cinématiques, canaux statiques, effets graphe (read-only). Tab `fx`.

### Structure
Constantes classes (17-21 : `inputCls`/`selectCls` ≈30px, `removeBtnCls`
rouge-hover) ; `Section` générique + `clear all` (23-49) ; zones form 6
champs + `⌖ Place`/`⌖` re-place/`✎ Edit on scene` (227-388) ; modulations
(391-488) ; object channels (491-541) ; graph effects read-only (544-580).

### Problèmes précis
- **15+ inputs texte `font-mono`** dans 256px : saisir `x,y,z` à la main =
  mode principal ; `⌖ Place` ne couvre que le centre ; aucun slider/stepper.
- **`clear all` ×3 sections : aucun ConfirmModal** (227, 391, 494) — lien gris
  `text-xs` efface instantanément en live. Idem `X` par item — zéro garde,
  alors que moves/cues ont des ConfirmModals.
- **`removeBtnCls` rouge-hover pour `⌖` re-place** — action non destructive
  qui devient rouge : affordance trompeuse (378-381).
- **`zonePlaceMode`/`zoneEditMode` persistent quand le tab est démonté** —
  mode armé invisible.
- Graph-effects read-only visuellement quasi identiques aux éditables (551 vs 365).
- `pendingZonePoint`/`zonePlaceTarget`/`zoneEditMode` = état global couplé Scene3D.

**Verdict : le plus long et le plus dense en formulaires — ~15 inputs mono
30px dans 256px, destructive `clear all`/`X` sans aucune confirmation (pire
coverage des 5), état de placement qui survit au démontage.**

## Cross-cutting lot 3

| Aspect | MovesTable | CuelistPanel | AnimationList | SpatialFx |
|---|---|---|---|---|
| Row idiom | `<table>` cells | div 2 lignes | div 1 ligne | cards |
| Delete confirm | ✓ | ✓ | ✗ rien | ✗ rien (+clear all) |
| Plus petit texte | 11px | **8px** | 12px | 12px |
| Actions/row max | **7 icônes ~16px** | 1 + form | 1 hover | 2 |

- Vocabulaire incohérent : Move/slot/template/setlist · cue/recall/arm ·
  animation/library · zone/modulation/channel.
- Tailles : tout `text-xs`, badges 8-9px, icônes 9-11px, aucune cible ≥44px
  hors `GO ▶`.
- Couleurs : indigo=moves, purple=cues, cyan=preview/FX, green=live,
  red=stop/delete, orange=hot-swap — sémantique mais ad hoc.
- FR/EN mélangé partout.
- Duplication : slots MovesTable vs `renderSlotRow` PerformView (474-484).

## Recommandations
1. Unifier protection destructive : ConfirmModal/undo pour `deleteAnimation`,
   `removeZone/Modulation/Channel`, les 3 `clear all`.
2. CuelistPanel : arm-first sur boutons header, sortir du `h-56` fixe,
   co-visibilité Moves+Cues en Edit.
3. Densité : actions MovesTable en menu overflow ou ≥24px, distinguer les 2 stops.
4. TabPanel : ne pas re-key (garder monté avec `hidden`) + ARIA.
5. Glyph set lucide unifié, vocabulaire unique, langue unique, `ListRow`/`RowActions`/`Badge` partagés, éliminer `text-[8px]`/`[9px]` en live.
