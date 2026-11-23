# Score — multitrack automation sequencer (design)

> **Status: design note.** Vision: the score is the *ultimate* level of
> show programming — a timeline where the show IS the structure, above
> the discrete cue machine of Conduite.

## Why

Today `ScorePanel` is a *command tape*: `rehearsal` records timestamped
busking actions (`liveActionsRehearsal.ts`, ~160 lines, frontend-only)
and replays them through a chain of `setTimeout`. It captures the right
verbs but is the embryo, not the concept:

- **Frontend-timed** — jitter, dies on webview reload, violates the
  "backend owns runtime truth" rule.
- **Flat** — one linear tape, no parallel lanes, no continuous
  automation.
- **No persistence in the show** — lives in `localStorage`, not the
  `.hfg` envelope.

The user's framing: a **multitrack automation sequencer** (audio/video
sequencer metaphor) — its own surface, where you place moves and cues
as clips and write per-object / global-parameter / modulation
evolutions as continuous curves. It surpasses Conduite: Conduite is a
discrete state machine (cue→cue recall), the Score makes the show a
timeline.

References already in the repo: `RESEARCH_STATE_OF_ART.md` (IanniX
poly-temporal score, ossia score) and `dev-plan-spatial.md` A1.6
"diffusion score view" (marked long-term).

## Conceptual model

```
SCORE = transport + tracks + evaluation engine

Transport : play / pause / seek / scrub / loop / TC chase
Track     : typed lane holding clips or automation
Clip      : { t_start, duration, payload } placed on a track
Automation: { param_ref, keyframes[], interpolation } on a track
```

### Track types

| Track | Payload | Backed by (existing primitive) |
|---|---|---|
| `slots` | Move clips `{slot_id, fade}` — start/stop at timestamps | `activate_move` / `stop_slot`, `hold`/`anchor current` chaining |
| `cues` | Recall markers `{cue_id}` on a conductor lane | `cue/recall`, atomic recall, `pre_wait` |
| `macros` | Automation `{macro, keyframes}` — speed, scale, shift, yaw, radius… | `/stagespace/macro <name> <v>` (already continuous) |
| `modulations` | Envelopes / routing switches on the signal graph | `SignalMap`, `ChannelModulation` rules |
| `objects` | Per-object params: manual position curves, park windows, attention | `/stagespace/position`, `park`, `attention` |
| `gestures` | One-shot ballistic events at a timestamp | `/stagespace/gesture`, `throw` |

### Automation data

```ts
interface Keyframe { t: number; v: number; ease?: 'linear'|'smooth'|'step' }
interface AutomationLane {
  target: string;            // e.g. 'macro:speed', 'obj:3:pos.x', 'mod:gain'
  keys: Keyframe[];          // sorted
  interp: 'linear' | 'smoothstep' | 'step';
}
interface ScoreClip {
  id: string;
  track: string;             // lane id
  start: number;             // seconds, score time
  duration: number | null;   // null = event/marker
  payload: SlotClip | CueMarker | GestureShot;
}
interface Score {
  id: string; name: string;
  duration: number;
  loop?: { start: number; end: number };
  tracks: ScoreTrack[];      // ordered lanes
  clips: ScoreClip[];
  automation: AutomationLane[];
  tc?: { fps: number; offset: number };  // reuses the TC engine
}
```

Persistence: `Score` joins the `.hfg` envelope (document, not runtime)
→ dirty tracking, save/load, autosave apply unchanged.

## The engine — backend-evaluated

The score is **evaluated inside the merge/runtime at the 60 Hz tick**,
never in JS:

- `ScoreRuntime` holds `cursor_t` (score clock), active clips, and
  evaluates automation curves each tick → writes macro values, manual
  positions, modulation params exactly like OSC-IN would (same command
  paths → same validation, same merge inputs).
- Clip boundaries emit the same commands the operator/OSC would send
  (`activate_move`, `cue/recall`, `slot/stop`…) — the score is *another
  controller*, not a parallel runtime.
- Commands: `score_load`, `score_play`, `score_pause`, `score_seek`,
  `score_set_loop`; state polled/emitted like movements (`score/state`
  event: cursor, playing, active clips) → webview is a view, not the
  clock.
- TC chase: `cursor_t` can be *driven* by incoming timecode (existing
  `/stagespace/timecode/chase` machinery) — the score becomes the
  SMPTE-synced master plan of the show.
- Determinism: same input score + same t ⇒ same output; replay/tests
  can step the clock.

Conduite relationship: a `cues` track recalls cues at timestamps —
Conduite remains the *manual recovery* surface when the show deviates.
The score is the written plan; the console is the override.

## Surface

Fourth surface `SCORE` (`Atelier | Jeu | Score | Conduite`?) — a
composition mode, not a move-editing tool:

- Ruler + TC readout, transport cluster (play/pause/seek/loop, chase)
- Lane list left (add/reorder/mute/solo per track), clips right
- Automation lanes: overlay curves, keyframe editing (add/move/delete,
  snap to grid)
- Clip editing: drag to move/trim, double-click to jump to the move in
  Atelier; cue markers = the cue chips
- Optional "record to score" — capture live busking *into* tracks
  (supersedes today's rehearsal tape as an import path)

## Phases

| Phase | Scope | Notes |
|---|---|---|
| **S1 — backend tape** | Move today's rehearsal model backend-side: timed command entries evaluated at tick, `score/*` transport commands, `.sscore` kept as export | Quick win: fixes `setTimeout` replay, survives reload; UI unchanged |
| **S2 — clip timeline** | `slots` + `cues` lanes, Score model in the envelope, surface with ruler + clip editing | The "written linear show" case |
| **S3 — automation** | `macros` + `objects` + `modulations` lanes, keyframe editor, curve evaluation in the runtime | The real sequencer |
| **S4 — TC & poly-temporal** | TC chase as clock source, loop regions, multiple cursors / relative speeds (IanniX territory) | Open — design with RESEARCH_STATE_OF_ART §IanniX |

## Open questions

- Clip overlapping semantics on one lane (latest wins? blend? nack?)
- Automation vs operator takeover: priority rules (park/freeze/manual
  interactions — manual must stay sovereign, like OSC)
- Does a score own the setlist (clips spawn slots) or reference it
  (clips point at existing slots — simpler, S2 choice)?
- Loop region × TC chase interaction
