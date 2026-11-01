# Plan de développement — mix orienté objet

Issu de `docs/spatial-object-mixing-study.md` + `docs/conduites/` (spec d'acceptance).
Critère d'ordonnancement : **débloquer les conduites d'abord**, différenciateurs ensuite.

---

## P0 — Les deux trous qui bloquent C et D

### P0.1 `anchor:follow` — ancre dynamique
**Pourquoi** : l'orbit autour d'un objet mobile (silages, TRAVERSE) —
aujourd'hui `anchor:current` fige au spawn ; la cible bouge → l'orbit reste.
**Quoi** : lire `merge.last_position(anchor_target)` par frame au lieu de
capturer une fois → `anchor[obj] = pos_courante_cible − traj(0)`.
**Test d'acceptance** : conduite C cue 04 — orbit centré sur V1 *qui bouge*,
vérifié au listener : l'orbite suit le déplacement de V1.

### P0.2 PSN/RTTrP ingest — tracking industrie
**Pourquoi** : le protocole standard (BlackTrax/Zactrack/Follow-Me) — canal
#1 du "follow performer" pro.
**Quoi** : parser les paquets PSN (multicast 236.0.0.1:56565 par défaut) →
`/stagespace/position <obj> x y z` interne → positions manuelles lissées.
Rate-limit + kinematic smoothing existant.
**Test** : flux PSN simulé → objets suivent en douceur ; coupure → fige
propre (dernière position tenue).

---

## P1 — Outillage métier (débloque la production réelle)

### P1.1 Soundcheck walk
**Pourquoi** : repère indispensable (conduite B 00).
**Quoi** : séquence auto ping par track — position identifiable + silence →
suivante. Commande `/stagespace/soundcheck [start|stop|next]`.
**Test** : B 00 — chaque track s'identifie spatialement en séquence.

### P1.2 Source-de-contrôle par objet (ergonomie n°1)
**Pourquoi** : LE manque transverse — "pourquoi cet objet est là".
**Quoi** : état par objet (move/manuel/PSN/park/hold/track) exposé via
`get_object_states` → badge couleur dans 3D + liste.
**Test** : conduite C — l'opérateur lit d'un coup d'œil V1=PSN, M1=park,
S3=move, A9=hold.

### P1.3 Santé des flux (bandeau d'état)
**Pourquoi** : PSN/TC/OSC coupés = show mort silencieux (C, D).
**Quoi** : age de dernière trame par flux + lock TC + error rate OSC —
bandeau permanent, pas toasts.
**Test** : couper le flux PSN → indicateur rouge < 1 s.

### P1.4 Confidence view — emitted-vs-commanded
**Pourquoi** : le listener :9000 externe = gap de diagnostic intégrable.
**Quoi** : diff émission réelle vs positions GUI dans une vue debug.
**Test** : tout décalage GUI↔OSC visible en < 1 frame.

---

## P2 — Expérience opérateur (la tour)

### P2.1 Surface de jeu (Perform run-view)
**Pourquoi** : busking = instrument, pas GUI d'admin (B, D).
**Quoi** : grille pads dédiée (états playing/fading/solo'd/park'd), holds
visibles, gros GO/panic — construit sur la Conduite window existante.

### P2.2 Audition avant émission
**Pourquoi** : "à quoi ressemble la prochaine cue" (A).
**Quoi** : preview de cue — render interne sans envoi OSC.

### P2.3 Vue radar 2D fixe
**Pourquoi** : conduite = plan fixe lisible, pas caméra 3D.
**Quoi** : top-down + profil, marquage park/manual/PSN par objet.

### P2.4 Log opérationnel
**Pourquoi** : "qu'est-ce qui s'est passé" (D) — qui a GO, quand, quel NACK.

---

## P3 — Différenciateurs (au-delà de l'état de l'art)

| # | Item | Fondement | Marché |
|---|---|---|---|
| P3.1 | **Auto-venue adaptation** — conduite→géométrie enceintes réelle | touring | personne |
| P3.2 | **Legibility/looming/vection meters** | MAMA, Neuhoff, Riecke | personne |
| P3.3 | **Distance reality layer** — pos→gain/EQ/reverb auto | Zahorik, DRR | partiel L-ISA |
| P3.4 | **Spatial dynamics** — compression énergie spatiale | 4DSOUND | 4DSOUND seul |
| P3.5 | **Attention orchestration** — "un seul bouge" auto | change blindness | personne |
| P3.6 | **Diffusion score view** — temps×zones partition | Vande Gorne | personne |
| P3.7 | **Trajectory library** — taxonomie Peters | Schacher/Peters | — |
| P3.8 | **Rehearsal capture** — live→cue | workflow | — |
| P3.9 | **Binaural bounce** — show→écoute à distance | prelisten | partiel SPAT |
| P3.10 | **Media sync out** — cue→trigger lumière/vidéo | D | — |

---

## Critères globaux

- **Jouabilité** : les 4 conduites jouables bout-à-bout au listener = done
- **Règle de l'étude** : chaque feature répond à une exigence de conduite
  ou à un fondement de la bibliographie — pas de feature "parce que cool"
- **La tour** : ergonomie P2 = rendre le modèle de contrôle visible — qui
  pilote quoi, qu'est-ce qui vit, qu'est-ce qui sera touché
