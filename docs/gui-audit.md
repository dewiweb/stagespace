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
