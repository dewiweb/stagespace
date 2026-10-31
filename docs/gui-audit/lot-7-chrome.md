# Lot 7 — Chrome et monitoring (audit complet)

`performMode` dans `useMoveEditorStore` (défaut **`true`** — l'app boote en
live, `:264`) ; toggle header `App.tsx:203-217` ; `showExpert` `:218-229`
(seulement si `!performMode`).

## 1. `components/Toolbar.tsx` (176 l.)

Barre d'actions **édition seulement** (`App:242`, ternaire `!performMode`).

Une ligne : Import `.hol` primaire `bg-blue-700` + chip `{n} tracks` vert ;
divider ; chip OSC → SettingsModal (`OSC out` 11px + addr:port mono +
profile) ; `OscArmToggle` ; undo/redo `IconButton` ; save/load `.hfg` ;
spacer ; Help ; `PanicButton` ; bandeau erreurs `bg-red-950/30`.

- **5 langages de boutons dans une même ligne** : primaire custom,
  chip-button, OscArmToggle, IconButton, PanicButton — aucune uniformisation.
- **Duplication erreurs** : bandeau (166-171) et pill StatusBar:89-98
  affichent les mêmes `compileError`/`playError` simultanément.
- **Duplication destination OSC** : chip (112) + StatusBar:104 + SettingsModal — 3 endroits.
- Undo/redo commenté « expert » mais visible en Simple aussi.
- `text-[11px]` ad hoc, icônes 13 vs 14, couleurs non-token (`bg-blue-700`,
  `text-green-400`).
- Import `.hol` proéminent en permanence alors que c'est du setup one-shot ;
  seul retour d'état = chip vert transitoire.
- Mélange édition/live/monitoring sans segmentation.

**Verdict : mélange sans hiérarchie + duplications. Haute priorité —
restructurer en zones fichier/projet/live-safety.**

## 2. `components/StatusBar.tsx` (113 l.)

Console de monitoring **persistante dans tous les modes** (`App:498`, voulu).

`footer h-7 text-xs` : dot statut (green live/yellow pulse compiling/red
error/blue compiled/gray idle) ; bloc perf si `activeCount>0` : FPS
(55/30), osc/s, %cpu, `merge` µs (2000/8000), `lock` µs (100/500), badges
`OSC SUSPENDED`/`MERGE DEAD` pulse ; pill erreur dismissable ; `→ addr:port`
mono ; `v{__APP_VERSION__}`.

- **F16 — Télémétrie dev exposée live** : `mergeFrameUs`/`mergeLockUs` avec
  tooltips "budget 16.6ms"/"contention" en première ligne permanente pendant
  le play — `debugPerfVisible` existe mais le bloc perf n'y est pas gaté.
- **État ARM OSC absent** : `oscSuspended` affiché mais pas arm/disarm —
  LA métrique de sécurité live manque au poste de surveillance (dry-run
  silencieux possible).
- Seuils magiques hardcodés en JSX (55/30, 0.05, 50%, 2000/8000, 100/500) —
  non centralisés.
- Conversion µs→ms dupliquée 2× inline.
- Vocabulaire moteur en clair : `Compile:`, `merge`, `lock`, `MERGE DEAD`.
- Pill erreur = duplication du bandeau Toolbar en édition.
- Permanent raisonnable : dot + destination + version — mais il manque ARM.

**Verdict : télémétrie dev au premier plan live + état ARM absent. Haute
priorité — split user/debug + indicateur arm/disarm permanent.**

## 3. `components/AudioPanel.tsx` (214 l.)

Config + monitoring capture audio-in, `App:479` colonne droite, dans une
**section collapsible App** "AUDIO IN" (`audioExpanded`, `ss-layout-*`,
défaut `false`), `max-h-[40%]`.

Header interne : dot pulse + titre + mini-barre RMS cyan + BPM cyan +
chevron `▸/▾` texte ; corps : select device (disabled listening), card
Status, 4 bars RMS/Bass/Mid/High, card BPM+confidence, `SpectrumView` canvas
220×60 48 bins `hsl(200…280)`, bouton Start/Stop.

- **Double collapse** — défaut majeur : App rend "AUDIO IN ▸" qui monte
  AudioPanel re-rendant "● Audio Input ▾" — deux headers, deux chevrons
  (`ChevronRight` vs `▸`), deux intitulés → 2 clics pour voir les contrôles.
- **`h-15` n'existe pas en Tailwind v3** (211 — échelle h-14/h-16, pas
  d'extension config) — classe morte ; le canvas garde 60px d'attribut mais
  `w-full` l'étire → spectre déformé non-uniformément. F14.
- Card Status redondante (96-106) — duplique dot header + bouton.
- `mt-auto` sans effet (parent scrollable sans hauteur fixe).
- Erreurs sur 2 canaux : `error` local (corps ouvert) + toast App.
- Couleurs ad hoc bandes `blue/red/green/yellow-500`, `hsl()` inline.
- `audioExpanded=false` démonte tout → la capture continue (voulu) mais
  **aucun indicateur de niveau ne survit** — le mini-RMS header est tué par
  le wrapper App.

**Verdict : double collapse (2 clics) + `h-15` morte. Haute priorité —
supprimer le collapse interne, garder celui d'App avec header résumé +
indicateur de niveau persistant.**

## 4. `components/ModeButtons.tsx` (74 l.)

Toggles modes d'interaction flottants — monté `Scene3D:400-405` (edit-only).

Conteneur `absolute bottom-2 left-2 z-overlay` : Manipulate `bg-blue-600`
actif / ghost ; Assign `bg-green-600` ; Draw conditionnel `hasDrawableNode`
(DrawSpline/Evaluate/Trim/Offset + `VectorField field==='drawn'`, 22-31) ;
banner manipulate top-center cheatsheet ; `if (drawMode) return null` (33).

- **`hasDrawableNode` duplique la liste spline** — même liste
  `objectsNodeSync.ts:15` ; devrait être une constante partagée.
- **4 copies du banner top-center** : ici (66-70) + Scene3D:380 (Assign),
  387 (Place), 394 (Edit) — même position/styling, 4 implémentations.
- **`return null` en drawMode** : plus aucune affordance pour quitter Draw
  sauf Esc/DrawModeOverlay — le bouton qui a lancé le mode disparaît. F15.
- Props/store asymétriques : manipulate/assign en props, draw en store.
- Banner manipulate : une ligne dense de 4 gestes, `text-xs`, **pas de
  mention Esc** (les banners zone disent "Esc to cancel").
- Hit targets ~22px (`px-2.5 py-1`, icônes 11px).
- Couleurs ad hoc `blue-600`/`green-600` vs `IconButton` non utilisé.

**Verdict : banner quadruplé + liste spline dupliquée + aucune sortie de
draw au clic. Moyenne — extraire `ModeBanner`, `DRAWABLE_NODE_TYPES`,
bouton Exit Draw.**

## Transversal lot 7

- **S13 — Vocabulaire des modes** : "PERFORM" (vert) / "Atelier" / "Simple"/"Expert"
  — 3 noms pour 2 modes ; le bouton affiche l'**état courant** comme libellé
  du toggle vers l'autre — sémantique ambiguë.
- **S14 — Duplications transverses** : erreurs ×2 (Toolbar×StatusBar),
  destination OSC ×3, collapse audio ×2, spline list ×2, banners ×4.
- Palette entièrement ad hoc (`blue-600/700`, `green-400-600`, `cyan-400/500`,
  `red-900/60`) malgré les tokens quasi inutilisés hors `bg/panel/border`.
- `z-overlay` token bien utilisé partout — seule discipline token réelle.
