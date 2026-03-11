#!/bin/bash

echo "🎵 OSCAI API - Starting Backend"
echo "================================"
echo ""

export OLLAMA_MODELS=/home/dewi/newhome/ollama_models

if ! pgrep -x "ollama" > /dev/null; then
    echo "Starting Ollama server..."
    OLLAMA_MODELS=/home/dewi/newhome/ollama_models ollama serve &
    sleep 3
    echo "✅ Ollama started"
else
    echo "✅ Ollama already running"
fi

echo ""
echo "Starting FastAPI server on http://localhost:8080"
echo "API docs: http://localhost:8080/docs"
echo ""

cd "$(dirname "$0")"
source venv/bin/activate
cd backend
OLLAMA_MODELS=/home/dewi/newhome/ollama_models uvicorn api:app --host 0.0.0.0 --port 8080 --reload
