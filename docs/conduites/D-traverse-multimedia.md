# SHOW RUNNING SHEET — "TRAVERSE"

| | |
|---|---|
| **Production** | Immersive multimedia performance — 75' |
| **Venue** | 360° — 48-speaker sphere + central stage |
| **System** | STAGESPACE — positions only → Soundscape renderer |
| **Media** | 360° video (master TC) · lighting (Art-Net/OSC desk) · stage |
| **Live sources** | 4 stage musicians + 2 PSN-tracked performers + voice-over |
| **Objects** | 40 — fixed stems, live sources, generative layers, FX |
| **Sound desk** | Console-led `/stagespace/*` — master video TC |

---

## PATCH

| Track | Object | Role | Origin | Follow |
|---|---|---|---|---|
| 1–6 | V1–V6 | voices/live perfs | stage entrances | PSN→position (V1–V2), fixed (V3–V6) |
| 7–10 | M1–M4 | live musicians (mics) | stage positions | **permanent park** — protected |
| 11–18 | S1–S8 | electronic stems | variable ring | cues/busking |
| 19–26 | G1–G8 | generative layers | random | long-running perlin/swarm |
| 27–30 | H1–H4 | heights/dome | z=+5m | cues |
| 31–34 | F1–F4 | followers | — | follow engine (V1/V2) |
| 35–38 | X1–X4 | FX sends | park | — |
| 39–40 | VO1–VO2 | voice-over | front high | — |

**Live sources**: M1–M4 **permanently parked** — never written by any
recall (console takeover protection). V1–V2: continuous
PSN→`/stagespace/position` stream.

---

## RUNNING SHEET

| # | Cue point/TC | Action | Command | Note |
|---|---|---|---|---|
| 00 | — | **ARM + checks** — PSN tracking, M parks, video TC | `/stagespace/arm` + `/stagespace/status` | parks: `park 7 8 9 10` from the start |
| 01 | 00:00:00 | **OPENING** — generative alone, perlin beds | `/stagespace/cue/recall 1` | layer G1–G8, slow |
| 02 | 00:03:12 | **TC CUE** — video entrance synced | `/stagespace/timecode <s>` | video chase |
| 03 | 00:05:40 | **MUSICIANS** — stems join M (fixed on stage) | `/stagespace/cue/next` | M protected (park) |
| 04 | 00:08:00 | **V1 ENTRANCE** — performer rises, PSN live | `/stagespace/position 1` stream | tracking active |
| 05 | 00:10:30 | **ORBIT DUO** — F1 orbits around V1 (dynamic anchor) | `/stagespace/slot 3` | `anchor:current` on V1's position |
| 06 | 00:14:00 | **MEDIA SYNC** — video+light cue | `/stagespace/timecode` | TC fires |
| 07 | 00:16:45 | **TRACKING CUE** — atmospheres change, live untouched | `/stagespace/cue/recall 4` | positions scope — no clear |
| 08 | 00:20:00 | **LIVE SOLO** — V2 improv + park V1 | `/stagespace/park 1` + `/stagespace/solo 5` | V1 frozen, V2 live alone |
| 09 | 00:24:00 | **GENERATIVE CREST** — swarm at generative climax | `/stagespace/slot 6` | `end:hold` — freezes high |
| 10 | 00:28:30 | **SEAMLESS TRANSITION** — hold→anchor | `/stagespace/slot 7` | jump-free chaining |
| 11 | 00:33:00 | **BUSKING** — improv pads on stems | `/stagespace/slot <n>` | live operator |
| 12 | 00:38:00 | **LOOM** — sound converges toward audience | `/stagespace/cue/recall 6` | `end:hold` at closest |
| 13 | 00:42:00 | **PSN DUO** — V1+V2 tracked, followers active | `/stagespace/unpark 1` + `/stagespace/slot 8` | tracking resumes |
| 14 | 00:47:00 | **TRACKING CUE 2** — full-scene tracking | `/stagespace/cue/next` | scope + pre_wait 1s |
| 15 | 00:52:00 | **MEDIA SYNC** — final video peak | `/stagespace/timecode` | chase |
| 16 | 00:56:30 | **SPATIALIZED CANON** — sequenced path ×6 | `/stagespace/cue/recall 7` | Sequence + phase |
| 17 | 01:00:00 | **FINAL ELEVATION** — converge→dome, live frozen | `/stagespace/cue/next` | `end:hold` everywhere |
| 18 | 01:05:00 | **SCATTER** — generative dispersion | `/stagespace/cue/next` | |
| 19 | 01:08:00 | **VOICE-OVER** — VO1 alone, stasis | `/stagespace/position 39` manual | manual + park |
| 20 | 01:12:00 | **FINALE STASIS** — fixed image, generative off | `/stagespace/cue/recall 9` | Full cue |
| 21 | 01:15:00 | **BOW** — silence | `/stagespace/stop` | held positions |

---

## NOTES

- **Live parks (M1–M4) = sacred** — never unfreeze during the show; live
  mics go through the audio console, not STAGESPACE.
- **PSN stream** — if tracking cuts: position freezes at last point.
  `/stagespace/status` to check, recovery = the stream resumes
  automatically.
- **`pre_wait`/`follow`** — the auto chainings (cue 14) must not be GO'd
  manually during the wait.
- **Chaining** (cue 10): DO NOT stop the move — `end:hold` freezes it,
  the next `anchor:current` resumes from there.
- **Rehearsal dry-run**: `disarm` = the show runs, nothing goes out —
  verifiable on the listener.
- **Panic**: returns to `trackpos` — technical emergency only (live
  sources would see their objects jump).
- **Media sync**: master video TC — never manual GO on TC-marked points.

**Signed** — sound director: ______  General manager: ______  Video manager: ______  Date: ______
