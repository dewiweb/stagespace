# Plan de développement — mix orienté objet

Issu de `docs/spatial-object-mixing-study.md` + `docs/conduites/` (spec
d'acceptance). Structuré sur les **trois phases du travail de l'opérateur** :

- **A. Mise en boîte** — composer/préparer la conduite (avant le show)
- **B. Conduite** — faire avancer le show (GO, TC, surveillance)
- **C. Jeu live** — interagir avec les objets pendant (busking, tracking,
  gestes)

Estimations : S < 1 j · M = 1–3 j · L = 3–7 j · XL > 1 sem.

---

## AXE A — Mise en boîte de la conduite

*Composer le show : scène, trajectoires, cues, répétition.*

### A0 — Fondation (existant solide)
Import .hol / `trackpos`, graphe compilé, preview/sample de trajectoire,
formations, cue store/scopes/modes, dry-run, zones, OSC-IN mappings.

### A1 — Outils d'écriture manquants

| Item | Quoi | Justification | Effort |
|---|---|---|---|
| A1.1 | **Soundcheck walk** — ping séquentiel par track | B 00, repère universel | S |
| A1.2 | **Audition de cue** — prévisualiser l'image sans émettre | A — "à quoi ressemble cue 3" | M |
| A1.3 | **Trajectory library** — gestes catalogués (approach/orbit/scatter/loom/ribbon/bloom) | Peters/Smalley taxonomy | M |
| A1.4 | **Distance reality layer** — pos→gain/air-EQ/reverb-send auto | Zahorik ×0.7, DRR, Begault | M |
| A1.5 | **Perceptual meters** — legibility/looming/vection par move | MAMA, Neuhoff, Riecke | M |
| A1.6 | **Diffusion score view** — partition temps×zones×gestes | Vande Gorne — composition | L |
| A1.7 | **Rehearsal capture** — busking enregistré → cue rejouable | le live devient mémoire | M |
| A1.8 | **Binaural bounce** — show→écoute à distance | répétition sans salle | L |
| A1.9 | **Auto-venue adaptation** — même conduite, géométrie différente | touring — **différenciateur #1, personne ne le fait** | XL |

### A2 — Ordre dans l'axe
`A1.1` (trivial, repère) → `A1.2` (audition — bloque la confiance de
composition) → `A1.5`/`A1.4` (mètres + réalisme perceptuel) → `A1.3` → `A1.7`
→ les lourds (`A1.6`, `A1.8`, `A1.9`).

---

## AXE B — Conduite (faire avancer le show)

*Le GO : cue chain, TC, surveillance — ce que l'opérateur regarde.*

### B0 — Existant
cue chain (next/prev/recall/go), feedback OSC `cue/current`/`next`, TC chase,
panic, `isRecalling`/busy NACKs, scopes Tracking/Full, pre_wait/follow.

### B1 — La tour de contrôle

| Item | Quoi | Justification | Effort |
|---|---|---|---|
| B1.1 | **Santé des flux** — PSN/TC/OSC : age trame, lock, error rate — bandeau permanent | C, D — flux coupé = mort silencieuse | S-M |
| B1.2 | **Confidence view** — emitted-vs-commanded en GUI | listener intégré | M |
| B1.3 | **Log opérationnel** — historique horodaté (GO/recall/NACK/slot) | D — "qu'est-ce qui s'est passé" | S-M |
| B1.4 | **Media sync out** — cue→trigger lumière/vidéo dédié | D — sync média | M |
| B1.5 | **Radar 2D fixe** — plan de conduite lisible + marquage source | A,B,C,D | M |

### B2 — Ordre
`B1.1` + `B1.3` (S, jumeaux) → `B1.2` → `B1.5` → `B1.4`.

---

## AXE C — Jeu live (interagir avec les objets)

*L'instrument : pads, tracking, gestes, reprises — ce que l'opérateur joue.*

### C0 — Existant
slots busking + solo/unsolo, park, positions manuelles, `hold`/`anchor` —
la sémantique continue ✓ livrée.

### C1 — L'interaction manquante

| Item | Quoi | Justification | Effort |
|---|---|---|---|
| C1.1 | **`anchor:follow`** — ancre dynamique sur cible mobile | C 04, D 05 — orbit autour de l'acteur | M |
| C1.2 | **PSN/RTTrP ingest** — tracking industrie | C, D — follow performer pro | L |
| C1.3 | **Source-de-contrôle par objet** — move/manuel/PSN/park/hold visible | LE manque ergonomique | M |
| C1.4 | **Surface de jeu** — grille pads (états, holds, gros GO/panic) | B, D — l'instrument | L |
| C1.5 | **Grab & throw** — impulsion → inertie | geste live | M |
| C1.6 | **Position gestures** — "all-to-front"/"explode"/"orbit-audience"/"loom" en un OSC | busking rapide | S-M |
| C1.7 | **Attention orchestration** — "un seul bouge" auto | change blindness | M |
| C1.8 | **Spatial dynamics** — compression énergie spatiale | 4DSOUND | L |

### C2 — Ordre
`C1.1` + `C1.2` (les 2 trous qui bloquent les conduites trackées) → `C1.3`
(lecture du modèle — conditionne `C1.4`) → `C1.4` → gestes (`C1.5`/`C1.6`) →
`C1.7`/`C1.8`.

---

## Jalons

| Jalon | Contenu | Conduites débloquées |
|---|---|---|
| **J1 — Conduites jouables** | C1.1, C1.2, B1.1, A1.1 | C, D au listener avec suivi réel |
| **J2 — Tour de contrôle** | C1.3, C1.4, B1.2, B1.3, B1.5 | B, D jouables d'une surface — sans l'éditeur |
| **J3 — Composition complète** | A1.2, A1.4, A1.5, A1.3 | A mise en boîte sans retour en salle |
| **J4 — Différenciation** | A1.9, A1.6, C1.7, C1.8, A1.8 | au-delà du marché |

## Dépendances

```
C1.1 (follow) ─┐
C1.2 (PSN) ────┼─→ J1 — C/D cue-04/05/tracking
B1.1 (santé) ──┘
C1.3 (source-contrôle) ─→ C1.4 (run-view) + B1.5 (radar) ─→ J2
A1.2 (audition) ─→ J3 — confiance de composition
```

## Règle de gouvernance

Chaque item répond à une **conduite** (les 4 docs) ou à un **fondement de
bibliographie** — pas de feature "parce que cool". Critère global : les 4
conduites jouables bout-à-bout au listener, dans les 3 phases.
