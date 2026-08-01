#!/bin/bash
# Démarrage du backend HOLOFLOW

cd "$(dirname "$0")"

echo "Démarrage du backend Python..."
/home/dewi/Github/oscai/venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8080 --reload