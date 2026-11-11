# Use cases — to amend/complete

Two field-validated scenarios and their open limits. Living document:
every new requirement or fix gets added here.

---

## 1. Sound engineer mixing console + effects (console = master conduite)

**Scenario**: the engineer already drives their console by scenes; each
snapshot/scene emits an OSC message, STAGESPACE executes the spatial cues
in chase. The laptop is only for soundcheck and monitoring.

**What's delivered**: `/stagespace/{go,cue/next,prev,recall,panic,stop,park,unpark,arm,disarm,status,timecode}` + `/slot|slot/stop|solo`; ack + `cue/current|next` feedback to the 4 most recent controllers; `docs/console-integration.md`; `examples/conduite-epilogue.*`; optional fade on `cue/recall`; `set_osc_armed` (dry-run) drivable by OSC.

**Open limits**
- Limited state feedback → **delivered**: `/stagespace/nack` (targeted busy/not-found rejection) + **full-screen Conduite** panel in PerformView (big NOW/NEXT, TC, pending, GO/Prev/Next/Panic touch); Companion stays possible for the console itself.
- Two gain layers (console fader vs `object_channels.gain`) — documented rule: spatial gain reserved for tracking/effects cues.
- ~~No OSC learn~~ **delivered**: LEARN button in the OSC IN editor (see §2).
- ~~Ack ≠ execution~~ mitigated: rejection reported by `nack`, execution confirmed by `cue/current` feedback — still true that an instant hit should use `cue/recall + short fade`.

---

## 2. Busking — non-timecoded concert (effects on inspiration)

**Scenario**: the engineer prepares slots at soundcheck, then
fires/cuts/solos by number live. Everything must be faded and cancelable.

**What's delivered**: `playSlot`/`stopSlotWithFade` via UI + OSC (`/stagespace/slot|slot/stop|solo|unsolo`, slot fades respected; `unsolo` = restore pre-solo set); parallel layers; `one_shot` for stingers; `scale/shift/rotation/speed` macros and OSC-IN (`macro`, `channel`, `position`, handlers→signal) for live expression; `park` to freeze a hand-held object; DRY-RUN for silent rehearsal.

**Open limits**
- Numbering: **stable persisted `oscIndex`** delivered — the n in `/stagespace/slot` no longer follows reordering; backfill index+1 for existing slots. `park` survives panic by design (operator intent).
- ~~No "momentary bump"~~ **delivered** (`6583fd9`): press-and-hold ≥350ms on a pad = plays while held, release = fade-out — console behavior.
- ~~The fader→param mapping needs a pre-wired signal graph (no OSC learn)~~ **delivered**: `OSC IN` scope of the live drawer — list, add/remove, **LEARN** (move the fader, the address fills in) via `learnAddOscMapping`.
- ~~Next increment: numbered pads + solo in PerformView~~ **delivered** (`fda88ac`) — `#n` badge per slot, `S` solo button as soon as several moves play; a full mappings editor remains — **full-screen busking mode delivered** (`a05f37c`): adaptive giant pads + hold=bump + S=solo.

### 2b — WFS + KNN ring variant (external renderer)

**Scenario**: live concert — instrument/voice inputs mixed in **WFS**
(Wave Field Synthesis) on a loudspeaker array, plus a **KNN bus** to a
ring of speakers around the audience. The external spatial processor
(Holophonix, SPAT, ADM-OSC renderer…) owns all the panning: STAGESPACE
only sends object positions/trajectories.

**Mapping**: objects 1–N = WFS mix (point sources in the sweet spot),
objects N+1–24 = KNN ring. On the STAGESPACE side these are just track
indices — the bus split lives in the renderer. `Group`/partition in
graphs gives clean subsets per bus.

**Specifics**
- WFS: moves must stay in the zone covered by the array (sweet spot /
  out-of-field) — a *graph design* constraint, not an engine one.
- KNN ring: `Circular`/`Rotate`/phase-spread = canonical use;
  `distance`/`gain` universal, `spread`/`aperture` per profile/renderer.
- The audio chain is never touched: park, manual position, slots, solo
  only act on positions — the WFS/KNN mix keeps running.
