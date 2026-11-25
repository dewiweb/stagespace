# Audit ergonomie & tactile — audit terrain par captures + test end-to-end

Audit visuel réalisé sur captures réelles (1600×900) des 4 surfaces +
simulation de taps contre le **dev bridge** (backend réel, MockRuntime,
`127.0.0.1:4173`, frontend Vite `?bridge=`). Complète `gui-audit.md` et le
chantier couleur (`color-harmonization.md`).

## Méthode

- Captures `/tmp/shots/v*` : v1c-score, v2b-jeu, v3b-conduite, v1b/v4-atelier
- Mesures DOM `getBoundingClientRect` (tailles réelles des cibles)
- Simulation taps : `PointerEvent(pointerdown/up, pointerType:touch)` +
  `click`, vérification d'état via `window.__live` stores
- Backend réel via bridge : `store_cue`, `recall_cue`, `set_gesture`,
  `set_global_osc_ids`, panic — tous exécutés pour de vrai

## Références ergonomie console (benchmark)

| Console | Convention retenue |
|---|---|
| grandMA3 | non-sélectionné à intensité réduite ; pads saturés + label gras |
| ETC Eos | PSD : courant | prochain | urgence ; texte coloré = état |
| Lawo mc² | couleurs sémantiques de canal ; button-glow basse lumière |
| Tactile | cible ≥44px (HIG/Material), critique live ≥56px, PANIC ≥64px isolé |

## ✅ Points forts vérifiés

- Surfaces cohérentes : 4 onglets colorés stables (Jeu/Score/Conduite/Atelier)
- Status bar persistante (PANIC/Idle/LIVE/BACKEND)
- Conduite = référence interne : hiérarchie NOW/NEXT, IDLE honnête,
  CUE GO ~195×80px = gabarit exemplaire, « CLICK ARM · DBL-CLICK RECALL » explicite
- Architecture pointer events partout + `setPointerCapture` = tactile-natif
- SlotTile = press-hold (le bon pattern, pas de double-tap forcé)
- Toasts groupés bas-droite, messages exploitables

## ⚠️ Frictions mesurées (ordre de gravité)

### 1. PANIC dilué — hiérarchie de sécurité incohérente
Trois PANIC coexistent : Conduite ~130×80 (correct), Jeu haut 125×48
(limite), Jeu statusbar 57×20 (doublon dangereux — taille d'un badge).
Un seul PANIC, ≥64px, position fixe identique partout.

### 2. Cibles sous le minimum tactile (mesures DOM réelles)

| Contrôle | Taille | Verdict |
|---|---|---|
| CUE GO (Conduite) | ~195×80 | exemplaire |
| PLAY / SETLIST | 140-178×57 | OK |
| PANIC haut (Jeu) | 125×48 | limite |
| Gestes EXPLODE…ATTN | ~97-125×40-58 | borderline |
| Lignes cue | ~51 | OK |
| `★ Store` | 71×32 | insuffisant |
| `⚡` (favori cue) | 35×32 | trop petit |
| `RECALL` | 84×32 | insuffisant (destructif) |
| Radar top/front/side | 30-39×34 | trop petit |
| Onglets drawer | ~30 | trop petit |
| PANIC statusbar | 57×20 | doublon à supprimer |

### 3. Chevauchement layout — zone morte réelle
Sur Jeu, la **2e ligne de la cuelist est recouverte par la barre d'onglets
du drawer** (« Live Params/Playback… ») : `elementFromPoint` retourne le
drawer sur toute la largeur de la row → intappable, souris incluse.
Bug confirmé en test end-to-end.

### 4. Vide noble / travail comprimé
Jeu : grille PADS vide au centre, transport+gestes+cuelist tassés.
Atelier : double empty state (« No move configured » + « No move running »),
canvas ~50% de l'écran pour du vide.
Score : dopesheet ~40% de hauteur pour ~30 points épars ; timeline comprimée.

### 5. Barre supérieure Jeu = fourre-tout
Identité + état + cue courante/suivante + position score + chips clips
tronquées + LIVE + PANIC sans groupement visuel. Manque la séparation
PSD : courant | prochain | urgence.

### 6. Densité timeline Score
16 clips CONDUCTOR se chevauchent, labels tronqués (« STO »).
Pas de collision-handling (empiler/paginer/zoom requis).

### 7. Micro-affordances
- `fin de setlist` : texte dim ambigu (info ? action ?)
- Aucun hint de shortcut près des actions (« Enter = GO » sous CUE GO)
- Labels ~10px partout — limite pour lecture à un bras en régie

## Test tactile end-to-end (bridge, backend réel)

| Action au tap | Résultat |
|---|---|
| `★ Store` | cue créée via `store_cue` réel — ×2 OK |
| `RECALL` | `recall_cue` exécuté — « graph restored and replayed », move spawné |
| `PANIC` | panic réel — moves stoppés + resets (échecs OSC = headless, pas l'UI) |
| row cue | anneau d'arm local (garde anti-misclick) |
| nav/radar/tabs | OK |
| gestes | désactivés sans `objectStates` — comportement **correct** |

### Découvertes structurelles

- **Deux modèles « arm » distincts** : panel = `useState` local (garde
  anti-misclick avant dbl-click recall) ; store `armCue` = vrai modèle
  console (OSC `/cue/arm`, GO). Coexistent sans conflit mais le nommage
  prête à confusion — documenté ici pour éviter un futur « bug » imaginaire.
- **0 occurrence `touch-action`** dans tout `src/` — inoffensif dans le
  webview Tauri (pas de scroll-hijacking), mais à poser défensivement sur
  les zones de drag si usage navigateur distant/iPad.
- `pointercancel` géré dans 3 fichiers seulement (useDrawMode,
  SceneInteractionLayers, GraphCanvas) — les autres drags pointer le
  subiraient silencieusement.
- `dblclick` sur 4 sites (cue recall, node switch, draw, expertSplit) —
  fonctionne au double-tap mais demande de la précision ; le modèle
  arm+GO contourne le seul site live-critique.

## Couverture complémentaire (captures e1/e2b/e3)

- **Drawer Jeu ouvert (Poses)** : 8 onglets ~30px — sous le min tactile.
  Helper inline « tap a move for its params · ▷ = layer live · # in Edit =
  curate this surface » = bonne affordance. Légende dots de couleur
  cohérente doctrine (move/manual/hold/park/freeze/psn).
- **Settings modal** : structuré (tabs Réseau/Tracking/Salle/Show/Audio),
  warning auth orange honnête ; boutons Apply ~55×30 / Discover ~140×30
  petits mais surface de prépa → touch non critique.
- **Cheatsheet `?`** : modèle clavier complet, keycaps clairs, section
  « Node editor » documente les gestes fils — **mais aucun point d'entrée
  visible dans l'UI** (pas de bouton `?` nulle part : discoverability
  repose sur la connaissance du raccourci lui-même).
- **Overlap cue row / drawer** : observé à ~600px de hauteur viewport ;
  à 1600×900 les deux rows sont visibles → problème de layout responsive
  à petites hauteurs, pas permanent. Toujours un risque réel sur écran
  720p ou fenêtre réduite.

## Vue live peuplée (capture f3 — move réel, 64 objets)

L'état **live change profondément le verdict ergonomique** — en mieux :

- **Transport morphing** : `PLAY ▶` devient `STOP ■ Move 1` rouge en jeu —
  sémantique d'état exemplaire (le bouton dit ce qu'il fera)
- **`STOP ALL` apparaît seulement quand des moves tournent** — progressive
  disclosure correcte
- **Pad tile géant vert `●64·LIVE`** — glanceability maximale
- **Radar montre la trajectoire réelle** (ligne verte) — pas un gadget vide
- **Télémétrie statusbar live** : `90°/s · 60 FPS · 1921 osc/s · 6% cpu ·
  1.0ms merge · 15µs lock` — instrumentation niveau console pro
- **`editing: Move 1 ×`** : lien explicite drawer↔slot édité
- **Slot row** `#1 Move 1 LIVE 64 trk → NEXT` : état + progression lisibles
- Nouvelle friction vue live : la rangée de puces `N·move` en bas à droite
  est dense (~8 chips minuscules) — zone de statut, pas d'action, OK mais
  illisible à distance
- Toast OSC « destination unreachable » : l'UI signale honnêtement
  l'absence de spatializer — bon comportement de garde

## Recommandations priorisées

1. **P-tactile** (petit chantier, fort impact live) : gabarits 44px+ sur
   Store/⚡/RECALL/radar/tabs drawer ; PANIC unique ≥64px fixe ; gestes 48px+.
2. **Bug layout** : chevauchement cue row / drawer sur Jeu.
3. **Hiérarchie spatiale** : regrouper la barre Jeu façon PSD ; gestes en
   groupe visuel distinct sous le transport.
4. **Défensif** : `touch-action: none` sur zones de drag live (radar,
   pads, timeline) ; `pointercancel` sur tous les drags.
5. **Hors scope couleur** : collision chips Score ; dim du non-actif
   façon grandMA3 (piste notée dans color-harmonization.md).
