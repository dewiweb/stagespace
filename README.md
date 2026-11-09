# STAGESPACE — Spatial Trajectory Engine

Moteur de trajectoires spatiales temps réel **renderer-agnostic** : un graphe de
nœuds compilé en fonctions continues `f(t)` orchestre le mouvement **et** les
effets spatiaux (gain, spread, zones, modulations cinématiques) de sources audio
contrôlées en OSC — Holophonix, SPAT Revolution, IEM, ADM-OSC ou tout récepteur
OSC générique.
**100% Rust + Tauri + React.** Performance temps réel, 60 FPS.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Node Editor  (React Flow)              │
│  Objects → Motion Node → Duration → Output     │
│  + Global graph tab (post-merge FX chain)      │
└───────────────────┬──────────────────────────────┘
                    │ Tauri IPC
          ┌─────────▼──────────┐
          │   Graph Compiler   │   ← Rust: nœuds → fonction composite
          └────┬──────────┬────┘
               │          │
    ┌──────────▼───┐  ┌───▼──────────┐
    │ Math Engine  │  │Physics Engine│
    │ circular     │  │ bouncing     │
    │ lissajous    │  │ swarm (boids)│
    │ spiral       │  │ spring       │
    │ perlin_noise │  │ follow       │ ← pursue/evade/orbit/arrive
    │ pendulum     │  │ avoidance    │
    │ formation    │  │ vectorfield  │ ← champs procéduraux + drawn
    │ converge     │  └─────────────┘
    │ figure8      │
    │ linear       │  Splines : DrawSpline / EvaluateSpline /
    │ oscillation  │             TrimSpline / OffsetSpline
    │ BPM          │  ← Audio IN (cpal + FFT natifs)
    │ AudioAmp     │  ← Audio IN
    │ TimeFalloff  │  ← Falloffs
    │ PointDist    │  ← Falloffs
    └──────────────┘
                    │
         ┌──────────▼──────────┐
         │  MergeRuntime 60 FPS │   ← workers parallèles → merge → OSC
         │  Post-process graph  │   ← Scale/Rotate/Shift/Zone/Velocity…
         │  OSC Out (rosc)      │   → 6 profils (Holophonix, IEM, IRCAM,
         │                      │      ADM, Generic XYZ/AED) + canaux
         │                      │      étendus (gain, spread, distance…)
         │  3D Preview          │   ← Three.js temps réel (+ viz zones)
         └─────────────────────┘
```

---

## Moteurs disponibles

### Math Engine
| Moteur | Description |
|--------|-------------|
| `circular` | Orbite circulaire uniforme |
| `spiral` | Hélicoïde montante/descendante |
| `lissajous` | Courbes de Lissajous 3D |
| `figure8` | Lemniscate de Bernoulli |
| `linear` | Pan linéaire A→B |
| `oscillation` | Oscillation sinusoïdale |
| `perlin_noise` | Mouvement organique |
| `formation` | Formation géométrique |
| `converge` | Convergence/divergence |
| `pendulum` | Simulation pendule |

### Physics Engine
| Moteur | Description |
|--------|-------------|
| `bouncing` | Rebonds dans conteneur |
| `avoidance` | Répulsion mutuelle |
| `spring` | Attraction vers cible |
| `follow` | File indienne — modes `pursue`/`evade`/`orbit`/`arrive` |
| `swarm` | Essaim de Boids |
| `vectorfield` | Advection par champ de vitesses (vortex/sink/flow/noise/**drawn**) |

### Splines & trajectoires dessinées
| Node | Description |
|------|-------------|
| `DrawSpline` | Dessin libre → spline |
| `EvaluateSpline` | Échantillonnage d'une spline |
| `TrimSpline` / `OffsetSpline` | Édition de spline |

### Modificateurs & post-process (graph global)
| Node | Description |
|------|-------------|
| `Scale` / `Rotate` / `Offset` | Transformations spatiales |
| `RadiusScale` / `HeightOffset` / `PerTrackDepth` | Macros spatiales |
| `Barycenter` / `ManualPosition` | Origin / override manuel |
| `AudioFalloff` | Modulation audio des params |
| `Zone` | Région d'espace → canaux spatiaux (sphere/box, falloff) |
| `Velocity` | Modulation cinématique (speed/accel/jerk/**angvel**) → canaux |
| `MoveRef` / `Merge` | Référence de sub-graph / merge strategies |

### Audio Sources
| Moteur | Description |
|--------|-------------|
| `BPM` | Synchronisation sur BPM audio |
| `AudioAmplitude` | Modulation par amplitude audio |

### Falloffs
| Moteur | Description |
|--------|-------------|
| `TimeFalloff` | Influence temporelle avec easing |
| `PointDistanceFalloff` | Influence spatiale par distance |

---

## Installation

```bash
# Rust engines
cd rust-engines
cargo build --release

# Frontend deps (required — beforeBuildCommand builds the frontend)
cd ../tauri-app/frontend
npm install

# Tauri app (Tauri CLI)
cd ..
npm install
```

---

## Démarrage

```bash
cd tauri-app
npm run tauri dev     # ou : npx tauri dev
```

L'application s'ouvre dans une fenêtre native.

### CLI (workflow testing sans UI)

```bash
cd tauri-app/src-tauri
cargo build --bin stagespace-cli
./target/debug/stagespace-cli "templates"
./target/debug/stagespace-cli "activate-move circle --tracks 1-5; sample --move circle-1 --obj 0; stop-all"
bash tests/e2e_cli_test.sh    # suite E2E complète
```

---

## Fonctionnalités

- **Node Editor** : éditeur de graphe React Flow avec nœuds custom éditables,
  deux onglets (sub-graph par move + **global graph** post-merge)
- **Compilation** : validation et compilation en fonctions composites
- **Playback** : lecture temps réel à 60 FPS, workers parallèles + MergeRuntime
- **Merge strategies** : override / crossfade / blend / priority
- **3D Preview** : visualisation Three.js connectée au runtime, **visualisation
  3D des zones** d'effets
- **Spatial channels** : gain, spread, distance, presence, yaw, aperture, lfe
  par objet et par profil OSC
- **Kinematic modulations** : speed/accel/jerk/**angvel** (vitesse angulaire
  autour d'un listener paramétrable) → canaux spatiaux
- **Zones** : sphere/box + falloff smoothstep → pilotent les canaux des objets
  présents ; déclarables en FX panel ou en node `Zone` du graph global
- **OSC IN mappings** : n'importe quelle adresse OSC → macro / canal / position
  (wildcards, transforms scale/offset/clamp/smooth, anti-loop)
- **Audio IN** : capture microphone native (cpal) avec BPM et amplitude
- **Cue System** : snapshots complets (graphes, moves actifs, effets runtime)
  avec rappel atomique
- **Save/Load** : persistance localStorage des graphes

---

## Profils OSC

| Profil | Adresse position | Args |
|--------|------------------|------|
| **Holophonix** | `/track/{id}/xyz` | x, y, z (message unique) |
| **IEM MultiEncoder** | `/MultiEncoder/{id}/aed` | azimuth°, elevation°, distance (message unique) |
| **IRCAM Spat** | `/source/{id}/xyz` | x, y, z (message unique) |
| **ADM-OSC** | `/adm/source/{id}/aed` | azimuth°, elevation°, distance |
| **Generic Cartesian** | `/object/{id}/xyz` | x, y, z (message unique) |
| **Generic Polar** | `/object/{id}` | azimuth°, elevation°, distance |

Canaux étendus (gain, spread, distance, presence, yaw, aperture, lfe) envoyés
en messages séparés selon la matrice de capacités du profil
(ex. IRCAM `/source/{id}/spread`, Holophonix `/track/{id}/gain`).

---

## Stack technique

- **Shell** : Tauri (Rust)
- **UI** : React 18 + TypeScript
- **Node editor** : React Flow
- **3D Preview** : Three.js
- **State** : Zustand
- **Styles** : TailwindCSS
- **OSC** : `rosc` (Rust)
- **Audio IN** : `cpal` + `realfft` (capture + FFT natives, Rust)
- **Moteurs** : Rust pur (performance temps réel)

---

## Documentation

- [AGENTS.md](AGENTS.md) — conventions, commandes de build, CI
- [docs/user-manual.md](docs/user-manual.md) — manuel opérateur (vues, OSC show-control, OSC-IN + learn, sécurité live, dépannage)
- [docs/console-integration.md](docs/console-integration.md) — piloter STAGESPACE depuis une console/QLab/Companion
- [docs/use-cases.md](docs/use-cases.md) — cas d'usage terrain et limites ouvertes
- [MANUAL_TESTING.md](MANUAL_TESTING.md) - Checklist de tests manuels
- [LOGGING.md](rust-engines/LOGGING.md) - Guide du système de logging
- [ERROR_HANDLING.md](rust-engines/ERROR_HANDLING.md) - Guide de la gestion d'erreurs
- [CONFIG.md](rust-engines/CONFIG.md) - Guide de la configuration
- [TESTING.md](rust-engines/TESTING.md) - Guide des tests
- [BENCHMARKS.md](rust-engines/BENCHMARKS.md) - Guide des benchmarks
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guide pour contribuer
- [ROADMAP_GRAPH_GLOBAL.md](docs/ROADMAP_GRAPH_GLOBAL.md) - Roadmap de l'architecture graphe global
- [ARCHITECTURE_FUTURE.md](docs/ARCHITECTURE_FUTURE.md) - Document de design (partiellement implémenté)

## Tests

```bash
cd rust-engines
cargo test --lib
```

519 tests passent côté moteurs (suites complètes : voir le tableau "Test
Counts" dans [AGENTS.md](AGENTS.md)).

---

## License

MIT
