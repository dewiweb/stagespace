# Refonte GUI v2 — plan post-review approfondie

Remplace `gui-refactor-plan.md` (obsolète) — écrit sur review complète du
code à `cf4749a`+ , toutes dimensions : structure, flux de données, état
detaché, code mort, couverture tests, style.

## État réel vérifié (constats, pas opinions)

### Structure

| Surface | Contenu | Trou |
|---|---|---|
| **ATELIER** | 3 col : [Show:Moves/Cues/FX + Templates] · [3D/NodeEditor] · [Inspector/Audio] | layout sain — CuelistPanel = 6 métiers |
| **CONDUITE** | ConduitePage (Now/Next/transport/TC) | **display-only** : pas de cue list, arm, log, santé → impossible de conduire |
| **JEU** | PerformView (setlist+pads+drawer+busking) | diverge de RunView détaché (pads+radar+gestes) — instrument coupé en deux |

### Duplications mesurées

- **Cues ×3** : CuelistPanel (écriture+arm+transport+audition),
  PerformView (colonne cues+recall), ConduitePage (display) — aucune
  complète pour sa phase
- **Sécurité live Atelier-only** : panic+arm+santé+backend-mort visibles
  uniquement en Atelier — invisibles où le show tourne
- **Overlays PerformView** : `buskingMode` reste le dernier `absolute
  inset-0` interne (touchMode déjà supprimé)
- **Score/tape** dans CuelistPanel (panneau d'écriture) — leur métier
  est la répétition/conduite
- **Log** dans CuelistPanel — invisible hors Atelier

### Flux de données

- **Hooks globaux montés dans AppMain** (useShowControl, liveShortcuts,
  conduiteBroadcast, listeners) — présents sur toutes les surfaces ✓
- **Fenêtres détachées** = instances zustand propres :
  - `conduite:state` broadcast 500ms + `conduite:cmd` → main dispatche
  - MAIS les slices polleurs (perfSlice intervalle module) tournent
    **dans chaque fenêtre** → N fenêtres = N× charge de poll backend
  - `?view=run` n'a ni useShowControl ni conduite:cmd (invoke IPC direct
    — fonctionne, mais pas de dispatch OSC, pas de log partagé)
- **Fenêtre détachée = display+commande, jamais owner** — à figer comme
  règle (l'arm/store/modifs vivent dans la fenêtre maître)

### Dette mesurée

| Dette | Volume |
|---|---|
| Ad-hoc colors (6 fichiers live) | ~112 : PerformView 47, StatusBar 19, SettingsModal 17, CuelistPanel 16, RunView 10 |
| Fichiers >400 lignes | 9 : PerformView 1017, NodeEditor 686, Inspector 647, MovesTable 617, SpatialFxPanel 615, CustomNode 589, CuelistPanel 570, SettingsModal 496, Scene3D 494 |
| z-index numériques | 0 (déjà propre) |
| `oscSlice` mort | aucun consumer — à supprimer |
| Tests | 7 fichiers seulement — PerformView, CuelistPanel, RunView, liveActions, useShowControl (le dispatch live!) : **zéro couverture** |
| useEffect | sain (2-5/fichier) — la discipline poll-slice tient |

## Analyse attendu vs effectif — là où l'interface promet plus qu'elle ne tient

| Attendu | Effectif | Écart |
|---|---|---|
| Conduire depuis CONDUITE | `cmd('prev/go/next/panic')` seulement — pas de cue list, pas d'arm → GO existe mais on ne choisit pas ce qu'on GO au-delà de Now/Next | la surface promet la conduite, livre le display |
| **Unsolo** "restaure" | restaure `soloSavedIds` (capturé au solo) — les slots joués PENDANT le solo ne sont pas repris → restore partiel si l'opérateur a joué entre-temps | promesse de round-trip, livre une photo |
| **Audition** "à quoi ressemble cue 3" | radar de `manual_positions`+`origin` — les objets **sous move** bougeront (trajectoires, pas positions) → l'image statique omet le contenu animé de la cue | l'audition montre le repos, pas le mouvement |
| **Pad** = joue | `movementId` = vrai état backend ✓ mais reste "playing" pendant le fade-out et même si le spawn a échoué (id posé jusqu'au stop) | état vrai mais non granulaire |
| **"émis"** tooltip | = dernier envoyé, pas reçu/ack par le renderer | corrigé en libellé, la confusion reste dans les attentes |
| **Perceptual** 5°/s warning | valeurs vraies, mais le seuil "illisible" est arbitraire et non calibré à la salle — risque de chip bruitée | vérité technique, utilité UX non prouvée |
| **Settings** toggles | envoient la config au backend — pas de feedback d'acceptation réelle (sauf revert-on-error du slice) | fire-and-forget masqué par un revert propre |
| **Solo/park/hold chips** | `objectStates` backend = vraie source ✓ (pas d'inférence) | correct — à garder comme référence |
| **Track colors** | une couleur = une track, cohérent entre radar/chips/3D | correct |

## Analyse architecture globale — les vraies questions

| Question | État | Risque |
|---|---|---|
| **Store par fenêtre** = zustand indépendant + localStorage partagé | deux fenêtres éditent la même config → last-write-wins silencieux | divergence silencieuse de config (venue/PSN/reality en double) |
| **`conduite:` master→conduite seulement** | RunView détaché n'a ni `conduite:cmd` ni broadcast dédié — invoke direct | schéma pair-à-pair incohérent par fenêtre |
| **`useGraphStore` god-store** (15 slices) | toute surface lit tout — couplage implicite entre métier et surface | une erreur de slice casse toutes les surfaces |
| **`liveActions` injecté par codegen regex** (`logAction`/`rec`) | l'injection sédimente — casser une signature casse le log/tape | pattern fragile qui survivra mal aux refactos |
| **N fenêtres = N× poll** | perfSlice intervalle par fenêtre | charge backend multipliée, non plafonnée |
| **`conduite:state` computed in main** | Now/Next = store de la fenêtre maître — correct si seule la maître est owner | dépend du fait que la conduite détachée n'édite pas — à figer |

## Pertinence des layouts — composant par composant

| Composant | Métier vrai | Pertinence | Verdict |
|---|---|---|---|
| Toolbar | fichier/undo/save/load/help/panic | panic y est mal placé (Atelier-only) | garder les items fichier, PANIC part en SafetyBar |
| StatusBar | moteur+arm+flux+perceptuel+perf+erreurs+OSC-dest | tout est bien mais Atelier-only | splitter : sécurité → SafetyBar global, perf/erreurs reste |
| CuelistPanel | cues + score + tape + log + audition + transport | 6 métiers | découper : cues+audition → Atelier ; arm+GO+log → Conduite ; score/tape → Répétition |
| PerformView | pads+setlist+drawer+busking+chips | l'instrument, mais sans radar/gestes | absorber RunView — un seul instrument |
| RunView | pads+radar+gestes+transport | l'instrument léger, détaché | variante du même composant, pas un autre |
| ConduitePage | Now/Next+transport+TC | le display FOH | + cue list armée + log pour être la surface |
| SettingsModal | config 16 sections | monolithe | tabs par domaine |
| MovesTable | gestion moves | sain, un métier | reste |
| Inspector | params move/node | sain, un métier | reste |
| SpatialFxPanel | zones/modulations | un métier mais home = tab secondaire | peut rester en tab ou être promu |
| AnimationList | library/presets | sain | reste |
| Scene3D | canvas 3D + draw modes | sain | reste |
| AudioPanel | capture audio config | sain, replié | reste |

## Le modèle cible — une phase = une surface complète

### R0 — SafetyBar global (PRIO 1)

`SafetyBar` extrait de StatusBar : PANIC + arm LIVE/DRYRUN + PSN + OSC
activity + perceptuel + backend-mort → footer **app-level, toutes
surfaces**. La sécurité du show ne doit jamais dépendre de la phase.

### R1 — CONDUITE opérable (PRIO 1)

ConduitePage devient la surface de conduite réelle :

```
┌──────────────┬──────────────────────────┐
│ Cuelist      │ Now géant · Next · then  │
│ (arm+GO+     │ TC · transport           │
│  audition)   │                          │
├──────────────┴──────────────────────────┤
│ Log opérationnel                        │
└─────────────────────────────────────────┘
```

- CuelistPanel prop `variant="conduite"` : arm/GO/audition/log, sans
  score/tape/écriture
- Log sort de CuelistPanel → ligne dédiée en bas de surface

### R2 — JEU : un seul instrument (PRIO 1)

Fusion PerformView+RunView : pads+radar+gestes+sources+transport+drawer
replié. La radar+gestes migrent dans PerformView ; `?view=run` devient la
variante detached du même composant (prop). buskingMode → variante de
densité des pads, plus un overlay.

### R3 — ATELIER : un métier par panneau (PRIO 2)

- CuelistPanel prop `variant="compose"` : écriture+scope+audition
- Score/tape → panneau "Répétition" dédié (Atelier) ou Conduite
- Log partagé (même composant, monté en Conduite ET accessible Atelier)

### R4 — SettingsModal : 16 sections → 5 tabs (PRIO 2)

Connexion (OSC out/in/profils) · Tracking (PSN) · Espace (venue+reality+
merge) · Show (media+TC) · Audio. Contenu inchangé, navigation par domaine.

### R5 — Hygiène + tokens (PRIO 3, continu)

- Supprimer `oscSlice` (mort)
- Tokens de rôle tailwind (live/conduite/osc/warning/danger/tracking/dim)
  — les 112 ad-hoc migrent par fichier touché (PerformView 47 d'abord)
- buskingMode → densité pads (supprime le dernier overlay interne)
- floor `text-[10px]` en surface live (supprimer 8px/9px)

### R6 — Couverture tests (PRIO 2 pour la fiabilité)

| Cible | Tests à écrire |
|---|---|
| `liveActions` + dispatch `useShowControl` | le chemin live critique — show-control event → invoke attendu |
| `CuelistPanel` variants | arm/GO/audition/score strip |
| `PerformView`/`RunView` | pads, gestes, source chips |
| `SettingsModal` | sections persistées |
| **Poll multi-fenêtres** | N windows ne doivent pas N-multiplier le poll backend (dedup ou broadcast) |

## R7 — Fenêtres détachées : le modèle figé (PRIO 2)

- Une fenêtre détachée = display+commande, jamais owner de vérité
- Polls dedupliqués OU état reçu par broadcast (comme conduite:state) —
  sinon 3 fenêtres = 3× le poll IPC backend
- `?view=run` rejoint le schéma conduite:state/cmd partagé

## Actions issues de l'analyse attendu/effectif

| Écart | Action | Où |
|---|---|---|
| Conduite = display | cue list + arm + log dans la surface | **R1** |
| Unsolo partiel | capture `soloSavedIds` à l'unsolo (ou documenter "restore = photo au solo") | R2 + backend |
| Audition = repos | libeller "positions au recall" honnêtement ; extension future = trajectoires simulées | R3 |
| Pad non-granulaire | `playing` vs `fading`/`spawn-failed` états distincts | R2 |
| Perceptuel arbitraire | seuils documentés + option désactivation | Settings |
| Config multi-fenêtres | fenêtre détachée = lecture seule sur config (règle figée) | **R7** |
| Settings fire-and-forget | indicateur d'acceptation backend par toggle | R4 |

## Ordre

```
R0 SafetyBar ─┐
R1 Conduite  ─┼─→ le show tourne sur ces deux
R2 Jeu       ─┘
   ↓
R3 Atelier · R4 Settings · R6 tests · R7 détaché
   ↓
R5 hygiène continue
```

## Hors scope

- A1.6 vue partition (reportée)
- Réécriture autorisée si nécessaire (décision utilisateur) — NodeEditor,
  Scene3D, Inspector inclus ; la règle reste : on réécrit pour une raison
  structurelle, pas par esthétique
- Pas de redesign cosmétique — structure + cohérence, le look suit les
  tokens

## Critère de fin

1. Panic/arm/santé visibles partout, tout le temps
2. Show complet conduit depuis CONDUITE sans quitter la surface
3. Instrument entier jouable depuis JEU (`?view=run` = variante, pas
   nécessaire)
4. Un métier identifiable par panneau
5. Tests sur les chemins live (dispatch, cues, gestes)
6. Fenêtres détachées sans N× poll
