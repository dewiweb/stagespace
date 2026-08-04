#!/usr/bin/env bash
# HOLOFLOW — démarrage complet
# Lance le bridge OSC + le frontend Vite en parallèle

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  HOLOFLOW                               │"
echo "│  Starting OSC Bridge + Frontend         │"
echo "└─────────────────────────────────────────┘"
echo ""

# Variables d'environnement configurables
export OSC_HOST="${OSC_HOST:-127.0.0.1}"
export OSC_PORT="${OSC_PORT:-9000}"
export OSC_IN_PORT="${OSC_IN_PORT:-9001}"
export WS_PORT="${WS_PORT:-8765}"

echo "  OSC OUT  →  ${OSC_HOST}:${OSC_PORT}"
echo "  OSC IN   ←  UDP :${OSC_IN_PORT}"
echo "  WebSocket   ws://localhost:${WS_PORT}"
echo "  Frontend    http://localhost:3000"
echo ""

# Start OSC bridge
(cd "$ROOT/osc-bridge" && node --loader ts-node/esm index.ts) &
BRIDGE_PID=$!

# Start frontend dev server
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

# Trap Ctrl+C → kill both
trap "echo ''; echo 'Stopping...'; kill $BRIDGE_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

wait
