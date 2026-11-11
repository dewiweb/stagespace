# SHOW RUNNING SHEET — "SILLAGE"

| | |
|---|---|
| **Production** | Dance theatre — 60', 2 tracked dancers |
| **Venue** | 12×8m stage — 20 perimeter + overhead speakers |
| **System** | STAGESPACE — positions only → TiMax renderer |
| **Objects** | 24 — atmospheres, voices, concrete sounds, actors |
| **Tracking** | PSN/RTTrP → continuous `/stagespace/position` stream |
| **Stage management** | Scene-by-scene cue list + follow-me |

---

## PATCH

| Track | Object | Role | Origin | Tracking |
|---|---|---|---|---|
| 1–6 | AMB1–6 | scene atmospheres | per zone | — |
| 7–8 | V1/V2 | dancer voices | stage entrance | PSN→position |
| 9–12 | S1–S4 | concrete sounds | mobile | — |
| 13–14 | F1/F2 | followers (delay) | — | follow V1/V2 |
| 15–18 | H1–H4 | heights | dome | — |
| 19–24 | R1–R6 | reserve | park | — |

**Follow**: `V1`/`V2` driven by `/stagespace/position <n> x y z` stream
(PSN→OSC bridge) — continuous manual positions.

---

## RUNNING SHEET

| # | Scene | Action | Command | Note |
|---|---|---|---|---|
| 00 | — | **ARM + tracking check** — V1/V2 respond to PSN | `/stagespace/arm` | `disarm` at intermissions |
| 01 | Sc.1 — Blackout | **AMB** — fixed beds over stage zone | `/stagespace/cue/recall 1` | open image |
| 02 | D1 entrance | **FOLLOW** — V1 follows dancer (continuous PSN) | `/stagespace/position 7` stream | track 7 live |
| 03 | Sc.2 | **TRACKING CUE** — atmospheres change, V1/V2 untouched | `/stagespace/cue/recall 3` | positions scope — no clear |
| 04 | D1 solo | **ORBIT AROUND** — orbit slot centered on V1's position | `/stagespace/park 7` + `/stagespace/slot 4` | park V1 (protected) + dynamic anchor |
| 05 | D2 entrance | **DUO FOLLOW** — F1 pursues V1, 800ms delay | `/stagespace/slot 5` | follow engine, delay param |
| 06 | Sc.3 | **AUTO CHANGE** — pre_wait 2s + follow 0 | `/stagespace/cue/next` | chained, no operator |
| 07 | Central duo | **CONVERGE** — all objects converge on dancers | `/stagespace/cue/recall 5` | `end:hold` — freezes on them |
| 08 | Sc.4 — Exit | **SCATTER** — everything disperses to extremes | `/stagespace/cue/next` | tracking cue |
| 09 | Final | **FINAL IMAGE** — V1/V2 last fixed points | `/stagespace/position 7/8` manual | then `/stagespace/park 7 8` |
| 10 | Curtain | **STASIS** — held positions, silence | — | exit in image |

---

## NOTES

- **Park = protection** — parked V1/V2 are NEVER written by a recall (Tracking or Full). That's the safety of followed positions.
- **Tracking cue** — only touches objects listed in its scope; unlisted V1/V2 stay on PSN tracking.
- **Follow-me**: if the PSN stream cuts, the position freezes (last manual) — check `status` if an object is lost.
- **`pre_wait`/`follow`** — the scene 06 chaining is automatic; do not GO manually during the wait.
- **Rehearsal**: `disarm` (positions run without emitting) — `arm` on show night.
- **Panic**: `trackpos` positions — dancers see their objects jump to origins; signal the stage.

**Signed** — sound director: ______  Stage management: ______  Date: ______
