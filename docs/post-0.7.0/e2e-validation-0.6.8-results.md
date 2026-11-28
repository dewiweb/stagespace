# Résultats validation e2e des fixes UX 0.6.8

> Écrit le 2026-11-27 en fin de session de validation (browser piloté, bridge
> `dev_bridge-0555e6d1cd90251c.exe` + vite :5174). Suite de
> `e2e-validation-0.6.8.md`. Verdict par chantier du tableau §3, puis
> findings hors-critères et notes de seeding corrigées.

## Verdicts par chantier

| Chantier | Verdict | Preuve |
|---|---|---|
| **U9+U3** arm+audition | ✅ VALIDÉ | Clic row « 2 E2E-BRAVO » en conduite → `armedCueId='e2e-2'` dans le store, row outline (ring amber), NEXT passe de « 1 E2E-ALPHA » à « 2 E2E-BRAVO », radar d'audition rendu au centre (`.w-72 svg`) avec les 2 fantômes cue aux positions seedées {(0,-3),(3,0)}. Captures session. |
| **U9 cross-surface** | ⚠ PARTIEL — finding F1 | L'arm est bien visible cross-surface dans le **CuelistPanel** jeu (row BRAVO highlightée + audition radar inline, même `armedCueId`) et le menu Show conduite affiche `CUE GO — fire "E2E-BRAVO"`. MAIS la **top bar jeu** affiche `CUE —→ 1 E2E-ALPHA` (suivante séquentielle) : `PerformView.tsx` ne lit jamais `armedCueId` (`nextCue = cues[currentCueIndex + 1]`), alors que son tooltip annonce « cue suivante (armée) ». |
| **U14** log | ✅ VALIDÉ | Log conduite : `Soundcheck`, `Park`, `Attention` (chemins GUI menus), `Spatial(1.79…) 127.0.0.1:49218` (provenance OSC avec adresse contrôleur), `Gesture ×3` — badge ×N confirmé après 3 clics EXPLODE consécutifs. Labels humanisés (pas de `doX`). |
| **U4** toasts | ✅ VALIDÉ | `getBoundingClientRect()` : bottom = **exactement 64px** du viewport (innerH 936, rect.bottom 872). Cap 3 visibles confirmé, indicateur « +2 more… » pour 5 poussés. Statusbar télémétrie jamais recouverte. |
| **U2** soundcheck menu | ✅ VALIDÉ | Hors sonde : « Soundcheck: start — ping each track » actif, next/previous grisés. Pendant : « Soundcheck: STOP — sonde en cours », next/previous actifs (blanc). Présent en jeu ET en conduite (la note §4.2 du handoff « absentes du menu conduite » est périmée — `soundcheckEntries` est dans les deux branches du MenuBar). |
| **U11** trackpos | ✅ VALIDÉ | Clic droit objet radar → menu « OBJECT 1 » : « Set origin here — obj 1 » présent, actif (position émise dispo). « Paste position » correctement grisé (rien copié). |
| **U6** legend radar | ✅ VALIDÉ | États simultanés obj 0=park / 1=move / 2,3=freeze. DOM : park `fill:#ec4899` plein, freeze `fill:none;stroke:#ec4899` hollow — même famille pink assumée (doctrine « stase »), distinction par le remplissage. La légende applique exactement le même style que les points (code + rendu concordants). |
| **U15** slider spatial | ✅ VALIDÉ | `/stagespace/spatial 1.8` en UDP sur :8001 (script node, encodage OSC manuel) → slider `×1.80` + `value=1.8` en ~1s. Plus figé à 1. |
| **U1** orphelins | ✅ VALIDÉ | Move `mv-e2e-orphan-1` activé directement en backend via `POST /invoke activate_move` → chip « +1 ⚠ re-attach » top bar jeu. Clic → slot coquille créé : `movementId` repris, nom `E2E-OrphanCircle` et tracks [1,2] du MovementInfo backend, `graphJson` null assumé. Chip disparu après re-attach, pad LIVE contrôlable. |

**Score : 8/9 validés, 1 partiel (U9 cross-surface — finding F1).**

## Findings hors-critères

- **F1 (U9, résiduel)** — La top bar jeu ne reflète pas la cue armée :
  `PerformView.tsx:103` calcule `nextCue` purement séquentiel et ne lit
  jamais `armedCueId`. Le tooltip « cue courante / cue suivante (armée) »
  promet le contraire. Un CUE GO tirerait BRAVO pendant que la barre
  annonce ALPHA — le piège M4 que la conduite a corrigé, encore présent
  en jeu. Fix probable : même ligne de sélection que `ConduiteView` (`armed ?? sequential`).
  Nuance : la divergence armée-vs-séquentielle est un chantier connu de
  l'audit (§restant : « Shift+Enter tire la cue séquentielle, pas l'armée »)
  pour les chemins de *recall* (RECALL ▶ du cuelist = `doCueNext`,
  séquentiel aussi). Mais l'affichage top bar n'est pas un chemin de
  recall — c'est une lecture d'état, et `ConduiteView` a déjà tranché
  cette lecture en faveur de l'armée.
- **F2 (mineur)** — Log conduite : l'auto-scroll n'engage que si l'opérateur
  est déjà à <60px du bas. À l'arrivée sur la surface avec un log pré-rempli,
  la vue reste figée en haut (scrollBottom mesuré : 400px) — les entrées
  récentes sont invisibles sans scroll manuel. En live continu ça se
  comporte bien (le flux part du bas), mais après un switch de surface la
  reprise est froide.
- **F3 (cosmétique)** — L'entrée de log OSC spatial affiche la précision
  f32 brute : `Spatial(1.7999999523162842)`. Un arrondi à 2 décimales
  suffirait.
- **F4 (observation)** — La dédup du store toast (`message` identique →
  push silencieusement droppé) rend le groupement ×N du `ToastContainer`
  inatteignable : deux toasts de même message ne peuvent jamais coexister
  dans le store. Défense en profondeur ou code mort — à trancher ; hors
  critères du handoff (la dédup elle-même fonctionne).
- **F5 (comportement backend, hors scope frontend)** — Sans move actif,
  aucune position ne sort : `global-positions` ne coule pas,
  `get_emitted_positions` est vide même avec des positions manuelles
  posées — la boucle merge semble ne tourner que lorsqu'un move est
  enregistré. Conséquence e2e : le radar ne montre les objets manuels
  qu'une fois un move lancé. À vérifier côté rust-engines si c'est
  intentionnel (économie CPU) ou un trou d'émission.

## Corrections au handoff (§2/§4) pour la prochaine session

1. **`setManualPosition` ne seede PAS le radar** — c'est le slice
   holProject (local-only) ; la vérité est backend et le poll perf
   l'écrase en ~1.5s. Utiliser `POST {bridge}/invoke` :
   `{"cmd":"set_manual_position","args":{"objectIndex":0,"position":[x,y,z]}}`
   (args camelCase — même format que le shim frontend).
2. **Activer un vrai move est simple en fait** — pas besoin du CLI ni de
   drag'n'drop : `activate_move` via `/invoke` avec un graphe template du
   CLI (`cli/graph_presets.rs` : Objects→Circular→Output). Payload complet
   dans `.scratch/e2e/activate-move.json` si régénéré. Un id `mv-*` non
   rattaché à un slot = orphelin instantané pour U1.
3. **OSC externe testable en local** — UDP 8001, encodage à la main
   suffit (28 bytes pour `/stagespace/spatial` + float). Script :
   `.scratch/e2e/send-osc.js` — ⚠ Git Bash mangle `/stagespace/...` en
   path Windows sans `MSYS_NO_PATHCONV=1`.
4. **La shape cue du §2 est approximative** — il manque `moves: []`
   (requis par le type) et `scope` attend `positions`/`moves` (pas
   `position`/`move` — toléré par les `!== false` mais autant être exact).
5. État laissé en fin de session : 2 moves orphelins actifs (circle +
   lissajous), obj 0 parké, stase attention sur obj 1, k spatial 1.8.
   Reset complet : PANIC (Esc) + `/stagespace/attention/clear` +
   `/stagespace/spatial 1.0`, ou redémarrage du bridge.
