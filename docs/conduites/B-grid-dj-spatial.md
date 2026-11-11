# SHOW RUNNING SHEET — "GRID"

| | |
|---|---|
| **Production** | 90' spatialized DJ set — live electronic |
| **Venue** | 360° club — 24 perimeter speakers + sub |
| **System** | STAGESPACE — positions only, L-ISA renderer |
| **Objects** | 16 stems — kick/bass/synths/vox/pads |
| **Control** | Console-led: OSC `/stagespace/*` + slot pads |
| **TC** | Ableton Link → `/stagespace/timecode` chase |

---

## PATCH

| Track | Object | Role | Slot pad | Origin |
|---|---|---|---|---|
| 1 | KICK | low frequency | 1 | low center (0,-2,0) |
| 2 | BASS | bass | 2 | low center (0,-2,0) |
| 3–4 | SYN1/2 | beds | 3 | ring r=5m |
| 5 | LEAD | solo | 4 | front center |
| 6 | VOX | voice | 5 | front high |
| 7–10 | PADS | textures | 6 | random |
| 11 | FX | effects | 7 | park |
| 12 | SPIRAL | rising spiral | 8 | oneshot + hold |
| 13 | VECTION | field rotation | 9 | global macro |
| 14–16 | PERC | percussion | 10 | rear ring |

**Origins**: `/stagespace/trackpos` per track before each set — no .hol (variable club).

---

## RUNNING SHEET

| # | Cue point | Action | Command | Note |
|---|---|---|---|---|
| 00 | — | **SOUNDCHECK** — ping tracks 1-16, check origins | `/stagespace/status` | `disarm` between soundchecks |
| 01 | Set start | **CUE 1** — stems fixed circle, wide image | `/stagespace/cue/recall 1` | Full cue — initial image |
| 02 | Track 1 build | **SPIRAL** — slot 8 rises (20s oneshot) | `/stagespace/slot 8` | `end:hold` — freezes at top |
| 03 | Drop | **SOLO ORBIT** — bass orbits alone | `/stagespace/solo 2` then `/stagespace/unsolo` | 2s fade config |
| 04 | Break | **GRAB LEAD** — manual position toward audience | `/stagespace/position 5 0 -1 -1` | manual persists |
| 05 | Track 2 | **TC CHASE** — next cue on timecode | `/stagespace/timecode <s>` | auto-fire, pre_wait skip |
| 06 | **TRANSITION** | slot A `end:hold` → slot B `anchor:current` | `/stagespace/slot 3` after A holds | **seamless chaining** |
| 07 | Build 2 | **VECTION** — coherent field rotation 12s | `/stagespace/slot 9` | rotate macro, auto fade |
| 08 | Drop 2 | **SCATTER** — everything disperses then re-orbits | `/stagespace/cue/next` | tracking cue |
| 09 | Track 3 | **BUSKING** — improv on pads 3/6/10 | `/stagespace/slot <n>` | park stems if needed |
| 10 | Outro | **STASIS** — final fixed cue | `/stagespace/cue/recall 9` | then `/stagespace/stop` |

---

## NOTES

- **`solo` = attention** — everything else stops; remember `unsolo` to restore
- **Seamless transition**: DO NOT stop the previous move — `end:hold` freezes it, `anchor:current` on the next resumes from there. An intermediate `slot/stop` breaks the continuity.
- **Manual positions**: visible in the GUI (overlay); `/stagespace/position/clear <n>` to release
- **Vection**: max 15s — cut before (`slot/stop 9`), audience discomfort risk
- **Panic**: returns to `trackpos` origins — usable between tracks for "scene reset"
- Between sets: `disarm` (renderer silence) — the app keeps running

**Signed** — sound director: ______  Operator: ______  Date: ______
