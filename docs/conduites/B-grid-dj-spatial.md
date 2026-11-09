# CONDUITE DE MISE EN ONDES — « GRID »

| | |
|---|---|
| **Production** | DJ set spatialisé 90' — live électronique |
| **Salle** | Club 360° — 24 enceintes périphérique + sub |
| **Système** | STAGESPACE — positions only, renderer L-ISA |
| **Objets** | 16 stems — kick/bass/synths/vox/pads |
| **Contrôle** | Console-led : OSC `/stagespace/*` + pads slots |
| **TC** | Ableton Link → `/stagespace/timecode` chase |

---

## PATCH

| Track | Objet | Rôle | Slot pad | Origine |
|---|---|---|---|---|
| 1 | KICK | basse fréquence | 1 | centre bas (0,-2,0) |
| 2 | BASS | basse | 2 | centre bas (0,-2,0) |
| 3–4 | SYN1/2 | nappes | 3 | anneau r=5m |
| 5 | LEAD | solo | 4 | avant centre |
| 6 | VOX | voix | 5 | avant haut |
| 7–10 | PADS | textures | 6 | aléatoire |
| 11 | FX | effets | 7 | parc |
| 12 | SPIRAL | spirale montante | 8 | oneshot + hold |
| 13 | VECTION | rotation champ | 9 | macro globale |
| 14–16 | PERC | percussions | 10 | anneau arrière |

**Origines** : `/stagespace/trackpos` par track avant chaque set — pas de .hol (club variable).

---

## CONDUITE

| # | Repère | Action | Commande | Note |
|---|---|---|---|---|
| 00 | — | **SOUNDCHECK** — ping tracks 1-16, vérif origins | `/stagespace/status` | `disarm` entre soundchecks |
| 01 | Set départ | **CUE 1** — stems cercle fixe, image large | `/stagespace/cue/recall 1` | Full cue — image initiale |
| 02 | Morceau 1 build | **SPIRALE** — slot 8 monte (oneshot 20s) | `/stagespace/slot 8` | `end:hold` — fige en haut |
| 03 | Drop | **SOLO ORBIT** — basse orbite seule | `/stagespace/solo 2` puis `/stagespace/unsolo` | fade 2s config |
| 04 | Break | **GRAB LEAD** — position manuelle vers public | `/stagespace/position 5 0 -1 -1` | manuel persiste |
| 05 | Morceau 2 | **TC CHASE** — cue suivante sur timecode | `/stagespace/timecode <s>` | auto-fire, pre_wait skip |
| 06 | **TRANSITION** | slot A `end:hold` → slot B `anchor:current` | `/stagespace/slot 3` après hold A | **chaînage seamless** |
| 07 | Build 2 | **VECTION** — rotation cohérente champ 12s | `/stagespace/slot 9` | macro rotate, fade auto |
| 08 | Drop 2 | **SCATTER** — tout disperse puis re-orbit | `/stagespace/cue/next` | tracking cue |
| 09 | Morceau 3 | **BUSKING** — impro sur pads 3/6/10 | `/stagespace/slot <n>` | park stems si besoin |
| 10 | Outro | **STASE** — cue finale fixe | `/stagespace/cue/recall 9` | puis `/stagespace/stop` |

---

## CONSIGNES

- **`solo` = attention** — tout s'arrête autour ; penser `unsolo` pour restaurer
- **Transition seamless** : NE PAS stopper le move précédent — `end:hold` le fige, `anchor:current` sur le suivant reprend de là. Un `slot/stop` intermédiaire casse la continuité.
- **Positions manuelles** : visibles en GUI (overlay) ; `/stagespace/position/clear <n>` pour libérer
- **Vection** : max 15s — couper avant (`slot/stop 9`), risque d'inconfort public
- **Panic** : retour aux `trackpos` d'origine — utilisable entre morceaux pour "reset scène"
- Entre sets : `disarm` (silence renderer) — l'app continue de tourner

**Signé** — metteur en ondes : ______  Opérateur : ______  Date : ______
