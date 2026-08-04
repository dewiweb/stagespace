# STAGESPACE — Spatial Trajectory Engine

Moteur de trajectoires spatiales temps réel piloté par un graphe de nœuds,
compilé en fonctions continues `f(t)` pour un contrôle OSC multi-profil.
**100% Rust + Tauri + React.** Performance temps réel, 60 FPS.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Node Editor  (React Flow)              │
│  Objects → Motion Node → Duration → Output     │
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
    │ perlin_noise │  │ follow       │
    │ pendulum     │  │ avoidance    │
    │ formation    │  └─────────────┘
    │ converge     │
    │ figure8      │
    │ linear       │
    │ oscillation  │
    │ BPM          │  ← Audio IN
    │ AudioAmp     │  ← Audio IN
    │ TimeFalloff  │  ← Falloffs
    │ PointDist    │  ← Falloffs
    └──────────────┘
                    │
         ┌──────────▼──────────┐
         │  Runtime 60 FPS    │   ← f(t) appelé à chaque tick
         │  OSC Out (rosc)     │   → 6 profils (Holophonix, IEM, IRCAM, ADM, Generic)
         │  3D Preview        │   ← Three.js temps réel
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
| `follow` | File indienne |
| `swarm` | Essaim de Boids |

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

# Tauri app
cd tauri-app
npm install
npm run tauri dev
```

---

## Démarrage

```bash
cd tauri-app
npm run tauri dev
```

L'application s'ouvre dans une fenêtre native.

---

## Fonctionnalités

- **Node Editor** : éditeur de graphe React Flow avec nœuds custom éditables
- **Compilation** : validation et compilation en fonctions composites
- **Playback** : lecture temps réel à 60 FPS avec OSC out
- **3D Preview** : visualisation Three.js connectée au runtime
- **Audio IN** : capture microphone avec BPM et amplitude
- **Cue System** : snapshots de graphes avec rappel
- **OSC IN** : mapping configurable pour contrôles externes
- **Save/Load** : persistance localStorage des graphes

---

## Profils OSC

- **Holophonix** : `/holophonix/track/{id}/xyz`
- **IEM MultiEncoder** : `/iem/azimuth/{id}`, `/iem/elevation/{id}`, `/iem/distance/{id}`
- **IRCAM Spat** : `/spat/source/{id}/xyz`
- **ADM-OSC** : `/adm/source/{id}/aed`
- **Generic Cartesian** : `/xyz/{id}/x`, `/xyz/{id}/y`, `/xyz/{id}/z`
- **Generic Polar** : `/polar/{id}/azimuth`, `/polar/{id}/elevation`, `/polar/{id}/distance`

---

## Stack technique

- **Shell** : Tauri (Rust)
- **UI** : React 18 + TypeScript
- **Node editor** : React Flow
- **3D Preview** : Three.js
- **State** : Zustand
- **Styles** : TailwindCSS
- **OSC** : `rosc` (Rust)
- **Audio IN** : Web Audio API (via Tauri IPC)
- **Moteurs** : Rust pur (performance temps réel)

---

## Documentation

- [LOGGING.md](rust-engines/LOGGING.md) - Guide du système de logging
- [ERROR_HANDLING.md](rust-engines/ERROR_HANDLING.md) - Guide de la gestion d'erreurs
- [CONFIG.md](rust-engines/CONFIG.md) - Guide de la configuration
- [TESTING.md](rust-engines/TESTING.md) - Guide des tests
- [BENCHMARKS.md](rust-engines/BENCHMARKS.md) - Guide des benchmarks
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guide pour contribuer

## Tests

```bash
cd rust-engines
cargo test --lib
```

99 tests passent.

---

## License

MIT
