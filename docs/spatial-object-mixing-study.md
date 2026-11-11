# STAGESPACE — control tower for object-oriented mixing

> **Status: positioning study** — rationale for the object-mixing
> direction; implementation status lives in `ROADMAP_GRAPH_GLOBAL.md`.

Positioning study: scientific literature, state of the art, typical
conduites, capability + ergonomics audit, gaps and roadmap.

---

## 1. Perceptual foundations (literature)

What research imposes on the design of a position system for object mixing:

### 1.1 Dynamic localization

- **MAMA** (Minimum Audible Movement Angle — Harris & Sergeant 1971;
  Perrey & Nobbe 2001): ~1–3° minimum displacement to perceive motion;
  perception degrades with speed.
- **Localization blur** (Rakerd & Hartmann 1986): beyond an angular
  speed threshold, the spatial image blurs. **Perceived angular speed**
  (not metric) is the cardinal parameter: a move at 8 m/s is illegible
  at 2 m, fluid at 15 m → implementable "legibility" metric.
- **Looming asymmetry** (Neuhoff 2001; Bach, Neuhoff et al. 2009):
  approach is systematically overestimated (contact-time
  underestimation of 15–40%) with measurable affective response (GSR).
  The **loom** is the only spatial gesture with a proven emotional
  signature — underexploited everywhere.
- **Vection** (Riecke et al.): coherent rotation of the entire field
  induces self-motion; tolerance threshold ~10–15 s. Powerful, to be
  dosed.
- **Distance perception** (Zahorik, Brungart & Bronkhorst 2005;
  Klatzky et al.): systematic compression (~×0.7). For a perceived 10 m
  recede, ~14 m of travel is needed → *distance exaggeration factor* as
  a parameter — absent from all commercial tools.
- **Front-back confusions** (Wightman & Kistler 1989): resolved by head
  micro-movements or spectral/elevation asymmetries. Perfectly
  symmetric front-back trajectories on the median plane are fragile.
- **Distance multi-cue** (Begault 1991; DRR direct/reverberant):
  intensity + spectrum + DRR + motion parallax — position alone is a
  weak cue → position→reverb/send/absorption coupling required.
- **Spatiomorphology** (Smalley 1986–2007): source bonding, spatial
  texture, **gestural surrogacy** (remote/1st/2nd/3rd order). Spatial
  motion in acousmatic diffusion *is* the formal structure — the
  domain's deepest theoretical framework.
- **Stream segregation** (Bregman 1990): spatio-temporal continuity
  preserves the auditory object's identity; jumps break it. STAGESPACE's
  `anchor:current`/`end:hold` mechanism is literally the implementation
  of Bregman — object continuity made operational.
- **Change blindness / attention** (Mack & Rock 1998): a single salient
  movement is perceived — the "only one object moves at a time" rule
  is perceptually founded.

### 1.2 Composition / spatial dramaturgy

- **Kendall (2010)**: spatialization as a compositional tool — gesture
  taxonomy (orbiting, approaching, dispersing, converging).
- **Peters, Schacher (spatDIF, 2013)**: the trajectory as a musical
  gesture — a phrase with accent/phrasing, not an automaton.
- **Vande Gorne** (space of sound, acousmatic diffusion): the
  *diffusion score* — spatial conduite notated like a score.
- Stockhausen (Gruppen, Kontakte), Boulez (Répons): spatial
  counterpoint = independent trajectory rhythms; elevation as register.

---

## 2. State of the art — benchmarks

| Tool | Strength | What STAGESPACE takes from it |
|---|---|---|
| **L-ISA** (L-Acoustics) | per-object pan/width/elevation/distance, DeskLink snapshots | object_channels ✓; distance-coupling to make explicit |
| **d&b Soundscape** | En-Scene positions + coupled En-Space reverb | zones ✓; position→send via signal graph |
| **TiMax SoundHub** | per-cue image definition, PanSpace multi-touch, UWB Tracker | cues ✓; park = image protection |
| **SPAT Revolution** (Flux) | source→room→master, binaural prelisten, multi-renderer | positions-only = compatible; bounce to do |
| **Spacemap Go** (Meyer) | spacemaps = speaker proximity-weights | zones ✓ |
| **Holophonix** (Amadeus) | embedded trajectories + hardware | direct ancestor — we surpass (compiled graph) |
| **4DSOUND/MONOM** | spatial dynamics, "instrument" | spatial energy compression — to do |
| **Zactrack/BlackTrax** | PSN/RTTrP tracking | **missing protocol** |
| **dearVR SPATIAL CONNECT** | VR+gesture positioning | concept: drawing in space |
| **Sound Particles** | particle fields + physics | swarm ✓ close |
| **Klang** | 3D IEM monitoring | spatial monitoring (not just rendering) |
| **Panoramix, Compass/SPARTA** | open research (IRCAM, Aalto) | implementation references |
| **Zirkonium, TOSC, spatDIF** | spatial editor ancestors | history |

---

## 3. The four conduites (`docs/conduites/`)

| Doc | Genre | What it requires |
|---|---|---|
| **A — ORBE** | Acousmatic, fixed work | cue list + score, notated gestures, park, canon, loom |
| **B — GRID** | Spatialized DJ | busking, solo, hold/anchor chaining, TC, panic, soundcheck |
| **C — SILLAGE** | Danced theatre | PSN follow-me, tracking cues, protective park, dry-run |
| **D — TRAVERSE** | 75' multimedia | master video TC, parked live objects, generative+cues+busking, media sync |

Full domain coverage: composition (A), performance (B),
living scenography (C), multimedia (D).

---

## 4. Capability audit — engine vs conduites

**Fully playable: A** (ORBE).
**~85% playable: B, C, D** — two functional gaps:

| Gap | Blocks | Effort |
|---|---|---|
| **`anchor:follow`** — anchor tracking the target (orbit around the mobile) | C, D | medium — read `last_position` per frame |
| **PSN/RTTrP ingest** — industry protocol | C, D | medium |
| Soundcheck walk | B | trivial |
| Media sync out (cue→trigger) | D | medium |
| Confidence view / legibility meter | all | small–medium |
| Vection gesture | B | small |

**Capability verdict**: the engine holds the 4 conduites. The compiled
`f(t)` graph + `anchor`/`hold` = implemented object continuity — ahead
of the state of the art.

---

## 5. Ergonomics audit — the operator in the conduite

The functional audit isn't enough: **the question is what the operator
can see/do during the show.**

### By conduite

**A (diffusion)**: cue/current visible ✓; missing **audition before
emission** (see the next cue without playing it), **fixed 2D radar
view** (manipulable 3D isn't a conduite tool), **per-object park
marking**.

**B (busking)**: playable slots ~; missing **play surface** (pad grid
readable at distance, colored playing/fading/solo'd states), **manual
position indicator** ("you are holding this object").

**C (theatre)**: missing **per-object control source** (move/manual/
PSN/park/hold — *why this object is there*, THE major gap), **PSN
health** (age of last frame — a cut stream silently freezes), **scope
diff** (what the tracking cue will write vs protect).

**D (multimedia)**: missing **single dashboard** (transport+pads+cues+
health on ONE screen — currently scattered), **visible TC lock**,
**operational log** (who GO'd when, which NACK).

### The 5 cross-cutting gaps

1. **Per-object control source** — why it's there (move/manual/PSN/
   park/hold) — colored badge per object. *The question every operator
   asks 100 times per show.*
2. **Fixed 2D radar view** — readable fixed plan vs manipulable 3D.
3. **Stream health** — PSN/TC/OSC: last-frame age, lock, error rate —
   a status banner, not toasts.
4. **Audition before emission** — cue preview (not just move).
5. **Dedicated play surface** — Conduite window = a start;
   pads/holds/solos designed to be *played*, not administered.

**Ergonomics verdict**: the engine holds the conduites; the **operator
experience** doesn't. We have the track — not yet the tower.

---

## 6. Consolidated gaps + roadmap

**Engine (capability)** — order:
1. `anchor:follow` (dynamic orbit — unblocks C/D)
2. PSN/RTTrP ingest (industry tracking)
3. Soundcheck walk, media sync out, vection gesture, confidence view

**Domain (tooling)**:
4. Legibility/looming/vection meters (perceptual vu-meter)
5. Distance reality layer (Zahorik ×1.4)
6. Auto-venue adaptation (same conduite, different venues — *the
   differentiator absent from the market*)
7. Diffusion score view, trajectory library (Peters taxonomy), rehearsal
   capture, binaural bounce

**Ergonomics (the tower)**:
8. Per-object control source (gap #1)
9. 2D radar view, stream health, cue audition, play surface

---

## 7. Bibliography

**Spatial perception**
- Harris, J.D. & Sergeant, R.L. (1971). "Monaural/binaural minimum audible
  angles for a moving sound source." *J. Speech Hearing Res.*
- Perrey, S. & Nobbe, S. (2001). "Minimum audible angle revisited." *JASA*.
- Rakerd, B. & Hartmann, W.M. (1986). "Localization of sound in rooms, II."
  *JASA*.
- Neuhoff, J.G. (2001). "Adaptive listener bias in auditory motion
  perception." *Nature*.
- Bach, D.R. et al. (2009). "Looming sounds as warning signals." *PNAS*.
- Zahorik, P., Brungart, D.S. & Bronkhorst, A.W. (2005). "Auditory distance
  perception in humans." *JASA*.
- Wightman, F.L. & Kistler, D.J. (1989). "Headphone simulation of free-field
  listening." *JASA*.
- Begault, D.R. (1991). "Preferred sound source increase in reverberant
  environments." *JAES*.
- Riecke, B.E. et al. — studies on auditory vection / self-motion.
- Blauert, J. (1997). *Spatial Hearing*. MIT Press.

**Compositional theory**
- Bregman, A.S. (1990). *Auditory Scene Analysis*. MIT Press.
- Smalley, D. (1986–2007). "Spectromorphology and spatiomorphology."
  *Organised Sound*.
- Kendall, G.S. (2010). "Spatialization as a compositional tool."
  *Organised Sound*.
- Peters, N. & Schacher, J. (2013). "SpatDIF — Spatial Sound Description
  Interchange Format." *ICMC*.
- Vande Gorne, A. — writings on the space of sound / acousmatic diffusion.
- Truax, B. (2001). *Acoustic Communication*. Ablex.

**Tools / systems**
- Pulkki, V. (1997). "Virtual sound source positioning using VBAP." *JAES*.
- SPAT (Jot, IRCAM) · spatDIF · Zirkonium (Hannover WFS) · TOSC · MNTN ·
  OpenMixer · Compass/SPARTA (McCormack, Politis — Aalto) · Panoramix.
- L-ISA (L-Acoustics) · d&b Soundscape En-Scene/En-Space · TiMax SoundHub +
  Tracker · Meyer Spacemap Go · SPAT Revolution (Flux) · Holophonix
  (Amadeus) · 4DSOUND/MONOM · Sound Particles · dearVR SPATIAL CONNECT ·
  Klang:technologies · Usomo (Fraunhofer) · Sonic Emotion · Yamaha AFC.
- **PSN/RTTrP** — PosiStageNet: industry tracking protocol
  (BlackTrax, Zactrack, Follow-Me, StagePrecision).
- MPEG-H · ADM/S-ADM — object-based audio standards.
