# Plan de refactor GUI — basé sur l'audit complet (7 lots)

Chaque action référence les bugs **F1-F16** et structurels **S1-S14** de
`docs/gui-audit.md` + le détail ligne par ligne des annexes `gui-audit/lot-*.md`.

Principe : **fonctionnel avant cosmétique** — un reskin sur des bugs de
sortie de mode ou de recall ne vaut rien. Le métier est sain ; on ne touche
ni `moveSlotsSlice`/`useCuelistStore`/`liveActions` dans leur sémantique,
ni le backend (sauf F9 : event `osc-armed-changed`).

---

## P0 — Sécurité live (bugs fonctionnels)

*Critère : aucune action destructive sans garde cohérente, aucun mode sans
sortie visible, aucun état contradictoire à l'écran.*

| # | Action | Fichiers | Bugs |
|---|---|---|---|
| P0.1 | **Overlays 3D ne couvrent plus les ModeButtons** : rendre les boutons et banners **après** les couches `inset-0` dans le JSX de Scene3D (ou `z-raised` + `pointer-events-auto`) | `Scene3D.tsx`, `ModeButtons.tsx` | F1 |
| P0.2 | **`setDrawMode` exclusif** : purge assign/zonePlace/zoneEdit comme les autres setters du slice | `interactionModesSlice.ts` (ou `drawModeSlice.ts:38`), `ModeButtons.tsx:57` | F2 |
| P0.3 | **Sortie de draw visible** : `ModeButtons` ne retourne plus `null` en drawMode — affiche "Exit Draw" ; banner manipulate ajoute "Esc to cancel" | `ModeButtons.tsx:33,66-70` | F15 |
| P0.4 | **Cleanup trajectoires** : déplacer la purge `pathLinesRef` **avant** l'early-return | `TrajectoryVisualization.tsx:64` | F3 |
| P0.5 | **Dispatch unifié** : `goToNextCue`/`goToPreviousCue`/`goToNextMove` absorbe les guards dans les stores (`cancelPendingTimers` + `isRecalling` check) **ou** tous les boutons passent par `liveActions` — une seule voie, pas deux | `useCuelistStore.ts`, `moveSlotsSlice.ts`, `PerformView.tsx:111/648/661`, `CuelistPanel.tsx:120/131/193`, `liveActions.ts:87` (`doSlotStop` + `recallBusy`) | F4, F5 |
| P0.6 | **RECALL header garde-arm** : les `◀`/`RECALL ▶` passent par le dispatch unifié (P0.5) — l'arm-first reste sur les rows, les boutons header héritent du guard recall | `CuelistPanel.tsx:119-137` | F4 |
| P0.7 | **État OSC arm unique** : event backend `osc-armed-changed` émis par `set_osc_armed` + `doArm` ; `OscArmToggle`/`DryRunChip` écoutent l'event au lieu de lire au mount ; **fusionner les deux composants** (DryRunChip = variante chip du toggle) | `commands/osc.rs:239`, `OscArmToggle.tsx`, `CuelistPanel.tsx:382-393`, `useGraphStore` listener | F9, F16 |
| P0.8 | **Un timer par action** : `macroDebounce` devient 3 refs (pushMacros / updateGraphLive / saveSpline) | `Inspector.tsx:104,135-147,402-403` | F6 |
| P0.9 | **ARM dans StatusBar** : indicateur LIVE/DRY-RUN permanent (à côté du dot) ; block merge/lock µs derrière `debugPerfVisible` | `StatusBar.tsx:51-85` | F16 |

**Livrable P0** : sortie de mode toujours possible, recall protégé partout,
état arm visible et cohérent partout. ~1 commit par ligne.

---

## P1 — Tokens de rôle + primitives déployées

*Critère : zéro couleur ad hoc dans les 5 fichiers top-couleurs ; les
primitives ui/ sont les seuls moyens de faire un bouton/slider/empty.*

### P1.1 — Tokens de rôle (`tailwind.config.js`)
```js
stagespace: {
  bg, panel, border,               // existants
  accent,                          // #3b82f6 existant = primary unique (IconButton passe à blue, plus indigo)
  live:    '#22c55e',  // playing, GO, armed
  conduite:'#f59e0b',  // cues, NOW/NEXT, pending (amber)
  osc:     '#22d3ee',  // OSC in/out, console link (cyan)
  warning: '#f97316',  // shared tracks, hot-swap, orphelin (orange)
  danger:  '#ef4444',  // panic, delete, errors (red)
  tracking:'#a855f7',  // tracking cues, expert, plugins (purple)
  dim:     '#6b7280',  // secondaire
}
```
Migration par fichier, ordre = volume de couleurs ad hoc :
`PerformView` (81) → `MovesTable` (46) → `Inspector` (36) → `CustomNode` (31)
→ `SpatialFxPanel` (26) → reste. Les hex Three.js (`0x22d3ee`…) reçoivent
des constantes liées aux mêmes valeurs (`utils/showColors.ts`).

### P1.2 — Z-index : purge numérique
`z-10` (Scene3D:418,490), `z-50` (PerformView:539), `z-[60]` → tokens
`z-overlay`/`z-raised`/`z-popover`/`z-menu`. Règle déjà dans la config.

### P1.3 — Nouveaux composants partagés (`components/show/`)
| Composant | Remplace | Sources |
|---|---|---|
| `ShowTransport` | GO/Prev/Next/Panic dupliqués ×3 | PerformView topbar/conduite/busking + ConduitePage — **sémantique unique GO** (résout GO≠GO de ConduitePage:86) |
| `PadButton` | `renderPad` + `renderSlotRow` actions | PerformView:486-… — **un seul rendu de slot** partagé avec MovesTable |
| `StatusChip` | PARKED/CONSOLE/TC/ARM/DRY-RUN chips | PerformView + ConduitePage + StatusBar |
| `ModeBanner` | 4 copies top-center | ModeButtons:66 + Scene3D:380/387/394 |
| `Badge` | micro-badges cues `text-[9px]` | CuelistPanel:204-229 — floor à `text-[10px]` min |
| `ui/Section` | Inspector.Section + SpatialFxPanel.Section | deux sémantiques → une |

### P1.4 — Primitives existantes déployées
- `IconButton` → les ~40 boutons ad hoc (PerformView scope buttons, chips,
  slot actions, NodeEditor rail). Variant `primary` = token `accent`
  (**supprime le second primaire indigo**).
- `EmptyState` → PerformView ×4 (465-585), NodeEditor (923-941),
  SettingsModal (276-278).
- `Slider` : typer `ACCENTS` (`Record<Accent,string>`), prop `decimals` sur
  les cas tronqués, `aria-label` requis en `bare`.

---

## P2 — Convergences (duplications métier)

*Critère : une action = une implémentation = un vocabulaire.*

| # | Action | Fichiers | Réfs |
|---|---|---|---|
| P2.1 | **`MacrosSurface` unique** : un composant (prop `scope: 'global'|'slot'`, un accent `tracking`, plages unifiées ±5 shift / ±180 rotation, Speed inclus partout où global) ; pacing unifié **dans** `pushMacrosToRuntime` (debounce 100ms, plus au composant) ; **supprimer `MacroControls.tsx` + son test** ; MacrosPanel conserve la partie "manipulate" (clear overrides) et délègue les sliders | `Inspector`, `MacrosPanel`, `PerformView:828-934`, `macrosSlice` | S3 |
| P2.2 | **Un rendu de slot** : `PadButton`/`SlotRow` partagé ; `renderSlotRow` PerformView et rows MovesTable convergent (même set d'actions, densité paramétrable `compact|pad`) ; badges `#oscIndex` identiques | `MovesTable`, `PerformView:486` | S2 |
| P2.3 | **`showStatusSlice`** : `parked`/`consoleAge`/`armed` — un poll unique dans le store, souscrit par PerformView, ConduitePage (via broadcast), StatusBar ; `armed` event-driven (P0.7) | nouveau slice, `PerformView:73`, `ConduitePage:39`, `StatusBar` | S10, F9 |
| P2.4 | **NodeEditor split** : `NodePalette` (611-838), `GraphCanvas` (841-997), `useActiveGraphStore()` (dispatch sub/global/signal — tue la triplication 209-251/316-324/474-657) ; edge-id inclut handles ; `onPaneDoubleClick` sur ReactFlow (pas wrapper) ; hover palette en classes | `NodeEditor.tsx` | S1, F11, F12 |
| P2.5 | **CustomNode sections** : `NodeParamField` (existant, réutilisé — supprime `renderNodeParamInput` Inspector et les 7 classes dupliquées), `LinkedTracksSection`, `TrackRangeSection` (util testé pour le parser), mutualisation expanded/collapsed (un seuil), `nodrag` sur inputs | `CustomNode.tsx`, `Inspector.tsx:150-211`, `nodeParamSchema.ts` | S2, lot-2 P2 |
| P2.6 | **TabPanel sans re-key** : contenu monté, `hidden` quand inactif — état local préservé, pas de refreshMovements au switch ; ARIA tablist | `TabPanel.tsx:41` | S4 |
| P2.7 | **Couleur track unifiée** : `trackColor(oscId)` dans `utils/` utilisé par TrackGrid, TrajectoryVisualization, chips Scene3D, HolMarkers | `TrackGrid:26`, `TrajectoryViz:109` | S9 |
| P2.8 | **IPC batching TrackGrid** : patterns appliqués en un `updateAssignment` groupé (set local + un `updateLiveAnimation`) ; slider depth throttlé 33ms | `TrackGrid:53-102,196-203` | S7 |
| P2.9 | **Vocabulaire** : un terme pour le graphe ("preset" recommandé — couvre template/animation/library), "Shift" partout (supprime "Offset X" des targets audio → `shiftX`), `one_shot` unique, anglais partout ou glossaire — décision à trancher | repo-entier | S12, S13 |
| P2.10 | **Utils partagés** : `cueLabel`/`tcStr` (PerformView:96-109 = useConduiteBroadcast:11-38), `DRAWABLE_NODE_TYPES` (ModeButtons:22-31 = objectsNodeSync:15), `drawZ` doc axes | nouveau `utils/showFormat.ts` | duplications |

---

## P3 — Modes et surfaces

*Critère : deux modes clairs, vocabulaire stable, cibles live ≥44px.*

- **P3.1 Deux modes** : `EDIT` (colonnes) / `LIVE` (PerformView). Renommer le
  toggle ("Édition" ⇄ "Live", bouton affiche la **destination**, pas l'état) ;
  Simple/Expert reste un sous-état d'EDIT, libellé déambiguïsé.
- **P3.2 Overlays live unifiés** : touch/busking/conduite = **une surface**
  à zones (transport / pads / conduite / détails repliés) au lieu de 3
  `absolute inset-0` — PadButton/ShowTransport de P1 en font le squelette.
- **P3.3 Tailles** : PerformView et surfaces live : actions ≥44px, infos de
  conduite ≥`text-sm`/`base`, badges ≥10px (floor absolu : supprimer
  `text-[8px]`/`[9px]` en live).
- **P3.4 CuelistPanel dégagé** : `h-56` fixe → flexible (`min-h`/`flex-1`) ;
  en EDIT, stack Moves+Cues co-visibles au lieu de tabs exclusifs
  (complète P2.6).
- **P3.5 Toolbar zonée** : fichier (import/save/load) / projet (OSC chip,
  undo) / live-safety (arm, panic) — Import `.hol` perd la proéminence une
  fois un projet chargé ; erreurs affichées en un seul endroit (StatusBar).
- **P3.6 AudioPanel** : supprimer le collapse interne (celui d'App suffit) ;
  `h-15`→`h-14` ; mini-RMS dans le header App pour niveau persistant replié.

---

## P4 — Fallbacks et hygiene

- **P4.1** ErrorBoundary autour de `?view=conduite` + fallback "waiting for
  main window" quand `st===null` ; `safeListen`/`safeEmit` au lieu de raw API ;
  panic → `PanicButton` partagé. *(F10)*
- **P4.2** `Modal` : focus initial = `[autofocus]` ou premier focusable du
  **contenu** (jamais le X) ; `aria-labelledby` ; Esc dans Modal lui-même
  (garde si pas de hook). *(F7)*
- **P4.3** ConfirmModal partout : `deleteAnimation`, `removeZone/Modulation/
  Channel`, `clear all` ×3 ; toast-undo en alternative légère. *(F8)*
- **P4.4** `h-15`→`h-14` (AudioPanel:211) ; `catch(()=>{})` → indicateur
  "backend absent" ; `sceneReady` re-check borné ; `JSON.parse` default_json
  try/catch ; `getValidTargetTypes` n'exclut plus self. *(F14 + latents)*
- **P4.5** État mort : `isPlaying`, `status`, `compileError`, `playError`,
  `currentTime`, `duration`, API morte `oscSlice`, `[DBG-playSlot]` — purge
  ou réactivation délibérée. *(F13)*
- **P4.6** Zone/mode état : `zonePlaceMode`/`zoneEditMode` réinitialisés au
  démontage du tab ; `soloSavedIds` → slice. *(S11)*

---

## Dépendances et ordre

```
P0 (fonctionnel)  ──┐
                    ├─→ P1 (tokens+primitives) ─→ P2 (convergences) ─→ P3 (modes) ─→ P4
P0.7 (armed event) ─┘         ↑ nécessite P0.5 pour ShowTransport
                              ↑ nécessite P0.7 pour StatusChip armed
```

- **P1 sans P0** : risque de reskiner des interactions cassées.
- **P2.4/P2.5 (split éditeur) indépendants** du reste — faisables en parallèle.
- **Vocabulaire (P2.9) à trancher avant P3** (renommage des modes).
- Chaque étape = un commit isolé + tests verts (383 vitest + les suites Rust).

## Risques identifiés

- **Hot-path 60fps** : toute modification de `useRenderLoop`/`movementPositions`
  reste hors-store et hors-render (ne pas réintroduire de re-render).
- **Persisted state** : renommage de slices/flags → migration localStorage
  (clés `ss-*`, `stagespace-*`).
- **Tests creux à rattraper** : QuickAddModal assertion tautologique ;
  ajouter des tests sur les guards (P0.5) et `setDrawMode` exclusif (P0.2).
- **ConduitePage** : valider en vraie fenêtre Tauri — le browser ne couvre
  ni `listen` ni `emit`.
