# Audit GUI — niveau élément (code + rendu réel)

Revue précise des surfaces, par composant. Source : lecture du code complet et
captures réelles (dev server + ?view=conduite).

## PerformView.tsx (~1 000 lignes — la surface live)

### Topbar — 10 éléments au même niveau
| Élément | Rendu réel | Problème |
|---|---|---|
| `LIVE/IDLE` dot + count | `w-4 h-4` dot + `text-lg font-black` | le point d'état principal est un pois vert |
| `Setlist n/N` | `text-xs uppercase gray-400` | information secondaire au premier plan |
| `Cue n→n+1` | `text-xs`, amber-300 sur gray-500 | la donnée de conduite la plus importante tient dans une span sans fond |
| `RECALLING…` | `text-xs animate-pulse` | un état bloquant en petit texte |
| `PLAY ▶` | `px-6 py-1.5 text-lg` | gros bouton mais fond `indigo` qui rivalise avec GO |
| `GO ▶` | `px-6 py-1.5 text-lg` vert | OK primaire — le seul qui a le bon poids |
| Chips mode (⧉/Conduite/Busking/touch/OSC ARM/Panic) | `px-3 py-2 text-xs` | 6 actions hétérogènes alignées sans regroupement |
| `PARKED`/`CONSOLE` chips | injectés au milieu | pas de zone "santé" dédiée |
| `TC` chip | `text-xs font-mono` | TC illisible à distance, pourtant critique quand chase |

### Slots — deux rendus incohérents
- `renderSlotRow` : `py-2.5` (~44px), bouton `w-9 h-9` (36px), badge `#n` `text-[10px]`, solo `w-6 h-6` (24px) — les actions sont sous le seuil touch 44px.
- `renderPad` : `min-h-[88px]` (150 en big) — le pad a le bon geste mais autre vocabulaire que la rangée (jamais la même chose rendue deux fois pareille).
- **`Group` header "Setlist — GO avance ici"** : text-xs uppercase sur fond purple-950/20 — le section titre est presque invisible.

### Overlays empilés
- `conduiteMode`, `buskingMode` : `absolute inset-0 z-50` — overlays plein écran sur le même parent, duplicatent les boutons (GO/Prev/Next/Panic écrits 3× : topbar + conduite + busking).
- Sémantique GO différente selon l'endroit : topbar = `goToNextMove` (setlist), conduite = `goToNextCue` — même bouton, deux actions.

### LiveDrawer (bas)
- Scopes `params|playback|tracks|audio|osc` en chips `px-4 py-2 text-xs` — l'outillage live le plus précieux est présenté comme des filtres secondaires.
- `playingSlots` chips `py-1 text-xs` — le switch de focus live tient en 28px.

## Tokens — défini puis contourné

- `tailwind.config.js` : `stagespace.{bg,panel,border,accent}` + `zIndex` nommée (overlay/raised/popover/menu) — **bonne fondation**.
- Mais 8 couleurs ad hoc hors tokens dans PerformView seul : `indigo-600` (PLAY), `green-600` (GO), `amber-300` (cue), `purple-900/400` (current+recall), `cyan-800/300` (parked/console), `orange-700` (solo/unsolo), `emerald-400` (console ok), `red-800` (stop/panic) — aucune ne passe par un token de rôle.
- `zIndex` nommée existe mais les overlays utilisent `z-50`/`z-[60]` en dur.

## ConduitePage (?view=conduite)

- `Suspense fallback={null}` + `listen`/`emit` échouant hors Tauri → **page blanche** : pas de chemin d'erreur visuel.
- Palette inline `background: '#0b0d12'` qui ne passe pas par les tokens (hardcodée là où la classe `bg-stagespace-bg` aurait suffi).
- Boutons `rounded-2xl py-6 text-2xl/3xl` — cohérents et lisibles : c'est la meilleure surface du lot, juste pas reliée au reste.

## CuelistPanel (cue list — objet central du show)

- Confiné à `h-56` bas de colonne `w-72` — l'objet le plus important du show a ~230px de haut.
- Lignes `px-2.5 py-2` avec badges `fNs`/`TC`/`pre` microscopiques (`text-[10px]`) — les fades, TC et modes des cues sont réduits à des glyphes.

## Le fond du problème

1. **Pas de rôle visuel** : la couleur code l'action (vert=GO) mais pas la *priorité* — primary/secondary/watch n'existent pas.
2. **Pas de composant de show** : PadButton, ShowTransport, StatusChip n'existent pas — chaque surface réécrit les classes.
3. **4 modes au lieu d'une surface** : touch/busking/conduite/⧉ répondent au même besoin et se superposent.
4. **Tailles minimales non garanties** : la majorité des actions live <44px.
5. **Aucun fallback visuel** : erreur ou hors-contexte = blanc, rien ne parle.

## Ordre de refactor proposé

P0 — **Tokens de rôle** : `live`, `conduite`, `armed`, `osc`, `warning`, `panic` (+ `surface`, `dim`, `hi`) → les 8 ad hoc rentrent dans 7 tokens.
P1 — **Composants partagés** : `ShowTransport`, `PadButton`, `StatusChip`, `SectionHeader` → tuent les 5 rendus du même contrôle.
P2 — **Vue live unique** : état (haut), tir (milieu), détails repliés (bas) — fusion touch/busking/conduite.
P3 — **Tailles de base** ≥44px sur PerformView.
P4 — **Fallbacks** : erreurs visibles, conduite hors-Tauri = message utile.
