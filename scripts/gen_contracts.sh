#!/usr/bin/env bash
# Régénère les contrats TypeScript ↔ Rust (ts-rs) dans
# tauri-app/frontend/src/types/generated/.
#
# ts-rs émet les fichiers via des tests `export_bindings_*` — les lancer dans
# les deux crates avec TS_RS_EXPORT_DIR pointant vers le même dossier garantit
# des imports relatifs `./X` corrects (même pour les types cross-crate comme
# StoreCueRequest → MacroSnapshot).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export TS_RS_EXPORT_DIR="$ROOT/tauri-app/frontend/src/types/generated"
mkdir -p "$TS_RS_EXPORT_DIR"

(cd "$ROOT/rust-engines" && cargo test --lib export)
(cd "$ROOT/tauri-app/src-tauri" && cargo test --lib export)

echo "Contracts regenerated in tauri-app/frontend/src/types/generated/"
