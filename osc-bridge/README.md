# HOLOFLOW OSC Bridge

Pont bidirectionnel WebSocket ↔ UDP pour connecter le frontend HOLOFLOW aux cibles OSC (Holophonix, SPAT Revolution, IEM MultiEncoder, etc.).

## Architecture

```
frontend (browser)  ──WebSocket──  osc-bridge (Node.js)  ──UDP──  Holophonix / SPAT / IEM
                                          ↑
                                    écoute UDP IN
                                    → WS → OscRouter
```

## Démarrage

```bash
# Depuis la racine du projet
./start.sh

# Ou séparément
cd osc-bridge && npm start       # bridge seul
cd frontend && npm run dev       # frontend seul
```

## Variables d'environnement

| Variable      | Défaut        | Description                        |
|---------------|---------------|------------------------------------|
| `OSC_HOST`    | `127.0.0.1`   | IP de la cible OSC                 |
| `OSC_PORT`    | `9000`        | Port UDP de sortie (OSC OUT)       |
| `OSC_IN_PORT` | `9001`        | Port UDP d'entrée (OSC IN)         |
| `WS_PORT`     | `8765`        | Port WebSocket du bridge           |

```bash
OSC_HOST=192.168.1.50 OSC_PORT=4003 ./start.sh
```

## Protocole WebSocket (JSON)

### Frontend → Bridge

```json
{ "type": "osc-out", "address": "/track/1/xyz", "args": [0.5, 0.0, 1.0] }
{ "type": "config",  "oscHost": "192.168.1.50", "oscPort": 4003, "oscInPort": 4004 }
{ "type": "ping" }
```

### Bridge → Frontend

```json
{ "type": "osc-in",  "address": "/track/1/xyz", "args": [0.3, 0.1, 0.0] }
{ "type": "status",  "connected": true, "oscHost": "127.0.0.1", "oscPort": 9000, "oscInPort": 9001 }
{ "type": "pong" }
{ "type": "error",   "message": "..." }
```

## Reconfiguration à chaud

La cible OSC peut être changée en temps réel depuis l'UI — le frontend envoie un message `config` au bridge sans redémarrage.
