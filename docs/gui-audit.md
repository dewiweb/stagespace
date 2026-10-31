# Audit GUI global — structure, hiérarchie, éléments

Cartographie complète de l'app d'abord, puis constats par niveau.

## Carte de l'app (App.tsx)

```
App (default : performMode = TRUE → l'app démarre en live)
├── performMode → <PerformView/> (surface live, ~1000 lignes)
└── edit → 3 colonnes + chrome
    ├── Toolbar (h-9, haut) — boutons mode + actions globales
    ├── Colonne gauche (collapsible, resize w-1.5 drag)
    │   ├── TabPanel "moves" : Moves / Cues / FX   ← prioritïté flex-1
    │   └── AnimationList (templates)             ← secondaire
    ├── Centre
    │   ├── showExpert → NodeEditor + splitter + Scene3D (split ratio persisté)
    │   └── !showExpert → Scene3D seul (mode "Simple")
    ├── Colonne droite (collapsible)
    │   ├── AudioPanel (collapsible max-h-40%)
    │   ├── Inspector (flex-1, outil principal)
    │   └── strip de collapse `w-7`
    ├── StatusBar (bas, monitoring moteur — toutes les vues)
    └── focusActive (expert+focus) → colonnes latérales masquées
```

**3 niveaux de modes imbriqués** : `performMode` (edit↔perform), `showExpert`
(simple↔expert dans edit), `editorFocus` (focus dans expert) — plus les 4
overlays internes de PerformView (touch/busking/conduite/⧉). **7 modes**
pour 2 usages réels (éditer, piloter).

## Constats par niveau

### 1. Modes — prolifération au niveau app
- Le bouton `performMode` toggle est `text-xs` dans la toolbar — le changement
  de mode fondamental du produit n'a pas de poids visuel.
- Simple/Expert (2e bouton) et Focus (3e état caché) : trois états d'édition
  empilés sans cue visuel de "où je suis" — un utilisateur perdu ne sait pas
  comment il est arrivé là.
- `performMode` démarre à `true` : l'édition est le mode secondaire, pas le
  mode de référence — cohérent live mais déroutant pour un nouveau venu.

### 2. Colonnes edit — densité hétérogène
- Left : `TabPanel` Moves/Cues/FX + AnimationList partagent la colonne —
  deux sections concurrentes sans séparateur fort.
- Right : AudioPanel collapsible `max-h-40%` + Inspector `flex-1` — l'outil
  principal (Inspector) partage la place avec du monitoring secondaire.
- Resize handles `w-1.5` (6px) : la zone de grab des splitters est
  presque invisible — cible drag < 10px.

### 3. PerformView (voir détail élément ci-dessous)
- Topbar : 10 items au même niveau, GO=gros vs cue=text-xs.
- 4 overlays `absolute inset-0 z-50` empilés, transport dupliqué 3×.

### 4. Système visuel — fondation présente, contournée
- Tokens `stagespace.{bg,panel,border,accent}` + `zIndex` nommée — posés.
- Mais : `accent` unique vs 8 couleurs ad hoc (indigo/green/amber/purple/
  cyan/orange/emerald/red) ; overlays `z-50`/`z-[60]` en dur ; `bg='#0b0d12'`
  hardcodé dans ConduitePage.
- Tailles : actions live à 24-40px (seuil touch 44px), texte live `text-xs`.
- Aucun fallback visuel : page blanche hors Tauri, erreurs silencieuses.

## Détail élément — PerformView

| Zone | Rendu | Problème précis |
|---|---|---|
| dot LIVE | `w-4 h-4` + `text-lg` count | état vital = pois + chiffre sans cadre |
| `Setlist n/N` | `text-xs gray-400` | secondaire au même plan que GO |
| `Cue n→n+1` | `text-xs amber-300` | **l'objet conduite sans poids visuel** |
| RECALLING | `text-xs pulse` | état bloquant illisible |
| PLAY/GO | `px-6 py-1.5 text-lg` indigo/green | corrects — seuls à avoir du poids |
| Chips mode (6) | `text-xs` | hétérogènes alignés sans regroupement |
| PARKED/CONSOLE/TC | `text-xs` chips | santé dispersée au milieu du transport |
| Lignes slots | `py-2.5`, boutons `w-9 h-9` (36px), solo `w-6 h-6` (24px) | sous 44px |
| Pads | `min-h-[88px]`/150px | bon, mais autre vocabulaire que les lignes |
| LiveDrawer scopes | `px-4 py-2 text-xs` | outillage live présenté comme filtre |
| CuelistPanel | `h-56` fond de colonne `w-72`, badges `text-[10px]` | l'objet central du show confiné à ~230px |

## Problèmes globaux (cause → manifestation)

1. **Pas de hiérarchie de rôle** — couleur = action, jamais = priorité
   (primary/watch/dim n'existent pas).
2. **Pas de composant de show** — chaque surface réécrit ses classes
   (5 rendus du même transport).
3. **Modes empilés** — 7 états pour 2 usages ; les modes se substituent
   plutôt que de structurer.
4. **Éléments sous-dimensionnés** — actions live <44px, texte live `text-xs`.
5. **Aucun chemin d'erreur** — blanc, silencieux, ou rien.

## Ordre de refactor proposé

P0 — **Tokens de rôle** (`live`/`conduite`/`armed`/`osc`/`warning`/`panic` +
`surface`/`dim`/`hi`) → rentrer les 8 ad hoc dans ~9 tokens.
P1 — **Composants de show** (`ShowTransport`, `PadButton`, `StatusChip`,
`ModeHeader`) → un seul GO, un seul panic, une sémantique.
P2 — **Deux modes clairs** : EDIT (colonnes) / LIVE (surface unique
unifiant touch/busking/conduite) — les modes internes de PerformView
disparaissent.
P3 — **Tailles de base** : actions live ≥44px, info conduite ≥text-base.
P4 — **Fallbacks visibles** : erreur explicite, pas de page blanche.

## Recensement quantitatif (32 composants + 7 ui/)

| Métrique | Mesure | Lecture |
|---|---|---|
| Lignes totales | ~9 100 | PerformView 1184 + NodeEditor 1063 + Inspector 680 + CustomNode 618 + MovesTable 617 + SpatialFxPanel 583 + Scene3D 505 + CuelistPanel 466 |
| `text-xs` | **403 occurrences** | 80% du texte est 12px — aucune hiérarchie typographique effective |
| `text-lg`/`xl`/2xl+ | ~45 | les gros corps sont rares et localisés (overlays) |
| `text-[10px]`/`[11px]` | 21 | sous-12px répété — illisible |
| Couleurs ad hoc | **~250 usages**, 15+ teintes | red-400×33, cyan-400×27/300×21/500×20/900×16, purple×37, orange×26, indigo×24 — pas un token de rôle |
| `z-N` en dur | z-10×4, z-50×2, z-[60]×1 | l'échelle nommée zIndex existe et n'est pas utilisée partout |
| Cibles <44px | w-6 h-6×6, w-4 h-4×6, w-9 h-5×3, w-5 h-5×2, w-8/w-9×2 | ~20 boutons sous le seuil touch |

**Lecture quantitative** : le problème n'est pas quelques couleurs mal
choisies — c'est ~400 textes à 12px, ~250 couleurs hors tokens, ~20 cibles
sous 44px, répartis sur 32 fichiers. Le refactor est une normalisation en
profondeur, pas une retouche.

## Annexe — tous les fichiers GUI (données réelles par fichier)

| Fichier | Lignes | text-xs | couleurs ad hoc | petites cibles | overlays |
|---|---|---|---|---|---|
| PerformView.tsx | 1184 | 42 | 81 | 6 | 2 |
| NodeEditor.tsx | 1063 | 35 | 19 | 3 | 1 |
| Inspector.tsx | 680 | 49 | 36 | 3 | 0 |
| CustomNode.tsx | 618 | 31 | 31 | 2 | 0 |
| MovesTable.tsx | 617 | 41 | 46 | 2 | 0 |
| SpatialFxPanel.tsx | 583 | 30 | 26 | 1 | 0 |
| Scene3D.tsx | 505 | 9 | 7 | 0 | **7** |
| CuelistPanel.tsx | 466 | 12 | 25 | 0 | 0 |
| NodeParamsPanel.tsx | 305 | 14 | 11 | 2 | 0 |
| SettingsModal.tsx | 294 | 27 | 6 | 0 | 0 |
| TrackGrid.tsx | 254 | 7 | 2 | 0 | 1 |
| AnimationList.tsx | 240 | 16 | 13 | 0 | 0 |
| AudioPanel.tsx | 214 | 14 | 9 | 0 | 0 |
| MacroControls.tsx | 213 | 10 | 5 | 0 | 0 |
| Toolbar.tsx | 176 | 6 | 3 | 0 | 0 |
| ZoneVisualization.tsx | 162 | 0 | 0 | 0 | 0 |
| TrajectoryVisualization.tsx | 159 | 0 | 0 | 0 | 0 |
| QuickAddModal.tsx | 138 | 4 | 4 | 0 | 0 |
| AudioModControls.tsx | 128 | 10 | 8 | 0 | 0 |
| StatusBar.tsx | 113 | 1 | 12 | 0 | 0 |
| ui/Slider.tsx | 109 | 4 | 4 | 0 | 0 |
| pages/ConduitePage.tsx | 94 | 0 | 10 | 0 | 0 |
| ui/Modal.tsx | 94 | 0 | 0 | 0 | 1 |
| MacrosPanel.tsx | 87 | 5 | 2 | 0 | 0 |
| WelcomeModal.tsx | 86 | 6 | 1 | 0 | 0 |
| ModeButtons.tsx | 74 | 4 | 0 | 0 | 0 |
| DebugPerfOverlay.tsx | 58 | 2 | 6 | 0 | 0 |
| ui/PanicButton.tsx | 54 | 1 | 4 | 0 | 1 |
| ui/EmptyState.tsx | 52 | 2 | 4 | 0 | 0 |
| ToastContainer.tsx | 51 | 2 | 4 | 0 | 0 |
| DrawModeOverlay.tsx | 50 | 5 | 6 | 0 | 0 |
| ErrorBoundary.tsx | 48 | 2 | 1 | 0 | 0 |
| TabPanel.tsx | 47 | 1 | 0 | 0 | 0 |
| ShortcutsModal.tsx | 46 | 3 | 0 | 0 | 0 |
| ui/IconButton.tsx | 46 | 4 | 14 | 0 | 0 |
| ui/ConfirmModal.tsx | 43 | 3 | 2 | 0 | 0 |
| ui/OscArmToggle.tsx | 41 | 1 | 5 | 0 | 0 |
| (+ tests, exclus) | — | — | — | — | — |

**Poids du problème par fichier** (lignes × text-xs × couleurs) :
PerformView (1184/42/81), NodeEditor (1063/35/19), Inspector (680/49/36),
MovesTable (617/41/46), CustomNode (618/31/31), SpatialFxPanel (583/30/26),
CuelistPanel (466/12/25) — **le 60% des couleurs ad hoc est concentré dans
5 fichiers** ; Scene3D empile 7 overlays `absolute inset-0`.

## Audit détaillé par fichier — synthèse des 6 lots (7 agents)

### Bugs fonctionnels (à corriger avant tout reskin)

| # | Bug | Fichier:ligne |
|---|---|---|
| F1 | **ModeButtons recouverts** par les couches `inset-0` — en mode manipulate/assign, sortie impossible au clic (Esc seul) | Scene3D:400 vs 431-468 |
| F2 | **drawMode non exclusif** — assign/zone restent actifs → dessin impossible | drawModeSlice:38, ModeButtons:57 |
| F3 | **Ghost lines** — trajectoires jamais effacées après stop-all (early-return avant cleanup) | TrajectoryVisualization:64 |
| F4 | **RECALL ▶ header en un click** — contournement arm-first (le recall tue la scène) | CuelistPanel:119-137 |
| F5 | **UI contourne liveActions** — Prev/Next/GO sans guard `isRecalling`, timer pendu peut tirer pendant recall | PerformView:111/648/661, CuelistPanel:120/131/193, doSlotStop sans guard |
| F6 | **macroDebounce partagé** — un drag macro annule un hot-swap graphe en attente | Inspector:104/135-147/402-403 |
| F7 | **Modal focus = X** — `focusables[0]` = bouton X, vole l'autofocus de QuickAddModal | ui/Modal:42 |
| F8 | **Delete sans confirmation** : `deleteAnimation` (hover-only), `clear all` ×3 SpatialFx, removeZone/Modulation/Channel — incohérent avec ConfirmModal ailleurs | AnimationList:222, SpatialFxPanel:227/391/494 |
| F9 | **OscArmToggle désynchronisé** — 3 sources d'écriture, DryRunChip concurrent sémantique inversée, aucun event | OscArmToggle:13, CuelistPanel:382-393, osc.rs:239 |
| F10 | **ConduitePage hors-filets** : raw listen/emit, pas d'ErrorBoundary, panic hors PanicButton, GO ≠ GO (cue vs setlist) | ConduitePage:7/44/88 |
| F11 | **edge-id sans handles** — dup id si 2 edges mêmes nodes | NodeEditor:227/244 |
| F12 | **Double-clic MiniMap ouvre QuickAdd** — onDoubleClick sur wrapper | NodeEditor:469 |
| F13 | **État mort prod** : isPlaying/status/compileError/playError/currentTime jamais settés ; bandes d'erreur Toolbar/StatusBar = code mort | useGraphStore:310 |

### Problèmes structurels (refactor)

| # | Problème | Échelle |
|---|---|---|
| S1 | **Triplication sub/global/signal** non factorisée | NodeEditor (~45 lignes ×3) |
| S2 | **Duplication de slots** : MovesTable vs PerformView renderSlotRow | 2 implémentations divergentes |
| S3 | **Macros = 4 surfaces + 1 morte** : purple/blue/orange, 3 scopes, plages ±3/±5/±10 | Inspector×3, MacrosPanel, PerformView, MacroControls (dead) |
| S4 | **TabPanel re-key** → remount complet, état perdu, Moves/Cues jamais co-visibles | TabPanel:41 |
| S5 | **IconButton sous-exploité** : 22 classes ad hoc, 0 token, 1 consommateur | ui/IconButton |
| S6 | **CuelistPanel confiné** h-56/w-72, text-[8px]-[10px] | PerformView:523 |
| S7 | **TrackGrid rafales IPC** : patterns = N×updateLiveAnimation non batchés | TrackGrid:53-102 |
| S8 | **ZoneVisualization rebuild-all** via JSON.stringify deps pendant drag 30Hz | ZoneVisualization:113-147 |
| S9 | **Couleur track divergente** : TrackGrid (index tableau) vs 3D (track_index) | TrackGrid:26 vs TrajectoryViz:109 |
| S10 | **Pollings dupliqués** : parked/armed/consoleAge ×2 surfaces ; besoin `showStatusSlice` | PerformView:73 vs ConduitePage:39 |
| S11 | **État interactif survit au démontage** : zonePlaceMode/EditMode persistent | interactionModesSlice |
| S12 | **Vocabulaire incohérent** : Move/slot/template/animation/preset ; Shift vs Offset ; loop/oneshot ; FR/EN | repo-entier |

### Priorité par fichier (verdicts agents)

**Haute** : PerformView (1184l — duplication transport/pads, tokens), NodeEditor (1063 — triplication + bugs F11/F12), CustomNode (618 — dup input×7, seuils 16/12), Inspector (680 — god-panel 3 modes, dead code performMode, double-write macros), CuelistPanel (466 — confinement + F4), Scene3D (505 — F1/F2/F3 overlays).

**Moyenne** : MovesTable (617 — 7 micro-actions/ligne), SpatialFxPanel (583 — F8 + 15 inputs mono), NodeParamsPanel (305 — hit targets), MacrosPanel (87 — 3e surface macros mal nommée), TrackGrid (254 — S7/S9), ConduitePage (94 — F10).

**Suppression** : MacroControls (213 — dead code + 24 tests creux).

**Bonne santé** : nodeParamSchema (semi-typé seulement), ui/Modal·ConfirmModal·Slider·EmptyState·PanicButton·ToastContainer (primitives OK, sous-déployées), ErrorBoundary (zones OK, manque conduite), liveActions (bien factorisé, contourné par F5).

### Verdict global

Le câblage soutient le refactor sans réécriture métier : show logic = moveSlotsSlice+useCuelistStore+liveActions (bien factorisé). **13 bugs fonctionnels** à corriger d'abord (dont F1-F4 = sécurité live), puis **12 problèmes structurels** de duplication/convergence. Le design system existe (tokens + primitives) mais n'est pas déployé — c'est de la normalisation, pas de la création.

## Lot 7 — chrome (Toolbar, StatusBar, AudioPanel, ModeButtons)

- **Toolbar** : mélange édition/live/monitoring sans hiérarchie — 5 langages de boutons en une ligne, erreurs dupliquées (×StatusBar), OSC destination ×3, Import `.hol` proéminent en permanence.
- **StatusBar** : télémétrie dev (`merge µs`, `lock µs`) au premier plan live ; `oscSuspended` affiché mais **état ARM absent** — la métrique de sécurité live manque au poste de surveillance.
- **AudioPanel** : double collapse (App "AUDIO IN ▸" + panel "Audio Input ▾") = 2 clics ; `h-15` classe morte Tailwind → spectre déformé ; niveau audio disparaît quand replié.
- **ModeButtons** : banners top-center ×4 dupliqués, `hasDrawableNode` duplique la liste spline, `return null` en drawMode sans sortie visible au clic.

À ajouter aux bugs fonctionnels :
- **F14** `h-15` inexistant → canvas spectre déformé (AudioPanel:211)
- **F15** ModeButtons recouverts F1 + `return null` drawMode → **aucune sortie de draw au clic** ni banner manipulate avec "Esc"
- **F16** état ARM OSC invisible en StatusBar (le monitoring montre la télémétrie dev mais pas le dry-run)

À ajouter aux structurels :
- **S13** Vocabulaire modes : "PERFORM"/"Atelier"/"Simple"/"Expert" — 3 noms pour 2 modes, bouton affiche l'état courant (ambigu)
- **S14** Duplications transverses : erreurs ×2, OSC destination ×3, banners ×4, spline list ×2

## Conclusion de l'audit

**Couverture** : 39 fichiers GUI + 6 stores + câblage, 7 lots, lecture intégrale.

**Bilan** : 16 bugs fonctionnels (F1-F16) — dont sécurité live (F1/F2/F4/F5/F15) et état contradictoire (F9/F16). 14 problèmes structurels (S1-S14) — duplication/divergence. Le métier est sain ; le défaut est le **design system non déployé** (tokens + primitives existants mais contournés partout) et les **convergences manquées** (4 surfaces macros, 2 rendus de slot, 4 banners, dispatch contourné).

**Ordre de refactor confirmé** :
- **P0** — bugs live-safety : F1, F2, F4, F5, F15 (sortie de mode, recall guard) + F16 (ARM visible)
- **P1** — tokens de rôle + composants partagés (`ShowTransport`, `PadButton`, `StatusChip`, `ModeBanner`, `IconButton` déployée, `NodeParamField`)
- **P2** — convergences : 1 surface macros, 1 rendu slot, liveActions uniquement, showStatusSlice
- **P3** — deux modes clairs + tailles ≥44px
- **P4** — fallbacks : ErrorBoundary conduite, modal focus, delete guards, classes mortes
