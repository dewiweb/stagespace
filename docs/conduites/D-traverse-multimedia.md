# CONDUITE DE MISE EN ONDES — « TRAVERSE »

| | |
|---|---|
| **Production** | Performance immersive multimédia — 75' |
| **Salle** | 360° — 48 enceintes sphère + scène centrale |
| **Système** | STAGESPACE — positions only → renderer Soundscape |
| **Médias** | Vidéo 360° (TC maître) · lumière (Art-Net/OSC régie) · plateau |
| **Sources live** | 4 musiciens plateau + 2 performeurs trackés PSN + voix off |
| **Objets** | 40 — stems fixés, live sources, layers génératifs, FX |
| **Régie son** | Console-led `/stagespace/*` — TC maître vidéo |

---

## PATCH

| Track | Objet | Rôle | Origine | Suivi |
|---|---|---|---|---|
| 1–6 | V1–V6 | voix/perfs live | entrées plateau | PSN→position (V1–V2), fixes (V3–V6) |
| 7–10 | M1–M4 | musiciens live (mics) | positions plateau | **park permanent** — protégés |
| 11–18 | S1–S8 | stems électroniques | anneau variable | cues/busking |
| 19–26 | G1–G8 | layers génératifs | aléatoire | perlin/swarm longue durée |
| 27–30 | H1–H4 | hauteurs/dôme | z=+5m | cues |
| 31–34 | F1–F4 | followers | — | follow engine (V1/V2) |
| 35–38 | X1–X4 | FX sends | parc | — |
| 39–40 | VO1–VO2 | voix off | avant haut | — |

**Live sources** : M1–M4 **parkées en permanence** — jamais écrites par aucun recall (protection reprise console). V1–V2 : flux PSN→`/stagespace/position` continu.

---

## CONDUITE

| # | Repère/TC | Action | Commande | Note |
|---|---|---|---|---|
| 00 | — | **ARM + checks** — tracking PSN, parks M, TC vidéo | `/stagespace/arm` + `/stagespace/status` | parks: `park 7 8 9 10` dès le départ |
| 01 | 00:00:00 | **OUVERTURE** — génératif seul, nappes perlin | `/stagespace/cue/recall 1` | layer G1–G8, lent |
| 02 | 00:03:12 | **TC CUE** — entrée vidéo synchro | `/stagespace/timecode <s>` | chase vidéo |
| 03 | 00:05:40 | **MUSICIENS** — stems rejoignent M (fixes plateau) | `/stagespace/cue/next` | M protégés (park) |
| 04 | 00:08:00 | **V1 ENTRÉE** — performeur monte, PSN live | flux `/stagespace/position 1` | tracking actif |
| 05 | 00:10:30 | **ORBIT DUO** — F1 orbit autour V1 (ancre dynamique) | `/stagespace/slot 3` | `anchor:current` sur position V1 |
| 06 | 00:14:00 | **MEDIA SYNC** — cue vidéo+lumière | `/stagespace/timecode` | TC déclenche |
| 07 | 00:16:45 | **TRACKING CUE** — ambiances changent, live intouché | `/stagespace/cue/recall 4` | scope positions — pas de clear |
| 08 | 00:20:00 | **SOLO LIVE** — V2 impro + park V1 | `/stagespace/park 1` + `/stagespace/solo 5` | V1 gelée, V2 live seule |
| 09 | 00:24:00 | **GÉNÉRATIF CREST** — swarm au climax génératif | `/stagespace/slot 6` | `end:hold` — fige haut |
| 10 | 00:28:30 | **TRANSITION SEAMLESS** — hold→anchor | `/stagespace/slot 7` | chaînage sans saut |
| 11 | 00:33:00 | **BUSKING** — pads impro sur stems | `/stagespace/slot <n>` | opérateur live |
| 12 | 00:38:00 | **LOOM** — son converge vers audience | `/stagespace/cue/recall 6` | `end:hold` au plus proche |
| 13 | 00:42:00 | **DUO PSN** — V1+V2 trackées, followers actifs | `/stagespace/unpark 1` + `/stagespace/slot 8` | reprise tracking |
| 14 | 00:47:00 | **TRACKING CUE 2** — tracking scène complète | `/stagespace/cue/next` | scope + pre_wait 1s |
| 15 | 00:52:00 | **MEDIA SYNC** — pointe vidéo finale | `/stagespace/timecode` | chase |
| 16 | 00:56:30 | **CANON SPATIALISÉ** — trajet séquencé ×6 | `/stagespace/cue/recall 7` | Sequence + phase |
| 17 | 01:00:00 | **ELEVATION FINALE** — converge→dôme, live figés | `/stagespace/cue/next` | `end:hold` partout |
| 18 | 01:05:00 | **SCATTER** — dispersion génératif | `/stagespace/cue/next` | |
| 19 | 01:08:00 | **VOIX OFF** — VO1 seul, stase | `/stagespace/position 39` manuel | manuel + park |
| 20 | 01:12:00 | **FINALE STASE** — image fixe, génératif coupé | `/stagespace/cue/recall 9` | Full cue |
| 21 | 01:15:00 | **SALUT** — silence | `/stagespace/stop` | positions tenues |

---

## CONSIGNES

- **Parks live (M1–M4) = sacrés** — jamais dégeler en show ; les mics live passent sous la console audio, pas sous STAGESPACE.
- **PSN flux** — si tracking coupe : position fige au dernier point. `/stagespace/status` pour vérif, reprise = le flux reprend automatiquement.
- **`pre_wait`/`follow`** — les enchaînements auto (cue 14) ne doivent pas être GO manuellement pendant le wait.
- **Chaînage** (cue 10) : NE PAS stopper le move — `end:hold` le fige, le suivant `anchor:current` reprend de là.
- **Dry-run répétitions** : `disarm` = le show tourne, rien ne part — vérifiable au listener.
- **Panic** : retour `trackpos` — uniquement urgence technique (les live sources verraient leurs objets sauter).
- **Media sync** : TC vidéo maître — jamais GO manuel sur les points marqués TC.

**Signé** — metteur en ondes : ______  Régie générale : ______  Régie vidéo : ______  Date : ______
