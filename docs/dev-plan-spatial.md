# Plan de développement — mix orienté objet

Issu de `docs/spatial-object-mixing-study.md` + `docs/conduites/` (spec d'acceptance).
Ordonnancement : **débloquer les conduites d'abord**, la tour ensuite, les
différenciateurs en dernier.

Estimations : S < 1 j · M = 1–3 j · L = 3–7 j · XL > 1 sem.

---

## P0 — Débloquer les conduites trackées

### P0.1 `anchor:follow` — ancre dynamique par objet

**Conduites** : C cue 04 (orbit sur V1 mobile), D cue 05. Actuellement
`anchor:current` fige la capture au spawn — la cible bouge, l'orbit reste.

**Design** : mode `follow` — l'ancre se **met à jour par frame** au lieu de
capturer une fois. Le worker lit la dernière position émise de la track
cible (`merge.last_position`) chaque frame, recalcule `delta = cible −
traj(0)`, l'applique. L'orbit reste centré sur la cible qui bouge.

**Tâches**
- `AnchorMode::Follow` (3e variante, `runtime/types.rs`)
- Worker : remplacer le `delta` figé par une lecture par frame —
  `last_position` exposée par le merge via un handle passé au worker au
  spawn (Arc<RwLock<HashMap>> partagé — le même que `last_out_positions`)
- `MoveSpec.anchor_target: Option<u32>` — la track à suivre (None = par
  objet : chaque objet suit sa propre position)
- `ActivateMoveRequest` + `MoveSlot.anchorTarget` + payload + select UI
- Docs

**Acceptance** : conduite C cue 04 — `/stagespace/slot 4` avec `anchor:follow`
sur V1 tracké → l'orbit centre suit le déplacement de V1 au listener.
`anchor:current` = comportement figé inchangé.

**Effort** : M · **Blocs** : worker delta par frame + handle last_position.

---

### P0.2 PSN/RTTrP ingest — tracking industrie

**Conduites** : C, D — le canal standard (BlackTrax/Zactrack/Follow-Me/
StagePrecision). Sans ça, pas de "follow performer" pro.

**Design** : listener multicast PSN (236.0.0.1:56565 ou configurable) →
décoder paquets RTTrPL (position/velocity per tracker) → mapper tracker_id
→ object_index (mapping config) → `set_manual_position` (le canal existe —
les positions manuelles lissées via kinematic smoothing).

**Tâches**
- `rust-engines/src/psn_receiver.rs` — socket multicast + parser RTTrPL
  (header, packet_id, tracker packets, position xyz)
- Config : `psn_port`, `psn_group`, `psn_map: tracker_id → object_index`
- Intégration `osc_receiver`-like : même pattern de routing
- Smoothing : kinematic smoothing existant suffit (dt réel)
- Status : age dernière trame exposé pour le bandeau santé (P1.3)

**Acceptance** : flux PSN simulé → objets suivent au listener ; coupure →
fige + indicateur de perte.

**Effort** : L · **Blocs** : protocol parsing (RTTrPL non trivial — framing,
tracker packets) + mapping config.

---

## P1 — Outillage métier (production réelle)

### P1.1 Soundcheck walk — S

**Conduite** : B 00.
**Quoi** : `/stagespace/soundcheck [start|stop|next|prev]` — séquence auto :
ping une track (position identifiable = pulse/oscillation marqueur) →
silence → suivante. Vérifie routing + identité spatiale.
**Acceptance** : chaque track s'identifie au listener, séquence traversable
manuellement.

### P1.2 Source-de-contrôle par objet — M · **priorité ergonomie n°1**

**Conduites** : C, D — *pourquoi cet objet est là*.
**Quoi** : par objet, la source active : `move:{id}` / `manual` / `psn` /
`park` / `hold` / `track`(origine) — exposée via `get_object_states` IPC →
badge couleur en 3D + colonne dans les listes.
**Tâches** : état par objet dans le merge (déterminer qui a écrit en dernier —
move, manual_positions, PSN flag, park set, hold) → getter → frontend badge.
**Acceptance** : lecture instantanée du modèle de contrôle — C conduite
jouable "à vue".

### P1.3 Santé des flux — S-M

**Conduites** : C, D — flux coupés = mort silencieuse.
**Quoi** : bandeau permanent : PSN age, TC lock, OSC out rate, OSC error
rate, armed state — pas des toasts épisodiques.
**Tâches** : timestamps derniers paquets dans receivers → `get_flow_health`
→ StatusBar extension.

### P1.4 Confidence view — M

**Quoi** : emitted-vs-commanded diff — le listener :9000 en natif : vue debug
affichant les dernières positions réellement émises par track vs GUI.
**Acceptance** : tout écart visible < 1 frame.

---

## P2 — La tour de contrôle

### P2.1 Surface de jeu (run-view) — L

**Conduites** : B, D — l'instrument, pas l'admin.
**Quoi** : construit sur `Conduite` window existante — grille pads (état
playing/fading/solo'd/park'd), gros GO/panic, holds visibles, cue list,
bandeau santé (P1.3), source-de-contrôle (P1.2) — UN écran.
**Acceptance** : conduite B jouable sans jamais ouvrir l'éditeur de graphe.

### P2.2 Audition de cue avant émission — M

**Conduite** : A — voir la prochaine image avant GO.
**Quoi** : `is_preview` existant pour moves — l'étendre aux cues : render
interne des positions sans envoi, affichage seul.

### P2.3 Vue radar 2D — M

**Quoi** : top-down + profil fixes, marquage park/manual/PSN/move par objet
(couleur source-de-contrôle) — le "plan" de conduite vs le 3D manipulable.

### P2.4 Log opérationnel — S-M

**Quoi** : historique horodaté : GO/recall/slot/park/NACK — qui, quand, quoi.

---

## P3 — Différenciateurs

| # | Item | Effort | Fondement | Note |
|---|---|---|---|---|
| P3.1 | **Auto-venue adaptation** | XL | touring | Normaliser positions à espace canonique + re-ancrer géométrie enceintes — le différenciateur #1, personne ne le fait |
| P3.2 | **Perceptual meters** (legibility/looming/vection) | M | MAMA, Neuhoff, Riecke | Vu-mètre de la lisibilité — vitesse angulaire/distance |
| P3.3 | **Distance reality layer** | M | Zahorik ×0.7, DRR | pos→gain/air-EQ/reverb-send auto |
| P3.4 | **Spatial dynamics** | L | 4DSOUND | compression/expansion énergie spatiale globale |
| P3.5 | **Attention orchestration** | M | change blindness | mode "un seul bouge" — stasis auto des autres |
| P3.6 | **Diffusion score view** | L | Vande Gorne | partition temps×zones×gestes |
| P3.7 | **Trajectory library** | M | Peters/Smalley | templates de gestes catalogués |
| P3.8 | **Rehearsal capture** | M | workflow | busking enregistré → cue rejouable |
| P3.9 | **Binaural bounce** | L | prelisten | show→binaural offline, répétition à distance |
| P3.10 | **Media sync out** | M | D | cue→trigger lumière/vidéo dédié |

---

## Jalons

**J1 — Conduites jouables** : P0 (follow + PSN) + P1 → C et D jouables au
listener avec suivi réel.

**J2 — Tour de contrôle** : P2 → B et D jouables depuis une seule surface,
sans l'éditeur.

**J3 — Différenciation** : P3 par ordre d'impact marché : auto-venue >
perceptual meters > distance layer > le reste.

## Dépendances

```
P0.1 (follow) ─┐
               ├─→ débloque C/D cue-04/05
P0.2 (PSN) ────┘
P1.2 (source-de-contrôle) ─→ P2.1 (run-view s'appuie dessus) + P2.3 (radar)
P1.3 (santé flux) ─────────→ P2.1 (bandeau dans la surface)
P0.2 ──────────────────────→ P1.3 (PSN health nécessite le flux)
```

## Règle de gouvernance

Chaque feature répond à une **conduite** ou à un **fondement de
bibliographie** — pas de feature "parce que cool". Critère global : les 4
conduites jouables bout-à-bout au listener.
