# CONDUITE DE MISE EN ONDES — « ORBE »

| | |
|---|---|
| **Production** | Concert acousmatique — œuvre fixée 20' (diffusion) |
| **Salle** | Dôme 32 enceintes sphère — Holophonix |
| **Système** | STAGESPACE — positions only → renderer Amadeus |
| **Objets** | 24 — stems œuvre (A1–A24) |
| **Opérateur** | Diffusion desk — cue list + pads |
| **Réf. partition** | Score Vande Gorne — gestes notés par cue |

---

## PATCH

| Track | Objet | Rôle | Origine |
|---|---|---|---|
| 1–4 | A1–A4 | Socle (napes basses) | coins bas extrêmes |
| 5–8 | A5–A8 | Orbitants | anneau médian r=6m |
| 9–12 | A9–A12 | Solistes | avant centre |
| 13–16 | A13–A16 | Nuages (perlin) | aléatoire |
| 17–20 | A17–A20 | Hauteurs | dôme z=+4m |
| 21–24 | A21–A24 | Réserve impro | parc |

**Départ plateaux** : tous les tracks à `trackpos` origine — `/stagespace/trackpos <n> x y z`.

---

## CONDUITE

| # | Repère | Action | Commande | Note |
|---|---|---|---|---|
| 00 | — | **ARM** — vérifier 24 tracks à l'origine | `/stagespace/arm` + `/stagespace/status` | dry-run OFF |
| 01 | T+0'00" | **GO cue 1** — stase : socle seul, napes aux 4 coins | `/stagespace/cue/recall 1` | 40" de silence spatial |
| 02 | T+1'30" | **STANDBY orbit** — prêt slot 2 | — | ne pas anticiper |
| 03 | T+2'00" | **Orbit** — 3 objets médians, rotation lente (cycle 40s) | `/stagespace/slot 2` | `anchor:current` — départ depuis position courante |
| 04 | T+4'15" | **LOOM** — soliste A9 traverse fond→audience centre | `/stagespace/cue/recall 3` | `end:hold` — fige au plus proche |
| 05 | T+5'00" | **Respiration** — 6 sources en micro-oscillation | `/stagespace/cue/next` | tracking cue — positions seules |
| 06 | T+8'30" | **IMPRO** — nuages perlin + park sur les 2 solistes tenus | `/stagespace/slot 5` + `/stagespace/park 9` + `park 10` | park = survit aux recalls |
| 07 | T+11'00" | **Canon** — même trajet ×4 objets, décalage 400ms | `/stagespace/cue/recall 6` | Sequence node + phase_offset |
| 08 | T+14'00" | **ÉLÉVATION** — convergence totale → dôme | `/stagespace/cue/next` | `end:hold` sur tous — figés en hauteur |
| 09 | T+17'30" | **SCATTER** — dispersion finale + stase haute | `/stagespace/cue/next` | puis `/stagespace/park 17-24` |
| 10 | T+20'00" | **SALUT** — silence, positions tenues | — | pas de panic — sortie en stase |

---

## CONSIGNES

- **Jamais** deux gestes simultanés — un seul objet bouge à la fois (règle d'attention)
- Le loom (cue 04) est **irremplaçable** — si raté, `cue/recall 4` direct, pas de rattrapage
- Parks : dégeler **uniquement** via `/stagespace/unpark <n>` — jamais au panic
- **Panic** (`Esc`) uniquement en urgence technique — les holds survivent aux recalls, pas aux stops manuels
- Vérifier `cue/next` feedback avant chaque GO — `cue/current` + `next` affichés en conduite

**Signé** — metteur en ondes : ______  Opérateur : ______  Date : ______
