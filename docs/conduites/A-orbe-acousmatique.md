# SHOW RUNNING SHEET — "ORBE"

| | |
|---|---|
| **Production** | Acousmatic concert — 20' fixed work (diffusion) |
| **Venue** | 32-speaker sphere dome — Holophonix |
| **System** | STAGESPACE — positions only → Amadeus renderer |
| **Objects** | 24 — work stems (A1–A24) |
| **Operator** | Diffusion desk — cue list + pads |
| **Score ref.** | Vande Gorne score — gestures notated per cue |

---

## PATCH

| Track | Object | Role | Origin |
|---|---|---|---|
| 1–4 | A1–A4 | Foundation (low beds) | extreme low corners |
| 5–8 | A5–A8 | Orbiters | middle ring r=6m |
| 9–12 | A9–A12 | Soloists | front center |
| 13–16 | A13–A16 | Clouds (perlin) | random |
| 17–20 | A17–A20 | Heights | dome z=+4m |
| 21–24 | A21–A24 | Improv reserve | park |

**Stage start**: all tracks at `trackpos` origin — `/stagespace/trackpos <n> x y z`.

---

## RUNNING SHEET

| # | Cue point | Action | Command | Note |
|---|---|---|---|---|
| 00 | — | **ARM** — check 24 tracks at origin | `/stagespace/arm` + `/stagespace/status` | dry-run OFF |
| 01 | T+0'00" | **GO cue 1** — stasis: foundation alone, beds at the 4 corners | `/stagespace/cue/recall 1` | 40" of spatial silence |
| 02 | T+1'30" | **STANDBY orbit** — slot 2 ready | — | do not anticipate |
| 03 | T+2'00" | **Orbit** — 3 middle objects, slow rotation (40s cycle) | `/stagespace/slot 2` | `anchor:current` — starts from current position |
| 04 | T+4'15" | **LOOM** — soloist A9 crosses back→audience center | `/stagespace/cue/recall 3` | `end:hold` — freezes at closest point |
| 05 | T+5'00" | **Breath** — 6 sources in micro-oscillation | `/stagespace/cue/next` | tracking cue — positions only |
| 06 | T+8'30" | **IMPRO** — perlin clouds + park on the 2 held soloists | `/stagespace/slot 5` + `/stagespace/park 9` + `park 10` | park = survives recalls |
| 07 | T+11'00" | **Canon** — same path ×4 objects, 400ms offset | `/stagespace/cue/recall 6` | Sequence node + phase_offset |
| 08 | T+14'00" | **ELEVATION** — full convergence → dome | `/stagespace/cue/next` | `end:hold` on all — frozen overhead |
| 09 | T+17'30" | **SCATTER** — final dispersion + high stasis | `/stagespace/cue/next` | then `/stagespace/park 17-24` |
| 10 | T+20'00" | **BOW** — silence, held positions | — | no panic — exit in stasis |

---

## NOTES

- **Never** two simultaneous gestures — only one object moves at a time (attention rule)
- The loom (cue 04) is **irreplaceable** — if missed, `cue/recall 4` directly, no catching up
- Parks: unfreeze **only** via `/stagespace/unpark <n>` — never via panic
- **Panic** (`Esc`) only for technical emergency — holds survive recalls, not manual stops
- Check `cue/next` feedback before each GO — `cue/current` + `next` shown in conduite

**Signed** — sound director: ______  Operator: ______  Date: ______
