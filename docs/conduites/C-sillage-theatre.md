# CONDUITE DE MISE EN ONDES — « SILLAGE »

| | |
|---|---|
| **Production** | Théâtre dansé — 60', 2 danseurs trackés |
| **Salle** | Plateau 12×8m — 20 enceintes périmètre + ciel |
| **Système** | STAGESPACE — positions only → renderer TiMax |
| **Objets** | 24 — ambiances, voix, sons concrets, acteurs |
| **Tracking** | PSN/RTTrP → `/stagespace/position` flux continu |
| **Régie** | Cue list scène-par-scène + follow-me |

---

## PATCH

| Track | Objet | Rôle | Origine | Tracking |
|---|---|---|---|---|
| 1–6 | AMB1–6 | ambiances scène | par zone | — |
| 7–8 | V1/V2 | voix danseurs | entrée plateau | PSN→position |
| 9–12 | S1–S4 | sons concrets | mobiles | — |
| 13–14 | F1/F2 | followers (delay) | — | follow V1/V2 |
| 15–18 | H1–H4 | hauteurs | dôme | — |
| 19–24 | R1–R6 | réserve | parc | — |

**Suivi** : `V1`/`V2` pilotés par flux `/stagespace/position <n> x y z` (PSN→OSC bridge) — positions manuelles en continu.

---

## CONDUITE

| # | Scène | Action | Commande | Note |
|---|---|---|---|---|
| 00 | — | **ARM + vérif tracking** — V1/V2 répondent au PSN | `/stagespace/arm` | `disarm` aux entractes |
| 01 | Sc.1 — Noir | **AMB** — nappes fixes zone plateau | `/stagespace/cue/recall 1` | image ouverte |
| 02 | Entrée D1 | **FOLLOW** — V1 suit danseur (PSN continu) | flux `/stagespace/position 7` | track 7 vivant |
| 03 | Sc.2 | **TRACKING CUE** — ambiances changent, V1/V2 intouchés | `/stagespace/cue/recall 3` | scope positions — pas de clear |
| 04 | Solo D1 | **ORBIT AUTOUR** — slot orbit centré sur position V1 | `/stagespace/park 7` + `/stagespace/slot 4` | park V1 (protégé) + ancre dynamique |
| 05 | Entrée D2 | **DUO FOLLOW** — F1 poursuit V1 délai 800ms | `/stagespace/slot 5` | follow engine, délai param |
| 06 | Sc.3 | **CHANGE AUTO** — pre_wait 2s + follow 0 | `/stagespace/cue/next` | enchaîné, pas d'opérateur |
| 07 | Duo central | **CONVERGE** — tous objets convergent sur danseurs | `/stagespace/cue/recall 5` | `end:hold` — fige sur eux |
| 08 | Sc.4 — Sortie | **SCATTER** — tout se disperse aux extrêmes | `/stagespace/cue/next` | tracking cue |
| 09 | Final | **IMAGE FINALE** — V1/V2 derniers points fixes | `/stagespace/position 7/8` manuels | puis `/stagespace/park 7 8` |
| 10 | Rideau | **STASE** — positions tenues, silence | — | sortie en image |

---

## CONSIGNES

- **Park = protection** — V1/V2 parkées ne sont JAMAIS écrites par un recall (Tracking ou Full). C'est la sécurité des positions suivies.
- **Tracking cue** — ne touche que les objets listés dans son scope ; V1/V2 non listés restent au tracking PSN.
- **Follow-me** : si le flux PSN coupe, la position fige (dernière manuelle) — vérifier `status` si perte d'objet.
- **`pre_wait`/`follow`** — l'enchaînement scène 06 est auto ; ne pas GO manuellement pendant le wait.
- **Répetition** : `disarm` (positions tournent sans émettre) — `arm` le soir.
- **Panic** : positions `trackpos` — les danseurs voient leurs objets sauter aux origines ; signaler au plateau.

**Signé** — metteur en ondes : ______  Régie plateau : ______  Date : ______
