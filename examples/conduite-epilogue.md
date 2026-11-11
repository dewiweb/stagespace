# Conduite — "Epilogue"
**Piece:** immersive theatre ~1 h 25 (two acts + intermission + encore) · **System:** STAGESPACE → Holophonix, 24 objects · **Timecode:** OSC `/stagespace/timecode` (25 fps)

| TC | Cue | Stage action | Requested spatialization | Fade | Trigger |
|----|-----|-----------------|--------------------------|------|----------------|
| 00:00:00 | 1 Pre-show | House open, audience seating | Slow ambient orbit, the 24 objects in a low circle | 8 s | TC |
| 00:09:30 | 2 Houselights | Half light | General −6 dB dip, the formation continues | 5 s | TC |
| 00:10:00 | 3 Opening | Curtain | The circle tightens and gradually rises | 10 s | TC |
| 00:14:00 | 4 Duo + halo | Front duo, ensemble behind | 4 soloists in a line + circular halo of the 20 others | 6 s | TC |
| 00:19:30 | 5 Storm | Panic sequence | Nervous chaotic motion (noise + phase offset) | 4 s | TC, then **follow 20 s** |
| — | 6 Calm | Return to calm | Slow formation | 12 s | **auto** (follow cue 5) |
| — | 7 Act transition | End of scene, intermission call | Steady pendulum waiting | 6 s | **manual GO** (on call) |
| 00:30:00 | 8 Intermission | Break | Wide and slow ambience | 8 s | TC |
| 00:40:00 | 9 Act 2 resumes | Performers return | Ascending helix | 8 s | TC |
| 00:45:00 | 10 Wave | Dream sequence | Rose curve | 6 s | TC |
| 00:50:00 | 11 Lissajous | Scene 2 duo | Interlace | 6 s | TC |
| 00:55:00 | 12 Swarm | Organic chaos | Boids | 4 s | TC |
| 01:00:00 | 13 Percussions | Rhythmic passage | Bounce | 2 s | TC |
| 01:04:00 | 14 Suspension | Frost effect | Rhythmic freeze/unfreeze (LFO) | 2 s | TC |
| 01:10:00 | 15 Final ascent | Last acceleration | Ascending spiral | 6 s | TC |
| 01:16:00 | 16 Curtain | Finale | Convergence at center, compact group | 15 s | TC |
| — | 17 Encore | Bis | Ambient orbit returns | 8 s | **manual GO** (on call) |
| 01:25:00 | 18 Post-show | House out | Light −6 dB dip, ambience continues | 6 s | TC |
| — | **S1 SAFETY** | **Backup** | Neutral orbit, flat levels | 3 s | **manual** `/stagespace/cue/recall S1` |

## Stage notes

- **Cues 2 and 18** are *tracking* cues (scope = channels only): they modulate levels without touching the formation, the global graph or other categories — light/video runs independently.
- **Cue 5→6** chains automatically in 20 s; the operator can interrupt with GO/prev if the scene runs long.
- **Cue 16** also switches the global graph (barycenter pivot): the tightening happens around the group's true center.
- **Cue 17 (Encore) and cue 7 (Transition)** are deliberately on manual GO — they depend on the stage call, not on a time.
- **S1**: backup cue with alphabetic numbering, recallable via `cue/recall S1` from any OSC console — regains control in 3 s if the run goes off track.
- Contingency reserve: `park` to freeze an object out of the cues (e.g. a dead speaker), spacemouse/OSC-IN for hand-driven position, `panic` in case of trouble, DRY-RUN to rehearse without emitting OSC, TC locate to resume mid-way (seek in the trajectory).

*Document matching the `conduite-epilogue.hfg` file — each line above is translated into it cue by cue (verified: TC, fade, mode, follow consistent).*
