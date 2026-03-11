#!/bin/bash

echo "🎵 OSCAI POC - Quick Start"
echo "=========================="
echo ""

check_ollama() {
    if ! command -v ollama &> /dev/null; then
        echo "❌ Ollama not found!"
        echo "Install with: curl -fsSL https://ollama.com/install.sh | sh"
        exit 1
    fi
    echo "✅ Ollama installed"
}

check_model() {
    if ! ollama list | grep -q "qwen2.5-coder:7b"; then
        echo "⚠️  Model qwen2.5-coder:7b not found"
        echo "Pulling model (this may take a few minutes)..."
        ollama pull qwen2.5-coder:7b
    fi
    echo "✅ Model ready"
}

install_deps() {
    if [ ! -d "venv" ]; then
        echo "Creating virtual environment..."
        python3 -m venv venv
    fi
    
    source venv/bin/activate
    
    echo "Installing Python dependencies..."
    pip install -q -r requirements.txt
    
    echo "✅ Dependencies installed"
}

show_menu() {
    echo ""
    echo "Select an option:"
    echo "1) Quick test (3 prompts)"
    echo "2) Full test suite (20 prompts)"
    echo "3) Benchmark performance"
    echo "4) Open visualizer"
    echo "5) Compare models"
    echo "6) Exit"
    echo ""
    read -p "Choice [1-6]: " choice
    
    case $choice in
        1)
            echo ""
            echo "Running quick test..."
            python3 backend/llm_engine.py
            ;;
        2)
            echo ""
            echo "Running full test suite..."
            python3 tests/test_prompts.py
            ;;
        3)
            echo ""
            echo "Running benchmark..."
            python3 tests/benchmark.py
            ;;
        4)
            echo ""
            echo "Opening visualizer at http://localhost:8000/visualization/visualizer.html"
            python3 -m http.server 8000
            ;;
        5)
            echo ""
            read -p "Enter models to compare (space-separated, e.g., 'qwen2.5-coder:7b deepseek-r1:7b'): " models
            python3 tests/benchmark.py --compare $models
            ;;
        6)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid choice"
            show_menu
            ;;
    esac
}

check_ollama
check_model
install_deps

while true; do
    show_menu
    echo ""
    read -p "Press Enter to continue..."
done
