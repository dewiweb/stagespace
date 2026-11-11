# Development plan — object-oriented mixing

> **Status: planning document.** Read together with
> `spatial-object-mixing-study.md` (rationale) and
> `ROADMAP_GRAPH_GLOBAL.md` (implementation status — the P1–P5 spatial
> tracks shipped).

Derived from `docs/spatial-object-mixing-study.md` + `docs/conduites/`
(acceptance spec). Structured around the **three phases of the
operator's work**:

- **A. Boxing** — composing/preparing the conduite (before the show)
- **B. Conduite** — advancing the show (GO, TC, monitoring)
- **C. Live play** — interacting with objects during (busking, tracking,
  gestures)

Estimates: S < 1 d · M = 1–3 d · L = 3–7 d · XL > 1 wk.

---

## AXIS A — Boxing the conduite

*Composing the show: scene, trajectories, cues, rehearsal.*

### A0 — Foundation (solid existing)
.hol import / `trackpos`, compiled graph, trajectory preview/sample,
formations, cue store/scopes/modes, dry-run, zones, OSC-IN mappings.

### A1 — Missing writing tools

| Item | What | Justification | Effort |
|---|---|---|---|
| A1.1 | **Soundcheck walk** — sequential per-track ping | B 00, universal cue point | S |
| A1.2 | **Cue audition** — preview the image without emitting | A — "what does cue 3 look like" | M |
| A1.3 | **Trajectory library** — catalogued gestures (approach/orbit/scatter/loom/ribbon/bloom) | Peters/Smalley taxonomy | M |
| A1.4 | **Distance reality layer** — pos→gain/air-EQ/reverb-send auto | Zahorik ×0.7, DRR, Begault | M |
| A1.5 | **Perceptual meters** — legibility/looming/vection per move | MAMA, Neuhoff, Riecke | M |
| A1.6 | **Diffusion score view** — score of time×zones×gestures | Vande Gorne — composition | L |
| A1.7 | **Rehearsal capture** — recorded busking → replayable cue | the live becomes memory | M |
| A1.8 | **Binaural bounce** — show→remote listening | rehearsal without the venue | L |
| A1.9 | **Auto-venue adaptation** — same conduite, different geometry | touring — **differentiator #1, nobody does this** | XL |

### A2 — Order within the axis
`A1.1` (trivial, cue point) → `A1.2` (audition — blocks composition
confidence) → `A1.5`/`A1.4` (meters + perceptual realism) → `A1.3` →
`A1.7` → the heavy ones (`A1.6`, `A1.8`, `A1.9`).

---

## AXIS B — Conduite (advancing the show)

*The GO: cue chain, TC, monitoring — what the operator watches.*

### B0 — Existing
cue chain (next/prev/recall/go), OSC feedback `cue/current`/`next`, TC
chase, panic, `isRecalling`/busy NACKs, Tracking/Full scopes,
pre_wait/follow.

### B1 — The control tower

| Item | What | Justification | Effort |
|---|---|---|---|
| B1.1 | **Stream health** — PSN/TC/OSC: frame age, lock, error rate — permanent banner | C, D — a cut stream = silent death | S-M |
| B1.2 | **Confidence view** — emitted-vs-commanded in GUI | integrated listener | M |
| B1.3 | **Operational log** — timestamped history (GO/recall/NACK/slot) | D — "what happened" | S-M |
| B1.4 | **Media sync out** — cue→dedicated light/video trigger | D — media sync | M |
| B1.5 | **Fixed 2D radar** — readable conduite plan + source marking | A,B,C,D | M |

### B2 — Order
`B1.1` + `B1.3` (S, twins) → `B1.2` → `B1.5` → `B1.4`.

---

## AXIS C — Live play (interacting with objects)

*The instrument: pads, tracking, gestures, takeovers — what the
operator plays.*

### C0 — Existing
busking slots + solo/unsolo, park, manual positions, `hold`/`anchor` —
the continuous semantics ✓ delivered.

### C1 — The missing interaction

| Item | What | Justification | Effort |
|---|---|---|---|
| C1.1 | **`anchor:follow`** — dynamic anchor on a moving target | C 04, D 05 — orbit around the actor | M |
| C1.2 | **PSN/RTTrP ingest** — industry tracking | C, D — pro performer follow | L |
| C1.3 | **Per-object control source** — move/manual/PSN/park/hold visible | THE missing ergonomics | M |
| C1.4 | **Play surface** — pad grid (states, holds, big GO/panic) | B, D — the instrument | L |
| C1.5 | **Grab & throw** — impulse → inertia | live gesture | M |
| C1.6 | **Position gestures** — "all-to-front"/"explode"/"orbit-audience"/"loom" in one OSC | fast busking | S-M |
| C1.7 | **Attention orchestration** — "only one moves" auto | change blindness | M |
| C1.8 | **Spatial dynamics** — spatial energy compression | 4DSOUND | L |

### C2 — Order
`C1.1` + `C1.2` (the 2 gaps blocking tracked conduites) → `C1.3`
(reading the model — conditions `C1.4`) → `C1.4` → gestures
(`C1.5`/`C1.6`) → `C1.7`/`C1.8`.

---

## Milestones

| Milestone | Contents | Unlocked conduites |
|---|---|---|
| **J1 — Playable conduites** | C1.1, C1.2, B1.1, A1.1 | C, D at the listener with real tracking |
| **J2 — Control tower** | C1.3, C1.4, B1.2, B1.3, B1.5 | B, D playable from one surface — no editor |
| **J3 — Full composition** | A1.2, A1.4, A1.5, A1.3 | A boxed without going back to the venue |
| **J4 — Differentiation** | A1.9, A1.6, C1.7, C1.8, A1.8 | beyond the market |

## Dependencies

```
C1.1 (follow) ─┐
C1.2 (PSN) ────┼─→ J1 — C/D cue-04/05/tracking
B1.1 (health) ─┘
C1.3 (control-source) ─→ C1.4 (run-view) + B1.5 (radar) ─→ J2
A1.2 (audition) ─→ J3 — composition confidence
```

## Governance rule

Every item answers a **conduite** (the 4 docs) or a **bibliography
foundation** — no feature "because it's cool". Global criterion: the 4
conduites playable end-to-end at the listener, across the 3 phases.
