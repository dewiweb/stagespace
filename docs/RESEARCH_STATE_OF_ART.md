# State of the art — Spatial trajectories, effects and interfaces for live immersive audio

> **Status: research reference** — landscape + implications; §5.2's
> roadmap items land in `ROADMAP_GRAPH_GLOBAL.md` (P6+).

Consolidated research document — analysis of the software landscape, the
academic literature (HAL, NIME, ICMC, DAFx, JAES, JIM) and strategic
positioning of STAGESPACE. In-depth version.

---

## PART I — Spatial trajectory generation

### 1.1 Mapping: four tool families

```
FAMILY A: RENDERERS (spatialization + native audio)
  Holophonix, SPAT Revolution, L-ISA, d&b Soundscape DS100,
  SpatGRIS, Sound Trajectory, Panoramix, Zirkonium, SSR, ViMiC,
  TiMax SoundHub/panLab, FletcherMachine (Adamson),
  Yamaha AFC Image, 4DSOUND, Meyer Spacemap Go, Klang
  → audio rendering AND positioning interface
  → 2024-25 convergence: all integrate a "trajectory engine"

FAMILY B: TRAJECTORY SEQUENCERS/AUTHORS (no audio)
  IanniX, ossia score, ControlGRIS, Grapes 3D,
  ToscA/OSCAR, Trajectory Score Library, Wwise Automation
  → positions/OSC to an external engine

FAMILY C: GENERATIVE ENGINES / AUTONOMOUS AGENTS
  Egregore (chdh), Carpentier/Gerzso vector fields (IRCAM),
  PolyNodes (sonicLAB), Spatbox, L-ISA FX Engine, ImmLib,
  ambicontrol (ICST/Schacher)
  → emergent movements rather than drawn trajectories

FAMILY D: INTEROPERABILITY ECOSYSTEMS
  ADM-OSC, OSCQuery, SpatDIF, PosiStageNet, RTTrPM (BlackTrax),
  En-Bridge, Chataigne, libmapper, Open Stage Control
  → bridges, standards, vendor ↔ renderer normalization
```

### 1.2 Family A — Renderers with built-in motion

| Tool | Trajectories | Generative | Live | Limitation for STAGESPACE |
|-------|--------------|-----------|------|------------------------|
| SPAT Revolution | LFOs + drawn trajectories, absolute/relative, ping-pong | No | Reference | Closed animation engine, no node graph |
| L-ISA Controller | Snapshots + FX Engine (3.0) reactive | Yes (recent) | Broadcast-grade | Proprietary, tied to hardware |
| Holophonix | Motion Engine: linear + generative + boids | In dev | Yes | Simple trajectories, no node composition |
| Sound Trajectory (TripinLab) | 3D drawn paths + sampler + mobile listener | No | Studio+live | Ambisonic only. v2 code published GPL (hal-04950075) |
| SpatGRIS + ControlGRIS | Trajectories via DAW plugin | Partial (audio-reactive v4) | Yes | Fixed presets |
| Sound Particles | Particle systems | Yes (physics) | Post-prod | Not live real-time |
| Panoramix (IRCAM/STMS) | Post-prod workstation | No | No | Post-production |
| Zirkonium (ZKM) | Mathematical events + timeline | Partial | Yes | macOS only |
| SSR | WFS/HOA/binaural, real-time scenes | No | Yes | Rendering, no motion authoring |
| **ViMiC** (CIRMMT/RPI) | **Virtual microphones** in a virtual room | No | Yes | Inverted paradigm — see §1.6 |
| **TiMax SoundHub/panLab** | Dynamic delay-matrix + drawn trajectories + Tracker | Partial | Theatre reference | Proprietary matrix, no graph |
| **FletcherMachine** (Adamson) | Integrated trajectory engine + reverb ×3 + binaural | Partial | Yes (1.3 ms, 128×128) | Dedicated hardware, non-composable per-object trajectories |
| **Yamaha AFC Image** | 128 objects, speaker zones (×32), 3D reverb, tracking | Partial | Yes | Yamaha ecosystem (RIVAGE/CL/QL) |
| **4DSOUND** | Dimensional objects (size/shape/behavior), particles, Python scripting | Yes | Yes (installations) | System+venue-bound, no open standard |
| **Meyer Spacemap Go** | Nodal spatial maps on Galaxy | Partial | Yes | Meyer hardware-bound |
| **Klang** | Immersive in-ear monitoring | No | Yes | Binaural IEM, not trajectories |

**Pass 2 key points**:

- **TiMax** (Out Board, UK) is the reference show-control renderer in
  theatre: its *dynamic delay-matrix* spatializes by delays (not gains),
  localization survives outside the sweet spot; **TrackerD4** (UWB AoA+TDoA)
  outputs OSC, PosiStageNet, sACN/Art-Net (via Stage Precision) → native
  bridge to SoundHub, Soundscape, L-ISA, GrandMA, disguise, ETC Eos.
  **TiMax TimeLine** orchestrates MIDI/MTC/Follow-On/XML-UDP cues + OSC
  bidirectional to QLab, SSL, Grapes, panLab. And a strong 2025 signal:
  **TiMax MCP** — first spatial renderer with Model Context
  Protocol integration (AI assistant). Show-control interoperability is
  their DNA.
- **FletcherMachine** (Adamson): amplitude+time localization object
  engine, up to 3 autonomous reverb engines, **integrated trajectory
  engine**, console/DAW/VST control, native ADM-OSC + MIDI/OSC/PSN/RTTrPM,
  leader/follower multi-remote hierarchy, head-tracked binaural. The
  renderer ↔ tracking ↔ show-control convergence is already there.
- **Yamaha AFC Image**: 128 objects, **speaker zoning** (32 zones) — an
  object can be restricted to a subset of speakers; automatic
  conversion of DAW movements to the real layout; control from
  RIVAGE/CL/QL consoles; object tracking. **AFC Enhance**: the room
  itself as an effect (see §2.9).
- **4DSOUND** (Amsterdam/Berlin): the most radical — the source isn't a
  point but a **dimensional object** (size, shape, behavior);
  "sound holograms" via 20+ algorithmic particle shapes, Python
  scripting, arbitrary asymmetric layouts, NAP framework. It
  conceptualizes what our `formation`/`spread` barely touches: the
  *dimension* of the source as a composition parameter.
- **Spacemap Go** (Meyer/Galaxy): nodal panning via spatial "maps"
  on iPad — proof that the nodal paradigm is adopted in pro products,
  but still locked inside a hardware ecosystem.

### 1.3 Family B — Trajectory sequencers

| Tool | Paradigm | Limitation |
|-------|-----------|--------|
| IanniX | Poly-temporal score: cursors + curves + triggers, B-splines | No signal processing, no agents |
| ossia score | Interactive timeline + nodal, Path generator | Generalist |
| Grapes 3D | Clip matrix (8×8) × 64 tracks | No generative, no graph |
| ControlGRIS | DAW plugin, presets | No composition |
| **ToscA/OSCAR** (IRCAM, Carpentier) | DAW plugin: 32 automatable params → OSC | Transport channel, not an engine |
| **Trajectory Score Library** (Babouri, Antescofo) | Parametric functions → curves → Spat5/SpatGRIS | Synchronous language, learning curve |
| **Wwise 3D Position Automation** | Animation paths, emitter/automation/listener, ShareSets | Closed, video-game oriented |
| **ambicontrol** (ICST) | Behaviors + XML breakpoint trajectories + logical chains | ICST-internal Max object |

**Key point**: ToscA solves the historical problem — DAWs have timelines
but weak multichannel; Max/Pd spatialize but have no timeline.
That's exactly the gap STAGESPACE also fills: neither DAW nor patcher, a
dedicated motion engine.

### 1.4 Family C — Generative: the formal models

**The mathematical taxonomy of trajectory engines** (synthesis of the
literature):

1. **Parametric**: each coordinate = function of time (LFOs). Spatbox,
   TSL/Antescofo, our orbital engines. Predictable, controllable, boring
   in extended use.
2. **Traveled path**: drawn curve + speed law. IanniX (B-splines),
   DrawSpline, ambicontrol (XML breakpoints), Wwise (animation paths).
   Expressive but frozen.
3. **Agent-based**: local rules → emergent motion. Steering (seek/flee/
   arrive/wander/pursuit/path-following/obstacle-avoidance), boids
   (separation/alignment/cohesion — Reynolds 1987), vector fields
   (Carpentier/Gerzso). Perpetual, organic, never repetitive.
4. **Hierarchical vs emergent** — Schacher (NIME 2007, "Gesture Control of
   Sounds in 3D Space"): THE reference formalization. Sources have
   physical-object properties; motion is manipulated by standard
   geometric transforms (rotation, translation, scaling) applied via
   **hierarchical** relations (a tree: a parent drives its children —
   our `BarycentricGroup`/formations) or **emergent** ones (local
   behaviors producing global organization — our `swarm`/merge).
5. **Parameter fields** (ImmLib, Negrão): spatial patterns controlled by
   mathematical functions defined on a surface — widened/diffuse sources
   by copy decorrelation. Audio equivalent of our Falloffs.
6. **Poly-temporal score** (IanniX): time, space and cursor speed are
   independent dimensions — the same path can be traveled at multiple
   simultaneous speeds by different cursors.

### 1.5 Newly identified direct predecessors

- **ToscA → OSCAR** (IRCAM): automation↔OSC bridge, model for our
  extended control channels (32 exposed params, XML mapping file,
  bundles, polling rate).
- **Trajectory Score Library**: parametric functions in a synchronous
  language (Antescofo) → synchronization of trajectories to musical
  events. The "trajectory synchronized to tempo/event" concept — our
  BPM-reactor is simpler but less precise.
- **ambicontrol** (ICST): behaviors (rotation, translation, bounded
  random walk) + breakpoint trajectories + **logical module chains** —
  the direct ancestor of nodal motion composition.
- **ViMiC** (Braasch/Peters/McAdams, JAES 2005, CMJ 2008): **inverted
  paradigm** — instead of moving sources, you move virtual microphones
  inside a virtual room; simulates coincident/spaced microphone
  techniques. → `VirtualMic` node? The listening position as a
  composition object.
- **ImmLib** (Negrão, SuperCollider): parameter fields — spatial pattern =
  function on a surface; decorrelation → widened sources. Model for
  audio-domain Falloffs.
- **abclib** (Bonardi, CICM Paris 8): Faust library — trajectory
  generators + spatial processes (decorrelators, delays, granulators,
  ring-mod) in syn/fx modes. 20 years of mixed-music research.

### 1.6 Movement psychoacoustics — the missing link

This is the most important part for engine design:

- **MAMA** (Minimum Audible Movement Angle, Perrott & Musicant 1977,
  Perrott & Tucker 1988): 8.3° at 90°/s → 21.2° at 360°/s. Dynamic
  spatial resolution **drops with velocity**.
- **Relevance threshold**: below ~32°/s, little degradation; beyond,
  motion becomes blurry. A fine movement at 200°/s is imperceptible.
- **Onset displacement**: the appearance of a moving source is perceived
  **displaced in the direction of motion**, proportionally to
  velocity — the sound arrives "ahead of" where it is. Trajectory
  attacks have a systematic directional bias.
- **Frequency**: dynamic resolution is poor between 1300-2000 Hz, better
  below 1000 Hz (like static localization).
- **CNMAT bound** (OSC best practices): the useful control rate of a
  spatial effect is **0-50 Hz**. Beyond ~10 Hz, a rotating directivity
  stops being perceived as rotating — **perceptual fusion** into timbre
  (this is the psychoacoustic foundation of SMS, §2.4.F).
- **Self-motion**: the audience detects the motion of their own head
  better than that of sources (Brimijoin 2014) — argument for listener
  tracking.

**Direct implications for STAGESPACE**:
1. Fast trajectories are perceptually **blurry**, not precise —
   SMS orbits exploit this as a feature.
2. Our runtime's 60 FPS far exceeds perceptual resolution;
   it's the network/renderer that bounds, not the ear.
3. `PerceptualVelocity` nodes: convert spatial velocity into °/s around
   the listener to stay in the useful perceptible band.
4. Onset-displacement compensation could be a node (advancing the
   spatial phase of an attack).

### 1.7 The acousmatic diffusion tradition — cultural context

France has a tradition of **live spatial performance** predating
everything above:

- **Acousmonium** (Bayle, GRM, 1974): 60-80 differentiated loudspeakers +
  diffusion console. **Diffusion** = live interpretation: the
  "projectionist" routes/balances the fixed medium over the loudspeaker
  orchestra. "A successful concert depends on the risks taken live."
- **Tutschku**: interpretation vs reproduction debate — training
  **specialized interpreters**, not just operators.
- **"Fractured acousmatic"** (method for diffusion): fixed compositions +
  flexible performance structures → interpretive freedom.
- **Stansbie** (ontology): acousmatic performance as an agent-centered,
  intentional enterprise.
- **Landy / Intention-Réception** (zenodo.18898493): listeners
  perceive spatialization **relative to the sonic content and
  dramaturgy** — spatial motion must serve a narrative, not exist
  for itself.
- **ESPRO** (IRCAM): variable-acoustics hall (périactes, RT 0.4-4s) +
  264 WFS speakers + 75 HOA speakers. Original goal of Spat (1993):
  "manipulable **without knowledge of the technology** with an
  unlimited number of speakers" (Warusfel) — the founding design goal,
  valid for us.

**Reading**: STAGESPACE belongs to this lineage — it's a **generative
diffusion console**: where the projectionist played faders on a fixed
medium, the STAGESPACE operator plays motion graphs. The cuelist
+ panic + keyboard = the modern projectionist's cockpit.

### 1.8 STAGESPACE differentiation

What nobody else does:
1. **Node graph compiled to continuous f(t)** (Lithe proved it, no product)
2. **Global post-process on the merge** (generative "spatial master bus")
3. **Parallel multi-movements + merge strategies**
4. **Hierarchical spatial macros**
5. **Native Rust audio-reactor**
6. **Multi-profile middleware** (Holophonix, IEM, IRCAM Spat, ADM-OSC, generic)
7. **Atomic cue list + keyboard + panic** (stage-manager cockpit)

### 1.9 What the renderer does with our positions — panning algorithms

Our output (xyz/aed + channels) is interpreted by very different
rendering algorithms — understanding their properties conditions what we
send:

- **VBAP** (Pulkki 1997): panning by speaker pairs/triplets. Industry
  standard (MPEG-H). Known limitation: gain jumps when crossing triplet
  edges → a continuous circle produces perceptible micro-jumps;
  perceived spread fluctuates during motion. → Our fast trajectories
  amplify this defect.
- **MDAP**: VBAP + multiple phantom sources → continuously variable
  spread.
- **DBAP** (Lossius, ICMC 2009 — **SpatGRIS** engine): distances to
  speakers, **no sweet spot**, irregular/arbitrary layouts. It's
  the algorithm of modern acousmatic diffusion — suited to the
  non-canonical setups where the user lives.
- **AllRAP / Ambisonics Equivalent Panning**: stable loudness +
  adjustable width — close to the ambisonic "spread".
- **Delay-matrix** (TiMax): localization by **time** rather than gains —
  more robust for the whole audience, but dependent on the calibrated
  matrix.
- **WFS / HOA / binaural**: full field synthesis / spherical
  harmonics / HRTF — the spatial params don't have the same
  semantics (W = pressure, ACN coefficients vs object position).

**Consequence**: the semantics of our extended channels (`spread`,
`distance`, `aperture`) is **not universal** — each renderer
translates it into its own model. The per-profile capability matrix (P1)
must document this translation, not just the OSC address.

---

## PART II — Live audio effects in spatial environments

### 2.1 The conceptual shift

```
PARADIGM 1: the effect processes the SIGNAL     (delay on the track)
PARADIGM 2: the effect is attached to the SOURCE (the sound "carries" its reverb)
PARADIGM 3: the effect lives in SPACE           (the zone reverberates what crosses it)
PARADIGM 4: the effect IS the motion            (the trajectory produces the timbre)
```

### 2.2 A. "Free" effects of motion (Chowning 1971)

Angular cues (panning), distance (direct/reverb + air absorption), velocity
(Doppler). Dodge (eContact 10.3): Doppler as a detuner — bug or feature,
composition parameter. Implementations: IEM RoomEncoder, dearVR PRO 2,
Steilacoom (DXARTS).

### 2.3 B. Perceptual factors (IRCAM Spat, Jot & Warusfel 1995)

Presence, brilliance, room presence, early width, ASW, radiation
(directivity, orientation, aperture). All available over OSC on SPAT
Revolution → control channels exploitable by the graph. The perceptual
model = DSP param vector.

### 2.4 C-F. Field transformations, SFFX, granular, SMS

- **Ambisonic transforms** (ambix, ATK, Zotter & Frank): rotation, mirror,
  dominance, focus/push, directivity, warp — on the whole field.
- **SFFX**: FOAFX (RISD), Sluicer (NIME 2024 — effects locked to
  coordinates, sound crossing the zone is transformed), Beamix
  (beamformed sectors + FX chains), IEM DirectionalCompressor, COMPASS
  sidechain.
- **Spatial granular**: GRM SpaceGrain, IEM GranularEncoder, spatial
  grains, Faust granulator (hal-04849708).
- **SMS** (Cadambi, ICMC 2015): orbits >20 Hz → FM/AM/granulation by
  perceptual fusion. **The CNMAT 0-50 Hz bound scientifically grounds it**:
  beyond fusion, spatial modulation becomes timbre — that's precisely
  what SMS exploits as an effect.
- **Parametric** (McCormack, COMPASS): multi-source+ambient decomposition →
  directional warping, listener translation, source tracking, spatial
  sidechain. compass_sidechain = a scene modified by the analysis of
  another.

### 2.5 Distributed effects and the room-as-instrument

Spatial delay/feedback/looping/compression (UCSB thesis), Auxtrument
(distant real rooms networked), CAVIAR (live artificial IRs, CCRMA 2025),
Performing Performance Spaces (NIME 2026), L-ISA Room Engine, En-Space,
Spat interpolation between rooms.

### 2.6 Temporal engineering — the reliability layer

- **OSC timetags** (Freed): 64-bit NTP, jitter attenuation, relativistic
  clocks for ad-hoc networks without an NTP master.
- **Simple Sync OSC** (CNMAT 2015): master/slave → 166µs WiFi, 100µs
  Ethernet, acoustic localization 1.8mm stddev.
- **AES11**: inter-channel sync ±5% per sample — phase artefacts
  in arrays are a real problem.
- **µOSC**: millimetric jitter degrading sensor streams.
- **NetMusic3D**: clock drift compensation, <5ms software latency.
- **Gestural bandwidth**: ~68 bits/sec of temporal information for a
  human gesture — our data flows are perceptually oversized.

**Implications**: positions at 60 Hz OK; multi-app shows want a
common clock (timetags or Ableton Link); jitter monitoring useful in
perf-stats.

### 2.7 Concrete extensions for STAGESPACE

1. **Extended control channels**: spread/distance/gain/presence/lfe —
   position + N parameters per object (ToscA model).
2. **`Zone`/`FieldGate` node**: 3D volumes → trigger/ramp/gradient → OSC
   params. Control-side SFFX.
3. **Kinematic nodes**: Velocity/Acceleration/Jerk → modulators.
4. **`Proximity` node**: inter-object distances → coupling, ducking.
5. **SMS mode** on orbits + adaptive rate limiting.
6. **`VirtualMic` node** (ViMiC): composing the listening position.
7. **OSC timetags / Ableton Link** for multi-app sync.

### 2.8 Positioning: spatial effects orchestrator

STAGESPACE = **composer/orchestrator of spatial effects**: the renderers
are the instruments, the node graph is the score that says when, where
and how to transform sound in space and time.

### 2.9 Active acoustics — the room itself as a parameter

The "room-as-instrument" (§2.5) has a mature industrial lineage —
**active acoustics** systems control the venue's real reverberation
through mic→DSP→speaker networks:

- **Meyer Constellation** (on NADIA engine): reverberation time control,
  early reflections, "effective cubic volume" —
  per-scene presets, regenerative + in-line hybrid.
- **Müller-BBM VIVACE**: recallable acoustic scenarios
  (symphonic/opera/speech), mics on stage and in the hall.
- **CSTB Carmen**: "active virtual wall" — French physical approach,
  several equipped venues.
- **Yamaha AFC Enhance**: regenerative approach (controlled feedback
  loop) OR in-line (convolution); can apply ambience to audience
  sounds in real time.
- **d&b En-Space**, **LARES** (the ancestor), **L-ISA Room Engine**:
  convolutional rooms controllable by automation.

**Consequence for STAGESPACE**: in a venue equipped with active
acoustics, "the room" is a cue parameter just like positions. A
`Room` node (acoustic scenario selection by cue/zone) integrates
naturally — the effects orchestrator extended to the building.

### 2.10 The "motion-reactive" plugin market — commercial validation

Sound Particles packaged the **audio→position** paradigm into VST
plugins — market proof for our audio-reactor:

- **Energy Panner**: intensity → position (pan or sliding mode).
- **Brightness Panner**: spectrum/pitch/MIDI → defined 3D trajectory.
- **Beat Panner**: **tempo-synced** panning sequencer.
- **Space Controller Studio**: smartphone as 3D pointer → DAW.
- **Doppler** / **Air**: reference physical distance/atmosphere
  emulation (Sound Particles engine).
- **inDelay**, **Density**, **GrainDust**: granular spatial FX.
- **E4L (Envelop for Live)**: open-source ambisonic M4L toolkit —
  encoders + custom decoder + AuraVerb + **ADM-OSC out** +
  EnvelopLX link (LED light synchronized to spatial sound!).

**Reading**: reactivity is commercially validated but locked inside
mono-format plugins. STAGESPACE does the same thing **between** the DAW
and renderers, over OSC, without touching audio — with the graph as the
reaction language instead of presets.

---

## PART III — Human-machine interfaces (HCI)

### 3.1 The formal model of gestural spatial control

**Schacher (NIME 2007)** is the reference: gesture→motion mapping via
physical-object properties + geometric transforms + hierarchical/
emergent relations. Chain: device → preconditioning/normalization
(OSC namespace) → analysis (dimensionality) → mapping → behaviors →
output.

**Marshall et al. (ICMC 2006)**: GDIF, spatialization by the performers
themselves. **Bukvic**: NISME — intuitive/natural + scalable/adaptable.
**Quiroz**: isotonic/isometric/elastic.

### 3.2 libmapper — the reference mapping infrastructure

IDMIL (Sinclair, Malloch, Wanderley): decentralized network of I/O
signals, dynamic mappings with **mathematical conditioning
expressions** (scaling, derivatives, integration, filtering,
smoothing), address/datatype translation, Webmapper for visualization.
MapLooper: mapping looping, 4.81ms round-trip @100Hz. **Direct model
for our OSC IN mapping**: not fixed addresses, composable expressions.

### 3.3 Interface research

- **xrOSC** (NIME 2024): Quest 3, isotonic absolute 6DoF → OSC backend.
- **AudioMiXR** (ACM 2025): Vision Pro, n=27 → SUS ↑, NASA-TLX ↓,
  creativity ↑ vs 2D panner.
- **ARMixer**: AR scene metaphor, mixing by the musicians.
- **Invoke** (CHI 2023): vocal trajectory sketching, collaborative.
- **Beyond Faders** (2025): 6DoF gestural ecologies, ecological
  validity.
- **Gesture-based Atmos** (NIME 2025): Leap Motion → Atmos Panner.
- **6DOFpanner** (Quiroz): Leap+SpaceMouse→MIDI, **clutching**
  mandatory.
- **spAAce**: trajectory drawing → WFSCollider.
- **Gelineck & Serafin** (AM'15): haptics (Falcon) > Leap Motion,
  without visual feedback; active haptic guidance rejected.
- **Metabow** (NIME 2025): IMU bow, hybrid direct+ML mapping.
- **Parametric speakers** (NIME 2025): the body as trajectory engine.

### 3.4 The diffusion console as historical HCI model

The Acousmonium is the **oldest HCI model of live spatialization**:
centralized console, per-speaker/group faders, the projectionist
"plays" space. Lessons: direct per-channel/group control, macro
gesture (large, envelope), gestural interpretation on fixed material.
The STAGESPACE cockpit = its nodal heir.

### 3.5 The dewiweb ecosystem — the control-room cockpit

69 repos = a **builder-stage-manager** assembling a cockpit:

```
PHYSICAL CONTROL → OSC          BRIDGES              PRO AV INFRA
  spacemouse-osc (16★, 6DoF)       MCxOSC/MCxOSCnext    AES67 driver+visualizer
  X-Touch module                   emberplus_rust       audio-accessibility
  open-stage-control               sofie-emberplus      dewicom (intercom)
  companion-module-* (StreamDeck)  NodeOSC (Blender)    rpi-media-kiosk
  XCTL_ (Behringer doc)                                clock_X_overlay

TRAJECTORIES → STAGESPACE
  chataigne_spatiale → holophonix-chataigne → holophonix-animator
  → trajectoires-modern → nodes-trajectories → STAGESPACE
  (animation_nodes corpus: graph→native compilation, Falloffs)
```

**STAGESPACE = the motion engine at the center of this existing cockpit.**
The natural interface isn't a new UI — it's OSC IN/OUT wired to
SpaceMouse + X-Touch + StreamDeck + Chataigne already mastered.

### 3.6 HCI lessons for STAGESPACE

1. DoF matching: integrate 6DoF (SpaceMouse via OSC IN or native).
2. Clutching mandatory on every relative control.
3. Haptic/physical > visual in live (StreamDeck, motorized X-Touch).
4. Scene metaphor > channel-strip.
5. The node graph is a validated HCI choice (TouchDesigner, Blender, Max).
6. The 3D preview = projectable performance asset (reacTable).
7. Multi-operator collaborative via multi-source OSC IN.
8. Practical sweet spot: desktop app + 6DoF device > full XR setup.

### 3.7 Mapping by demonstration — Wekinator and gestural ML

**Wekinator** (Fiebrink, Trueman, Cook — NIME 2009, 2025 citations) is the
reference system for *mapping-by-demonstration*: instead of programming
the gesture→parameter mapping, you **show examples** and the model
(regression, classification, DTW) learns the correspondence. Native OSC
in/out — designed exactly for our layer.

**Lesson**: STAGESPACE's OSC IN mapping doesn't need internal ML —
but the architecture must allow inserting such an external engine
between OSC IN and the graph params (Wekinator/Glover/MuBu
already speak OSC). The graph is the target, not the learner.

**MuBu** (IRCAM ISMM): the Max toolbox for gestural analysis —
XMM (GMM/HMM recognition), PiPo (descriptors), mubu.track — the link
between sensor and learned gesture recognition.

### 3.8 The tangible and the wearable — screenless control

- **TUIO / reacTIVision**: the tangible table protocol (tracked physical
  fiducials/objects → OSC position+rotation). A TUIO table = physical
  spatial control surface: moving an object = moving a source.
  Open protocol, trivial to consume — our `follow` can track a
  fiducial.
- **mi.mu Gloves / Glover**: flex+IMU gloves → trainable ML postures
  (9/session), MIDI+OSC out, **embedded haptics and LED** (screenless
  feedback). The most commercially accomplished "music through
  movement" paradigm — and its posture→scene↔parameter mapping logic is
  exactly that of a cuelist.
- **MPE** (ROLI Seaboard, LinnStrument, Sensel Morph, Continuum): 5
  dimensions per note (strike/press/glide/slide/lift) — the standard
  polyphonic expression channel. Each "note" can be a spatial
  object whose position follows glide/slide — object↔voice model.
- **Buchla Lightning/Thunder**: wireless X/Y wands — ancestor of
  spatial gestural control (Pamela Z).
- **Neova/Genki Wave, MUGIC, SOMI-1**: gestural rings/sensors — the
  wearable reaches "stage musician" level, not researcher.

### 3.9 Haptics — the missing sense

- **Ultraleap STRATOS**: mid-air haptics by ultrasound (256 transducers,
  focal points modulated at 40 kHz → contactless tactile sensations,
  coupled with Leap Motion hand-tracking). Virtual buttons/sliders/
  textures in the air — the diffusion console without a console.
- **Falcon/Novint** (Gelineck & Serafin, already cited): force feedback >
  visual tracking when the screen is busy.
- UCL research (2023): **sonification of haptic textures** modifies
  bodily perception and motor behavior — audio and haptics
  are one crossed perceptual channel, not two separate modalities.

**Lesson**: the haptic priority for STAGESPACE isn't exotic
hardware — it's **feedback into existing devices**: mi.mu LED/motor,
motorized X-Touch faders, StreamDeck vibration. Sending state back
(active cue, OSC error, position) to the device is as important as
receiving its inputs.

### 3.10 The ancestors — the conducting gesture

**Max Mathews, Radio Baton + Conductor Program** (CMJ 15(4), 1991): two
wands tracked XYZ above a surface, **CONDUCTOR** modes
(conducting a score: tempo, dynamics, balances by gesture) and
**IMPROV** (the gesture drives composition algorithms). It's the
exact conceptual ancestor: the gesture doesn't write the music, it
**interprets prepared material**. Our graphs = the material; the
macros/OSC IN = the conductor's gesture.

Historical note: Mathews' "trigger plane + rearm threshold" (1970)
is the first documented gestural debounce — we have the same
mechanism in the falloffs/triggers.

### 3.11 Real-time patchers — Pure Data, plugdata, Max

**The previous pass's gap**: gestural HCI was covered, but
not the most direct interaction precedent — the real-time visual
patching environment usable *in performance*. That's exactly
what STAGESPACE is: a node graph whose execution surface stays
alive.

#### Pure Data (Puckette 1996→) — what was durably invented

- **The object as unit**: `[name arg1 arg2]` — creation by typing, args
  inline in the box, left inlet=hot/others=cold. STAGESPACE's palette +
  inspector are its structured equivalent (args → typed params
  in the panel).
- **Two visually distinct domains**: message cords (control) vs
  signal cords `~` — different thickness/color. Our equivalent to
  exploit: differentiate trajectory / duration / spline edges.
- **Abstractions + subpatches**: a .pd file is a reusable object
  (`$0` local scope, `$1..n` creation args). Our templates/`Custom`
  animations = proto-abstractions — the gap is "selection → palette
  abstraction" and instantiation args.
- **Graph-On-Parent**: a subpatch region exposes its GUI objects on
  the parent — the *performance surface is built from the same
  canvas*. Exact precedent for our on-demand Perform "params".
- **Help patches**: right-click → Help opens an **executable** patch
  that documents the object. Documentation is a graph, not text.
- **Text format**: the patch can be copy-pasted on a forum — Pd's
  sharing culture rests on that. `.hfg` JSON is diffable but not
  "pasteable" in the UI.
- **deken**: built-in externals package manager (Pd ≥0.47). Known
  weakness: unverified GPG signatures — our WASM host hardening
  (fuel, StoreLimits, zero imports) is already stricter.
- **Wireless `[send]`/`[receive]`**: named buses that declutter large
  canvases. For us: OSC mappings + MoveRef (and the decorative
  `move_id` — see the nodes audit).
- **Edit/Run (Ctrl+E)**: in Run only GUI objects respond — the patch
  is the instrument. = our Perform mode.

#### plugdata (Schoen, JUCE, AGPL) — the UX modernization, point by point

plugdata is the reference "how to make a patcher pro in 2024":

- **Three modes**: Edit / Run / **Present** — Present only shows
  objects *marked for presentation* (GOP formalized as a view). Direct
  gap: our Perform shows the whole schema of the selected node; a
  "pin to Perform" flag per param would produce a curated surface.
- **Sidebar**: inspector with 3 modes (auto/pinned/hidden), console,
  doc browser, DAW params panel.
- **Floating palette** (Ctrl+[), categorized, **custom palettes** —
  the user pins their frequent objects.
- **Autopatching**: dropping an object *on a connection* inserts it
  into the chain; Ctrl+K connects selected objects; Ctrl+D duplicates
  keeping connections. For us, modifier-on-edge-drop is the ideal
  case: Circular→Output + drop Scale = Circular→Scale→Output.
- **Connection activity display** (v0.9): cords animate when
  data flows — the canvas *lives* during execution. Our edges are
  static; pulsing the active move's graph edges is a natural live
  feedback.
- **Segmented cords with arrows at the elbows**, front/back toggleable.
- **Command input**: send a message to the selected object without
  creating a message box.
- **F1 = object reference, F2 = runnable help patch**. Our immediate
  equivalent: right-click a node → "Open example" loads the
  `shapePresets` template that uses it (the content already exists).
- **patch store** (v0.9.2) + redesigned deken: integrated community
  distribution. Our `.ssx` + import UI = local deken; a remote
  store/registry is the natural extension (with trust — see §plugins).
- **Heavy/hvcc**: the patch compiles to C++/VST/OWL/WASM. Same
  direction as us (patch → compiled code) — our compiler→f(t) already
  does that internally; *export* makes no sense for an OSC engine.
- **Plugin mode**: the patch runs as VST3/AU/CLAP/LV2 in the DAW,
  `[param]` exposed to automation, state saved with the project. Not
  applicable as-is (we emit positions, not audio) — but the
  lesson "the app accepts living *inside* the production host"
  matches the OSCQuery/MCP roadmap: being drivable is our "plugin mode".

#### Max — the commercial sibling

- **pattr/snapshot system**: recallable named states ≈ our cues.
- **Presentation mode**: direct precedent of plugdata's Present.
- **poly~**: patch multi-instancing ≈ our concurrent slots.

#### Mapping to what exists

```
ALREADY COVERED                           IDENTIFIED GAP
  Edit/Perform ≈ Edit/Run ✓                 Curated Present/pin-to-Perform
  Typed inspector ≈ inspector ✓             Autopatch: drop node on edge
  Categorized palette + hover ✓             Quick-add (canvas search)
  Target highlight + reject toast ✓         Animated edges (activity)
  Minimap, undo/redo, tabs ✓                Edge color-code by port
  .ssx + import UI ≈ local deken ✓          Runnable help (per-node template)
  PANIC ≈ safety limiter ✓                  Community store .ssx/.hfg
  Cues ≈ pattr/snapshots ✓                  Save-selection → abstraction
  Slots ≈ poly~ ✓                           Ctrl+D keeps connections
```

#### Lessons for STAGESPACE

1. **Perform must become "curable"** — GOP/Present prove that the
   live surface is a *chosen* subset of the graph, not the full
   schema. Our "params on demand" request converges: one pin per
   param suffices.
2. **Autopatch modifier-on-edge** — the most profitable gesture: our
   modifiers are precisely made to insert into a chain.
3. **Quick-add** — the Pd/Blender/plugdata pattern is universal:
   double-click canvas → type → Enter. The mouse-only palette is a
   known patcher bottleneck.
4. **Living edges** — activity display = free real-time feedback
   (we already have 60Hz positions runtime-side).
5. **Doc = a graph** — F2/help-patch: our templates exist, the
   node → "open an example that uses it" link is missing.
6. **Typed cords** — coloring trajectory/duration/spline clarifies
   reading (Pd has done it since 1996 between control and signal).
7. **The store is a sequel, not a v1** — deken→patch store shows the
   path: local first, remote later, mandatory signing before
   remote (deken knows this and doesn't do it — we can do better).

---

## PART IV — Production ecosystem: show control, co-creation, live coding

### 4.1 The cue model — what the live industry solved

Spatial audio didn't invent show control — lighting and video
industrialized it:

- **DMX512 → Art-Net/sACN (E1.31)**: addressed universes, per-channel
  priority (sACN 0xDD — a priority source takes over), HTP/LTP merge,
  discovery (ArtPoll, E1.31 universe discovery). The
  "channels + priorities + merge" model = exactly our merge strategies.
- **GrandMA / ETC Eos**: cue lists with tracking (only modified
  values change), follow/hang, partials, asserts, per-parameter
  timing, fanning. The target maturity level for a pro cuelist.
- **MSC** (MIDI Show Control): GO/STOP/RESUME + universal cue number —
  the inter-console lingua franca. A stage manager expects to be
  able to send `GO 47` to STAGESPACE from their console.
- **MTC/LTC**: timecode as the show's backbone — our
  trajectories could be timecode-indexed (cue "at TC 01:23:45:12").
- **PosiStageNet** already covered — the open stage-position protocol
  supported by TiMax, L-ISA, MA, disguise.
- **QLab**: the theatre standard — spatial cues built in since QLab 5,
  ADM-OSC out. The reference UX model (a cue = a visual object,
  everything is draggable, everything is automatable).

**Consequence**: the STAGESPACE cuelist must speak the show's
language — **MSC IN (GO/STOP by cue #)** and **MTC** are the two
highest immediate-ROI integrations, before any sophistication.

### 4.2 Broadcast — the user's terrain, invisible to research

The academic corpus ignores broadcast — but that's where part of
the dewiweb ecosystem lives:

- **Sofie** (NRK, open source): TV automation — rundown → state-based
  device control, video/audio/graphics playout, MOS protocol, plugins.
  The "one rundown drives N heterogeneous devices" model = ours.
- **MOS Protocol** (2.8.5): newsroom ↔ devices, the ancestor of
  broadcast show control.
- **Ember+** (Lawo): hierarchical parameter tree, subscriptions,
  matrices — the "structured OSC" of broadcast audio. The user's
  emberplus_rust/MCxOSC work already makes it a bridge to OSC.
- **NMOS** (AMWA IS-04/05/07/08/09): discovery + connection + events +
  mapping of IP devices — the broadcast equivalent of OSCQuery+patching.
- **Ravenna/AES67, ST 2110**: transport + PTP (IEEE 1588) — the common
  clock the OSC world doesn't natively have.

**Insight**: nobody yet links broadcast automation (rundown,
MOS, Ember+) to spatial motion generation. A STAGESPACE
"device-compatible" (Ember+ tree or OSC + MOS) could be driven
directly by a Sofie rundown — a real niche for immersive
AV/broadcast installations.

### 4.3 Ableton Link — solved musical sync

Link (open source, C++) synchronizes **tempo, beat, phase, start/stop**
between LAN applications — peer-to-peer sessions, anyone
changes tempo, everyone follows, free join/leave. Multicast UDP
20808. Not a shared timeline: each app keeps its timeline, Link
maintains the **temporal relation** (clock abstraction ↔ beat mapping).

**For STAGESPACE**: it's the right answer to the "show's global
BPM" — the `BPM` node should be able to read the Link session
(`ableton-link` crate or bridge) rather than only audio analysis.
Rhythmic engines (pendulum, wave, orbit sync) then become musically
locked to the whole set — including Strudel/Live running alongside.

### 4.4 Spatial live coding — the trajectory as pattern

- **TidalCycles / Strudel**: `orbit` (independent stereo channels) +
  `.pan` + multi-channel orbits — algorithmic patterns are already
  spatializable, but channel-grain, not 3D-object. The algorave
  community wants spatial; it only has pan.
- **FoxDot, Sardine, SuperDirt→SC**: same logic — live coding
  generates discrete control; spatial is underexploited there
  for lack of adapted tools.
- **Consequence**: STAGESPACE receiving OSC from Strudel (pattern →
  graph params) is the missing link — live coders
  would become spatial motion authors without changing tools.
  A "STAGESPACE pattern bridge" (documented OSC namespace) = marketing
  feature toward this very active community.

### 4.5 Machine co-creation — the improvising agents

- **Somax2 / OMax / DYCI2** (IRCAM, ERC REACH, Assayag):
  multi-listening agents improvising with musicians from a learned
  corpus — machine listening + cognitive model + autonomous agents.
  **Circular Auto Spat (CAS, 2025)** adds spatial awareness:
  automatic spatialization of the ambisonic corpus by descriptors —
  proof that co-creative agents **need a motion
  policy** they don't have. That's exactly our missing layer.
- **CataRT** (Schwarz, MuBu): navigation of a grain corpus in a
  **descriptor space** (centroid, MFCC, noisiness) by proximity —
  the cursor's trajectory in timbre space selects the grains.
  → a `DescriptorField` node (trajectory in the analyzed-audio
  descriptor space) is a direct bridge between our engine and
  concatenative synthesis — a novel concept, publishable.
- **Djazz, Somax2 CAS**: spatialization becomes a degree of freedom
  for agents — they produce intention, we produce the
  motion that renders it.

### 4.6 AI/MCP — the TiMax signal

**TiMax MCP** (2025): first spatial renderer to expose a Model
Context Protocol server — an AI assistant can drive the show control.
STAGESPACE's context.md excludes generative AI from V1 (a deliberate
decision), but the **interface** matters: a clean, documented,
discoverable API (OSCQuery or a manifest) is what will make
STAGESPACE drivable by any orchestrator — human, rundown, or agent.

---

## PART V — Synthesis and roadmap

### 5.1 Final positioning

```
STAGESPACE =
  generative diffusion console:
    nodal trajectory engine (graph → f(t)) for live,
    spatial effects orchestrator (zones, kinematics → OSC params),
    motion hub at the center of a control-room cockpit,
    renderer-agnostic.
```

Four value layers:
1. **Motion composition** (graph → f(t) — unique)
2. **Effects orchestration** (zones/kinematics → params — unique)
3. **Live cockpit** (atomic cue, panic, OSC in/out — Acousmonium lineage)
4. **Show/broadcast interop** (MSC/MTC, Ember+/MOS, TUIO, Link — the
   link neither research nor renderers cover)

**What pass 2 changed**: the renderer landscape is more competitive
than expected — FletcherMachine, TiMax panLab, 4DSOUND all have
integrated trajectory engines and interop (ADM-OSC, RTTrPM, PSN) is
already native there. But **all are locked in their hardware/ecosystem**
and none offers nodal composition. Our niche holds: it's the layer
*between* renderers — the more renderers ship closed engines,
the more an open, renderer-agnostic orchestrator gains value.

### 5.2 Research-informed roadmap

**Short term — creative:**
- `VectorField` node + steering (Carpentier/Gerzso)
- `follow` extension: pursue/evade/orbit/arrive
- Kinematic nodes: Velocity/Acceleration→modulation
- Extended channels: spread/distance/gain/presence (ToscA model)
- `PerceptualVelocity` node (°/s around the listener — psychoacoustics)

**Short term — interaction (patcher lessons, §3.11):**
- Autopatch: drop a modifier on an edge → insertion into the chain
- Quick-add: double-click canvas / key → node search → Enter
- Runnable help: right-click node → "Open example" (shapePresets)
- Pin-to-Perform: per-param flag → curated Perform surface (GOP/Present)
- Edge color-code by port type (trajectory/duration/spline)
- Animated edges when the active move's graph produces (plugdata
  connection activity)

**Medium term — effects and interop:**
- `Zone` node (control-side SFFX)
- `Proximity` node (relational)
- SMS mode on orbits + rate limiting
- libmapper-style generic OSC IN mapping (composable expressions)
- **MSC IN (GO/STOP by cue #) + MTC** — the stage manager's language
- OSCQuery renderer params auto-discovery
- RTTrPM/PosiStageNet → `follow` on real actors
- TUIO/reacTIVision IN → fiducials as tracked sources
- SpaceMouse support (reuse `spacemouse-osc`)
- OSC timetags / Ableton Link for multi-app sync
- `Room` node → active acoustics scenarios per cue (Constellation/VIVACE)

**Long term — ecosystem:**
- VST3 plugin or embedding API (ToscA/Wwise model)
- Community store .ssx/.hfg (deken → patch store: signing before
  distribution — §3.11)
- Abstractions: save-selection → parameterizable palette item (§3.11)
- WebSocket/REST → TouchDesigner; Strudel/live-coding bridge
- `VirtualMic` node (ViMiC paradigm — composing the listening point)
- `DescriptorField` node (trajectory in descriptor space —
  CataRT bridge, publishable concept)
- Ember+/MOS device mode → driven by broadcast rundown (Sofie)
- sACN-type merge priorities (priority source takes over)
- Device feedback (mi.mu LED/motor, motorized faders) — bidirectional
- JIM/NIME publication: "node-graph compiled spatial trajectories" or
  "zone-based spatial effects orchestration"

### 5.3 Anti-roadmap

- No audio renderer · No clip matrix · No post-prod timeline ·
  No native MIDI · No proprietary tracking hardware ·
  No internal generative AI (V1) — but a discoverable API to be
  driven by one

### 5.4 Final verdict

Research confirms three things:

1. **The architecture is validated**: the f(t)-compiled graph has
   predecessors (Lithe, ambicontrol, animation_nodes) but no equivalent
   product. Schacher's hierarchical+emergent composition formally
   describes what the graph already does.
2. **The niche is real and triple**: nodal trajectories + effects
   orchestration + live cockpit. Each domain has separate occupants;
   nobody is at all three at once.
3. **Psychoacoustics must guide design**: MAMA, the 0-50 Hz bound,
   onset-displacement — measured bounds that must become
   params (PerceptualVelocity, SMS range, onset compensation).

The vulnerability remains industrial: renderers already integrate their
own trajectory engines (FletcherMachine, TiMax, L-ISA FX, Holophonix
Motion Engine). The defense stands on three points: (1) none is
renderer-agnostic — that's structural (conflict of interest); (2) none
offers nodal composition or geometry-based effects orchestration; (3)
nobody links show control (MSC/MTC), broadcast (Ember+/MOS) and the
gestural (SpaceMouse, TUIO, mi.mu) to spatial motion — that's the
dewiweb cockpit.

Signal to watch: **TiMax MCP** (AI assistant in a spatial renderer)
shows that the "drivable orchestrator" layer is becoming a stake — our
discoverable API (OSCQuery/manifest) is the defensive investment.

---

## Bibliography and key links

### Trajectories and engines
- IanniX: iannix.org, hal-03354322
- Carpentier & Gerzso: hal-03111478, hal-03127947
- Cadambi, Lithe: mat.ucsb.edu/Masters/Akshay_Cadambi_Masters_Thesis.pdf
- Schacher, "Gesture Control of Sounds in 3D Space", NIME 2007:
  jasch.ch/pub/NIME07_Gesture_Jasch.pdf
- Schacher & Kocher, ICST Ambisonics Tools, ICMC 2006:
  jasch.ch/pub/ICMC06_Ambisonics_Tools.pdf
- ToscA: JIM 2015 (jim.afim-asso.org/jim2015), ICMC 2015,
  forum.ircam.fr (ToscA + OSCAR)
- Trajectory Score Library: github.com/nadirB/Trajectory_Score_Library
- ViMiC: JAES 2005, CMJ 32(3) 2008, JIMS 5(2) 2011, github Nilson/ViMiC-and-friends
- Spatbox: doi.org/10.5281/zenodo.6573505
- SES: mat.ucsb.edu/Masters/McGee_MS_Thesis_Final.pdf
- Sound Trajectory: hal-04950064, hal-04950075
- Grapes 3D: grapes-3d.com
- SpatGRIS: github GRIS-UdeM, ICMC 2018
- ossia score: ossia.io
- ADM-OSC: immersive-audio-live.github.io/ADM-OSC
- Egregore: chdh.net/egregore_source
- ImmLib: github.com/miguel-negrao/ImmLib, zenodo.850696
- abclib: github.com/alainbonardi/abclib, hal-04367491
- Wwise 3D Position Automation: audiokinetic.com docs
- Acousmonium/diffusion: Wikipedia, electrodoc.musiques-recherches.be,
  Tutschku (tutschku.com), Stansbie (ontology), Landy zenodo.18898493,
  "fractured acousmatic" (academia.edu)
- ESPRO: ircam.fr/espace-de-projection, bruit.fr/revues/78_12900.PDF
- Jot & Warusfel, Le Spatialisateur: architexte.ircam.fr/textes/Jot95b

### Spatial effects
- Chowning, JAES 19(1) 1971
- Zotter & Frank, Ambisonics Springer ch.5
- Cadambi, SMS ICMC 2015
- McCormack, COMPASS DAFx 2021
- Sluicer NIME 2024, FOAFX github risdsound, Beamix zenodo.14338798
- IEM suite: plugins.iem.at
- SPARTA/COMPASS: leomccormack.github.io/sparta-site
- Dodge, eContact 10.3
- Lengelé, Live 4 Life, Organised Sound/ICMC
- Spatial grains: ro.uow.edu.au/creartspapers/35
- Faust granulator: hal-04849708
- CAVIAR: doi.org/10.61782/fa.2025.0145
- Auxtrument: doi.org/10.1109/qomex61742.2024.10598285
- Performing Performance Spaces: nime2026_36.pdf
- UCSB XR thesis: escholarship.org/uc/item/8gn375px

### Movement psychoacoustics
- Perrott & Musicant, MAMA, JASA 62(6) 1977: doi.org/10.1121/1.381675
- Perrott & Tucker, JASA 1988: doi.org/10.1121/1.395908
- MAMA horizontal: doi.org/10.1121/1.402443
- Carlile, "Perception of Auditory Motion": PMC4871213
- CNMAT OSC best practices: opensoundcontrol.stanford.edu

### Timing/reliability
- Simple Sync OSC: cnmat.berkeley.edu (2015)
- Freed timetags: opensoundcontrol.stanford.edu/files/freed-timetags.pdf
- OSC timestamps: cnmat.berkeley.edu (2008)

### Real-time patchers
- Pure Data: puredata.info — Puckette, CMJ 21(3) 1997 + ICMC 1996
- plugdata: plugdata.org — github.com/plugdata-team/plugdata (JUCE, AGPL)
- deken: github.com/pure-data/deken (externals package manager)
- Heavy/hvcc: github.com/Wasted-Audio/hvcc (patch → C++/VST/OWL/WASM)
- ELSE: github.com/porres/pd-else — Cyclone: Max port for Pd
- Max/MSP (pattr, presentation mode, poly~): cycling74.com
- TouchDesigner: derivative.ca — vvvv: vvvv.org

### HCI
- libmapper: idmil.org/project/libmapper, github libmapper
- Making Mappings (T-Stick): doi.org/10.82308/48538
- MapLooper: idmil.org/project/maplooper (NIME 2021)
- Marshall et al., ICMC 2006 (GDIF)
- xrOSC: nime2024_31.pdf — AudioMiXR: doi.org/10.1145/3749478
- ARMixer: doi.org/10.1145/3476124.3488632
- Invoke: doi.org/10.1145/3616195.3616211
- Beyond Faders: arxiv 2602.23090
- Gelineck & Serafin: vbn.aau.dk (AM'15)
- 6DOFpanner: github.com/diegoquirozphd
- spAAce: zenodo.851222
- Gesture Atmos: nime2025_88.pdf — Metabow: nime2025_62
- Design Patterns Spatial Instruments: zenodo.13904804
- reacTable: mtg.upf.edu
- Chataigne: benjamin.kuperberg.fr/chataigne
- Space Controller: soundparticles.com — MPE: roli.com
- PosiStageNet: posistage.net — BlackTrax: cast-soft.com

### Pro renderers (pass 2)
- TiMax: timaxspatial.com (SoundHub, panLab, TrackerD4, TimeLine, MCP)
- FletcherMachine: adamson-fletcher-machine.com (V2.x)
- Yamaha AFC Image/Enhance: usa.yamaha.com/proaudio/afc
- 4DSOUND: 4dsound.net + CUMINCAD 2016 paper
- Meyer Spacemap Go / Constellation (NADIA): meyersound.com
- VIVACE: mbbm-aso.com — CARMEN: CSTB (pub.dega-akustik.de)
- Klang:technologies: klang.com

### Panning / rendering
- VBAP: Pulkki, JAES 45(6) 1997 — MDAP, AllRAP (Neukom/Schacher 2008)
- DBAP: Lossius/Baltazar/DeLaHogue, ICMC 2009 (jamoma.org)
- SPAT panning algos: doc.flux.audio/Spatialisation_Technology
- Volumetric panning: embody.co

### Show control / broadcast / sync
- Art-Net 4 / sACN E1.31 / GrandMA: help.malighting.com
- MSC (MIDI Show Control), MTC, PosiStageNet
- Sofie: github.com/Sofie-Automation — MOS 2.8.5
- Ember+: github.com/Lawo/ember-plus — NMOS: AMWA IS-04/05
- Ableton Link: ableton.github.io/link

### Live coding / co-creation / ML mapping
- Strudel: strudel.cc — TidalCycles: tidalcycles.org
- Somax2: github.com/DYCI2/Somax2 — CAS: zenodo.15840075
- CataRT/MuBu: ircam-ismm.github.io/max-msp
- Wekinator: wekinator.org (Fiebrink, NIME 2009)
- mi.mu Glover: mimugloves.com — MPE: roli.com
- TUIO/reacTIVision: tuio.org
- Ultraleap mid-air haptics: docs.ultraleap.com
- Radio Baton: Mathews, CMJ 15(4) 1991 — ccrma.stanford.edu/radiobaton
- Sound Particles plugins: soundparticles.com (Energy/Brightness/Beat
  Panner, Doppler, Air, Space Controller, inDelay)
- E4L Envelop for Live: github.com/EnvelopSound

### dewiweb corpus (GitHub)
spacemouse-osc, chataigne_spatiale, Holophonix-chataigne-module,
holophonix-animator, holophonix_blender_addon, trajectoires-modern,
MCxOSCnext, emberplus_rust, open-stage-control, companion-module-*,
aes67_visualizer, audio-accessibility-system, XCTL_
