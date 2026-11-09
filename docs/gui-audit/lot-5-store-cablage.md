# Lot 5 — Store, IPC, câblage (audit complet)

## 1. Carte des stores et slices

### Stores racine

| Store | Taille | Rôle |
|---|---|---|
| `useGraphStore` | 719 l. | **Mégastore** : 14 slices + graphe React Flow, undo/redo, panic, `updateGraphLive`, 5 hooks listeners Tauri (519-718) |
| `useMoveEditorStore` | 488 l. | Bibliothèque `animations[]`, projection `current` (write-through), flags UI, `launchAnimation` legacy |
| `useCuelistStore` | 267 l. | Cues (frontend-owned), `isRecalling`, timers pre_wait/follow, TC chase, feedback OSC |
| `useGlobalGraphStore` | 191 l. | Graphe post-process global, persisté |
| `useSignalGraphStore` | 216 l. | Graphe modulation (`'global'` ou slotId) |
| `useToastStore` | 65 l. | Toasts dédupliqués, sticky capés |

### Slices de `useGraphStore`

| Slice | Taille | Responsabilité | Notes |
|---|---|---|---|
| `perfSlice` | 17 | Miroir `get_perf_stats` | runtime → affichage |
| `audioSlice` | 66 | Capture audio + device persisté | bridge backend |
| `oscSlice` | 172 | CRUD mappings + parsers | **`oscValues`/`setOscValues`/`getOscValue`/`setOscInEnabled`/`suppressOscIn` = API morte** |
| `persistenceSlice` | 555 | Save/load `.hfg` v2 | GUI fichiers |
| `macrosSlice` | 104 | Macros globales → `set_global_macro` | runtime |
| `holProjectSlice` | 206 | Import `.hol`, tracks, `manualOscIds` | données show |
| `drawModeSlice` | 171 | Dessin libre → DrawSpline | GUI édition |
| `movementSlice` | 219 | Miroir moves, `movementPositions` mutable hors-store 60fps | runtime |
| `moveSlotsSlice` | **1065** | **Cœur show** : slots, setlist, GO, play/stop optimistic, hot-swap | métier show |
| `oscConfigSlice` | 137 | Config OSC persistée, lock en playback | config |
| `splineLibrarySlice` | 59 | Bibliothèque splines | GUI |
| `spatialFxSlice` | 255 | Zones/modulations/channels | bridge backend |
| `interactionModesSlice` | 65 | Modes 3D exclusifs | GUI |
| `pluginSlice` | 99 | Registry plugins WASM | bridge backend |
| `objectsNodeSync` | 64 | Helper partagé sync nodes | interne |

## 2. Flux liveActions — chaîne complète

```
Clavier (useLiveShortcuts:87-113)
   Enter → doGo() / Shift+Enter → doCueNext() / Backspace → doCuePrev()
   Esc → panic() / Space → playSlot|stopSlot / ? → shortcutsOpen

OSC /stagespace/* (backend → event 'show-control')
   useShowControl:21 → ShowCommand → doGo/doCueNext/doCueRecall/doSlot/
   doSlotStop/doSolo/doUnsolo/doArm/doStatus/doPark/doUnpark/doPanic/
   doStop/handleTimecode → NACK via send_show_nack

Fenêtre conduite (ConduitePage → emit 'conduite:cmd')
   useConduiteBroadcast:42-54 → doCueNext/doCuePrev/doPanic

liveActions.ts (dispatch commun)
   → cancelPendingTimers() + recallBusy() [isRecalling → NACK]
   → useCuelistStore: recallCue/goToNextCue/goToPreviousCue/sendStatusNow
   → useGraphStore: goToNextMove/playSlot/stopSlotWithFade/stopAllMovements/panic
   → IPC: set_osc_armed, park_object, unpark_object
```

**Le flux est bien factorisé** — clavier, OSC, conduite convergent sur les
mêmes `doX`. Deux trous dans le filet (§5).

## 3. Persistance (localStorage)

| Clé | État |
|---|---|
| `stagespace-animations` (v2) | Bibliothèque `Move[]` |
| `stagespace-move-slots` | `moveSlots` + `movementId` (stale nettoyé par `syncSlotMovements`) |
| `stagespace-move-setlist` | `setlistOrder` |
| `stagespace-cuelist` + `-tc-chase` | `cues`, `tcChaseEnabled` |
| `stagespace-osc-config` | osc + timecodeFps |
| `stagespace-global-graph-v4` | graphe global |
| `stagespace-signal-graph-v1` | signal graph **contexte global seulement** (per-slot → `slot.signalGraph`) |
| `stagespace-spline-library` | splines |
| `stagespace-audio-device` | deviceId |
| `stagespace_graph_<name>` | graphes nommés legacy |
| `stagespace-welcomed`, `portLegend.collapsed`, `ss-layout-*` (8 clés) | flags/layout |

**Non persisté** : `editingSlotId`, `pendingPlays`, `movements`, `perfStats`,
`audioState`, `macros` (hors .hfg), `performMode`/`showExpert`, modes
d'interaction, `parked`/`armed` (backend-only), `soloSavedIds` (module-level).

## 4. Polling actif & listeners — inventaire complet

### setInterval / poll loops
| Où | Intervalle | Quoi |
|---|---|---|
| `useLiveShortcuts:162` (usePerfStatsPolling) | 500ms si `movements>0` | `get_perf_stats` + toasts |
| `useConduiteBroadcast:16` | 500ms | `emit('conduite:state')` |
| `PerformView:73` | 1500ms | `get_parked_objects` + `get_last_show_cmd_age` |
| `ConduitePage:39` | 1500ms | idem + `get_osc_armed` |
| `PerformView:1012` (OscMappingsPanel) | 500ms | `osc_get_all_values` (**bypasse le slice**) |
| `CuelistPanel:368` | 200ms | tick countdown |
| `CuelistPanel:405` | 500ms | tick TC lost |
| `oscLearn:18` | 120ms × 10s | `get_last_osc_message` |

### Debounces/throttles
`update_animation_state` 33ms ; `set_move_speed` 33ms keyed ; auto-save slot
400ms ; hot-swap 200ms ; `set_osc_output`/`set_global_osc_ids` 300ms ;
localStorage slots 250ms ; macros debounce 100ms **au niveau composant**
(Inspector:135, LiveDrawer:709) ; `markFading` fade+1500ms.

### Listeners Tauri (montés `App.tsx:72-90`, survivent au mode Perform)
`audio-error`/`audio-recovered` (524), `audio-state-update` (551),
`cue-recalled` (566), `move-stale-killed`/`merge-restarted`/
`merge-restart-failed` (588), `active-moves-update` → `refreshMovements` +
`syncSlotMovements` (620), `global-positions` → `setMovementPositions` (688),
`show-control` (useShowControl:21), `conduite:cmd`/`conduite:state`.

## 5. Problèmes précis

### État mort dans `useGraphStore`
`isPlaying` (310) **jamais `true` en prod** — lu par Scene3D:44,
MacroControls:11, useManipulateMode:40, tous compensés par `|| movements>0`.
Idem `status`, `compileError`/`playError` (jamais settés — la bande d'erreur
Toolbar:166 et StatusBar:89 = **code mort**), `currentTime`/`duration`.
Résidu du pipeline pré-multi-moves.

### F5 — Dispatch incohérent : liveActions contournés par l'UI
- `PerformView:648,661` : Prev/Next conduite appellent `goToPreviousCue()`/
  `goToNextCue()` **directement** → pas de `cancelPendingTimers()`, pas de
  guard `recallBusy` → timer pendu peut tirer **pendant** un recall.
- `PerformView:111` (`handleGO`) : `goToNextMove()` direct → pas de guard →
  GO peut intercaler stop/play avec un `recall_cue` en cours.
- `CuelistPanel:120,131,193` : même contournement (boutons + dbl-click).
- `liveActions:87` : `doSlotStop` **sans** `recallBusy` → stop peut tuer un
  move que le recall vient de respawner.

### Duplications d'état
- **`parked`/`consoleAge`/`armed`** : poll dupliqué PerformView↔ConduitePage ;
  `OscArmToggle` (12-14) et `DryRunChip` (383) ne lisent `get_osc_armed`
  **qu'au mount** → stale dès `/stagespace/arm` ailleurs ; aucun event
  d'invalidation backend.
- **`current` vs slot** : duplication intentionnelle documentée ; mais
  `Inspector:122-137` maintient DEUX mappings manuels `SIMPLE_TO_MACRO`/
  `MACRO_TO_SIMPLE` et écrit dans `updateCurrent` ET `setMacros`.
- `activeMovementIds` : copie de `movements` via subscribe (482-487) —
  doublon hérité du chemin legacy.
- **Formatage TC/cueLabel dupliqué** : `useConduiteBroadcast:11-38` recopie
  `PerformView:96-109` à l'identique.
- `osc_get_all_values` : `OscMappingsPanel` invoque l'IPC directement au lieu
  de `getAllOscValues` du slice — `oscValues` jamais alimenté.

### Divers
`soloSavedIds` module-level non réactif (liveActions:102) ; `feLog` debug
`[DBG-playSlot]` en prod (moveSlotsSlice:616-804) ; dépendances circulaires
gérées par imports dynamiques partout — fragile.

## 6. Séparation métier/rendu

La logique show vit **dans les stores + liveActions** : sémantique
recall/GO/fades/TC → cuelist+moveSlots+liveActions ; optimistic UI +
reconciliation → `playSlot`/`syncSlotMovements` ; config-lock → oscConfigSlice.
Composants = sélecteurs granulaires + rendu (bonne discipline, commentée).

Exceptions : `OscMappingsPanel` IPC direct, `ParkedChip`, `handleAssignDown`
(acceptable), `useMovementPositionsListener` qui **pousse aussi la config
OSC** (misnamed).

## Verdict

**Oui — le câblage soutient un refactor de design sans réécriture métier.**
Noyau show = `moveSlotsSlice` + `useCuelistStore` + `liveActions` ; reskin
PerformView/ConduitePage = mêmes `doX` + sélecteurs.

À durcir : (1) tous les boutons UI par `liveActions` ou absorber les guards
dans `goToNextCue`/`recallCue` ; (2) `showStatusSlice` pour
`parked`/`consoleAge`/`armed` — un poll partagé ou event-driven ;
(3) nettoyer l'état mort ; (4) mutualiser `cueLabel`/`tcStr` ;
(5) documenter/résoudre les imports cycliques.
