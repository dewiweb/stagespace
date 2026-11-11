# Console integration — driving STAGESPACE from the FOH

The sound engineer keeps their console as the **master conduite**: each
console scene/snapshot emits an OSC message, STAGESPACE executes. The
laptop is only for soundcheck and monitoring.

## Commands (`/stagespace/*`, UDP to `oscInPort`, default 8001)

| Message | Effect |
|---------|-------|
| `/stagespace/go` | setlist GO (= Enter) |
| `/stagespace/cue/next` · `/prev` | next / previous cue |
| `/stagespace/cue/recall <n> [fade]` | recall by `cue_number` or index; optional `fade` overrides the stored fade |
| `/stagespace/slot <n>` · `/slot/stop <n>` · `/solo <n>` · `/unsolo` | busking: play / stop / solo the slot of `oscIndex` n (stable, 1-based, slot fades); `unsolo` = restore stopped slots |
| `/stagespace/arm` · `/disarm` | ARM = OSC output; DISARM = **dry-run** (silent rehearsal) |
| `/stagespace/status` | re-send current/next cue to the requester |
| `/stagespace/park <n>` · `/unpark <n>` | **object index n (0-based)** escapes recalls (manual override preserved) |
| `/stagespace/panic` · `/stop` | blackout / stop all |
| `/stagespace/timecode <s\|"HH:MM:SS:FF">` | timecode → chase (fps via `set_timecode_fps`) |
| `/stagespace/cue/arm <n>` · `/stagespace/cue/go` | arm without firing · fire the armed cue (console arm/go model) |
| `/stagespace/view <atelier\|conduite\|jeu>` | switch the operator surface from the console |
| `/stagespace/show/load <path.hfg>` · `/stagespace/load` | load a show file **from the STAGESPACE machine's disk** |

## Feedback sent to the controller

- `/stagespace/ack <addr>` — acknowledgement on every accepted command
- `/stagespace/nack <reason>` — rejected command: `busy: recall-in-progress`, `not-found: …` (targeted at the sender)
- `/stagespace/cue/current <n> <name>` and `/stagespace/cue/next <n> <name>` — on every cue change and on `/stagespace/status`

The 4 most recent controllers receive feedback — the console AND a
Companion tablet can listen at the same time.

## Recipes per console

- **DiGiCo (SD/Quantum)**: External Control → OSC command per snapshot.
  `/stagespace/cue/recall 5` in the snapshot = the spatial cue follows
  the scene.
- **A&H dLive / Behringer X32**: string/TCP-UDP message per scene to the
  `oscInPort` port. X32 natively sends floats — compatible.
- **QLab / Companion**: OSC cue on top of the conduite; a "SAFETY" button
  mapped to `/stagespace/cue/recall S1`.
- **Timecode**: send `/stagespace/timecode <s>` (~25 msg/s) and enable
  *TC chase* in the cues panel — locate + crossing handled.

## What stays on the laptop

Graph editing, manual positions (SpaceMouse / OSC-IN `Position`), 3D
monitoring, cue store/editing. Live, all conduite driving is possible
without touching the UI.
