# OSCAI — Spatial Audio Trajectory Generator

Générateur de trajectoires audio spatiales 3D via un système de nœuds graphiques,
un moteur mathématique (Lissajous, Perlin, spirales…) et un moteur physique (swarm, rebonds, ressorts…).
**Aucune dépendance LLM.** Génération instantanée, 100% déterministe.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Node Editor  (React Flow)              │
│  Objects → Motion Node → Duration → Generate     │
└───────────────────┬──────────────────────────────┘
                    │ POST /api/compile-graph
          ┌─────────▼──────────┐
          │   Graph Compiler   │   ← extrait params, identifie moteur
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
    └──────────────┘
                    │
         ┌──────────▼──────────┐
         │  Trajectory frames  │   frames[obj][frame][x,y,z]
         │  3D Visualizer      │
         │  OSC Output         │   → IEM / Holophonix / IRCAM Spat
         └─────────────────────┘
```

---

## Moteurs disponibles

### Math Engine (< 2ms)
| Moteur | Description |
|--------|-------------|
| `circular` | Orbite circulaire uniforme |
| `spiral` | Hélicoïde montante/descendante |
| `lissajous` | Courbes de Lissajous 3D |
| `figure8` | Lemniscate de Bernoulli |
| `linear` | Pan linéaire A→B, option ping-pong |
| `oscillation` | Oscillation sinusoïdale avec amortissement |
| `perlin_noise` | Mouvement organique (superposition harmonique) |
| `formation` | Formation géométrique (cercle, grille, sphère) |
| `converge` | Convergence/divergence avec easing |
| `pendulum` | Simulation pendule (intégration RK4) |

### Physics Engine (< 150ms)
| Moteur | Description |
|--------|-------------|
| `bouncing` | Rebonds dans sphère/boîte/cylindre |
| `avoidance` | Répulsion mutuelle entre objets |
| `spring` | Attraction vers cible (masse-ressort) |
| `follow` | File indienne avec délai configurable |
| `swarm` | Essaim de Boids (cohésion, séparation, alignement) |

---

## Installation

```bash
# Backend
pip install -r requirements.txt

# Frontend
cd frontend && npm install
```

## Démarrage

```bash
# Backend API (port 8080)
cd backend && uvicorn api:app --port 8080 --reload

# Frontend (port 3000)
cd frontend && npm run dev
```

## API Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/` | Status + liste des moteurs |
| `GET` | `/api/engines` | Moteurs + paramètres détaillés |
| `POST` | `/api/compile-graph` | Compiler un graph de nœuds |
| `POST` | `/api/generate-direct` | Génération directe par nom de moteur |
| `GET` | `/api/trajectories` | Historique de session |
| `WS` | `/ws/compile` | Compilation en temps réel |

## Exemple API

```bash
# Génération directe — swarm 12 objets, 10s
curl -X POST "http://localhost:8080/api/generate-direct?engine=swarm&n_objects=12&duration=10"

# Compilation d'un graph
curl -X POST http://localhost:8080/api/compile-graph \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      {"id":"a","type":"objects",  "data":{"count":8}},
      {"id":"b","type":"lissajous","data":{"freqX":3,"freqY":2}},
      {"id":"c","type":"duration", "data":{"seconds":12}}
    ],
    "edges": [
      {"source":"a","target":"b"},
      {"source":"b","target":"c"}
    ]
  }'
```

## Stack technique

- **Backend** : Python 3.12, FastAPI, NumPy (pas d'Ollama)
- **Frontend** : React 18, TypeScript, React Flow, Three.js, TailwindCSS
- **OSC** : IEM MultiEncoder, Holophonix, IRCAM Spat, Generic
