#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# STAGESPACE CLI — Tests E2E du workflow métier
# ═══════════════════════════════════════════════════════════════
#
# Ces tests valident le workflow réel d'un ingénieur son :
# 1. Importer un projet .hol
# 2. Lister les tracks
# 3. Créer un move (circle) sur des tracks
# 4. Sampler la trajectoire → vérifier les positions
# 5. Modifier les macros (scale) → vérifier que les positions changent
# 6. Créer un deuxième move en parallèle (spiral)
# 7. Changer la merge strategy
# 8. Modifier le speed d'un move
# 9. Stopper tout
#
# Usage : bash tests/e2e_cli_test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$SRC_TAURI_DIR/target/debug/stagespace-cli"
HOL_FILE="$SCRIPT_DIR/fixtures/test_project.hol"

PASS=0
FAIL=0
PASS_STR="✓ PASS"
FAIL_STR="✗ FAIL"

# ─── Helper : exécute le CLI et capture la sortie ───
run_cli() {
    "$CLI" "$1" 2>&1 || true
}

# ─── Helper : assertion ───
assert_contains() {
    local label="$1"
    local haystack="$2"
    local needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo "  $PASS_STR: $label"
        PASS=$((PASS + 1))
    else
        echo "  $FAIL_STR: $label"
        echo "    Expected: '$needle' in output"
        echo "    Got: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local label="$1"
    local haystack="$2"
    local needle="$3"
    if ! echo "$haystack" | grep -q "$needle"; then
        echo "  $PASS_STR: $label"
        PASS=$((PASS + 1))
    else
        echo "  $FAIL_STR: $label"
        echo "    Expected: '$needle' NOT in output"
        echo "    Got: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

assert_eq() {
    local label="$1"
    local actual="$2"
    local expected="$3"
    if [ "$actual" = "$expected" ]; then
        echo "  $PASS_STR: $label"
        PASS=$((PASS + 1))
    else
        echo "  $FAIL_STR: $label"
        echo "    Expected: '$expected'"
        echo "    Got:      '$actual'"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "STAGESPACE CLI — E2E Workflow Tests"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Build le CLI si nécessaire ───
if [ ! -f "$CLI" ]; then
    echo "Building CLI..."
    (cd "$SRC_TAURI_DIR" && cargo build --bin stagespace-cli 2>&1 | tail -3)
fi

# ═══════════════════════════════════════════════════════════════
# TEST 1 : Import .hol
# ═══════════════════════════════════════════════════════════════
echo "── Test 1: Import .hol ──"
OUT=$(run_cli "import-hol $HOL_FILE")
assert_contains "Import success message" "$OUT" "Imported 8 tracks"
assert_contains "File path in output" "$OUT" "test_project.hol"

# ═══════════════════════════════════════════════════════════════
# TEST 2 : List tracks
# ═══════════════════════════════════════════════════════════════
echo "── Test 2: List tracks ──"
OUT=$(run_cli "import-hol $HOL_FILE; list-tracks")
assert_contains "Track 1 name" "$OUT" "Lead Vocal"
assert_contains "Track 5 name" "$OUT" "Bass"
assert_contains "Track count" "$OUT" "8"

# ═══════════════════════════════════════════════════════════════
# TEST 3 : Activate move (circle)
# ═══════════════════════════════════════════════════════════════
echo "── Test 3: Activate move ──"
OUT=$(run_cli "import-hol $HOL_FILE; activate-move circle --tracks 1-5 --name myCircle")
assert_contains "Activation message" "$OUT" "activated"
assert_contains "Move name" "$OUT" "myCircle"
assert_contains "Track range" "$OUT" "tracks=1-5"
assert_contains "Mode live" "$OUT" "mode=live"

# ═══════════════════════════════════════════════════════════════
# TEST 4 : List moves
# ═══════════════════════════════════════════════════════════════
echo "── Test 4: List moves ──"
OUT=$(run_cli "import-hol $HOL_FILE; activate-move circle --tracks 1-3 --name circleA; list-moves")
assert_contains "Move in list" "$OUT" "circleA"
assert_contains "Track count" "$OUT" "3"

# ═══════════════════════════════════════════════════════════════
# TEST 5 : Sample trajectory — circle should produce circular motion
# ═══════════════════════════════════════════════════════════════
echo "── Test 5: Sample trajectory (circle) ──"
OUT=$(run_cli "activate-move circle --tracks 1-5; sample --move circle-1 --obj 0 --samples 5 --duration 4")
# t=0 should be at (0.5, 0, 0) — circle starts at angle 0
assert_contains "First point x=0.5" "$OUT" "0.000, 0.500000"
# t=2 should be at (-0.5, 0, 0) — half rotation
assert_contains "Half rotation x=-0.5" "$OUT" "2.000, -0.500000"
# Range should be 1.0 (diameter = 2 * radius)
assert_contains "X range = 1.0" "$OUT" "x=\[1.000\]"

# ═══════════════════════════════════════════════════════════════
# TEST 6 : Macros — scale=2.0 should double the radius
# ═══════════════════════════════════════════════════════════════
echo "── Test 6: Macros (scale=2.0) ──"
OUT=$(run_cli "activate-move circle --tracks 1-5; set-macros --scale 2.0; sample --move circle-1 --obj 0 --samples 3 --duration 4")
# With scale=2.0, first point should be at (1.0, 0, 0)
assert_contains "Scaled x=1.0" "$OUT" "0.000, 1.000000"
assert_contains "X range = 2.0" "$OUT" "x=\[2.000\]"

# ═══════════════════════════════════════════════════════════════
# TEST 7 : Two moves in parallel
# ═══════════════════════════════════════════════════════════════
echo "── Test 7: Two moves parallel ──"
OUT=$(run_cli "activate-move circle --tracks 1-3 --name A; activate-move spiral --tracks 4-6 --name B; list-moves")
assert_contains "Move A in list" "$OUT" "A"
assert_contains "Move B in list" "$OUT" "B"
# Count table rows with "live" (exclude activation messages which also contain "live")
MOVE_COUNT=$(echo "$OUT" | grep "live" | grep -v "activated" | grep -v "mode=live" | wc -l)
assert_eq "Two active moves" "$MOVE_COUNT" "2"

# ═══════════════════════════════════════════════════════════════
# TEST 8 : Merge strategy
# ═══════════════════════════════════════════════════════════════
echo "── Test 8: Merge strategy ──"
OUT=$(run_cli "activate-move circle --tracks 1-3; set-merge-strategy crossfade")
assert_contains "Strategy set" "$OUT" "crossfade"
OUT=$(run_cli "set-merge-strategy invalid")
assert_contains "Invalid strategy error" "$OUT" "Unknown strategy"

# ═══════════════════════════════════════════════════════════════
# TEST 9 : Set move speed
# ═══════════════════════════════════════════════════════════════
echo "── Test 9: Set move speed ──"
OUT=$(run_cli "activate-move circle --tracks 1-3; set-move-speed circle-1 2.0")
assert_contains "Speed set" "$OUT" "speed set to 2"

# ═══════════════════════════════════════════════════════════════
# TEST 10 : Stop move
# ═══════════════════════════════════════════════════════════════
echo "── Test 10: Stop move ──"
OUT=$(run_cli "activate-move circle --tracks 1-3 --name testMove; stop-move testMove-1")
assert_contains "Move stopped" "$OUT" "stopped"

# ═══════════════════════════════════════════════════════════════
# TEST 11 : Stop all
# ═══════════════════════════════════════════════════════════════
echo "── Test 11: Stop all ──"
OUT=$(run_cli "activate-move circle --tracks 1-3 --name A; activate-move spiral --tracks 4-6 --name B; stop-all")
assert_contains "Stopped 2 moves" "$OUT" "Stopped 2 move"

# ═══════════════════════════════════════════════════════════════
# TEST 12 : Preview mode (no OSC)
# ═══════════════════════════════════════════════════════════════
echo "── Test 12: Preview mode ──"
OUT=$(run_cli "activate-move circle --tracks 1-3 --preview")
assert_contains "Preview mode" "$OUT" "mode=preview"

# ═══════════════════════════════════════════════════════════════
# TEST 13 : Templates list
# ═══════════════════════════════════════════════════════════════
echo "── Test 13: Templates list ──"
OUT=$(run_cli "templates")
assert_contains "Circle template" "$OUT" "circle"
assert_contains "Spiral template" "$OUT" "spiral"
assert_contains "Swarm template" "$OUT" "swarm"

# ═══════════════════════════════════════════════════════════════
# TEST 14 : Unknown template error
# ═══════════════════════════════════════════════════════════════
echo "── Test 14: Unknown template ──"
OUT=$(run_cli "activate-move nonexistent --tracks 1-3")
assert_contains "Error message" "$OUT" "Unknown template"

# ═══════════════════════════════════════════════════════════════
# TEST 15 : Full workflow (import → activate → sample → macros → stop)
# ═══════════════════════════════════════════════════════════════
echo "── Test 15: Full workflow ──"
TMP_SCRIPT=$(mktemp)
cat > "$TMP_SCRIPT" <<EOF
import-hol $HOL_FILE
list-tracks
activate-move circle --tracks 1-5 --name lead
sample --move lead-1 --obj 0 --samples 3 --duration 4
set-macros --scale 1.5
sample --move lead-1 --obj 0 --samples 3 --duration 4
stop-all
EOF
OUT=$("$CLI" --file "$TMP_SCRIPT" 2>&1 || true)
rm "$TMP_SCRIPT"
assert_contains "Import OK" "$OUT" "Imported 8 tracks"
assert_contains "Activate OK" "$OUT" "activated"
# With .hol imported, origin = centroid of tracks 1-5, so positions are offset
# Check that the range is 1.0 (circle diameter = 2 * radius = 1.0)
assert_contains "Sample range = 1.0" "$OUT" "x=\[1.000\]"
# After scale=1.5, range should be 1.5
assert_contains "Scaled range = 1.5" "$OUT" "x=\[1.500\]"
assert_contains "Stop OK" "$OUT" "Stopped 1 move"

# ═══════════════════════════════════════════════════════════════
# RÉSUMÉ
# ═══════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════
# TEST 16 : OSC validation — Holophonix profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 16: OSC validate (holophonix) ──"
OUT=$(run_cli "osc-validate --template circle --tracks 1-3 --port 9010 --profile holophonix --duration 2")
assert_contains "Validation pass" "$OUT" "PASS"
assert_contains "All packets valid" "$OUT" "All packets valid"
assert_contains "3 track IDs" "$OUT" "3 (1,2,3)"
assert_contains "No invalid packets" "$OUT" "Invalid: 0"

# ═══════════════════════════════════════════════════════════════
# TEST 17 : OSC validation — IEM profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 17: OSC validate (iem) ──"
OUT=$(run_cli "osc-validate --template spiral --tracks 1-5 --port 9011 --profile iem --duration 2")
assert_contains "Validation pass" "$OUT" "PASS"
assert_contains "5 track IDs" "$OUT" "5 (1,2,3,4,5)"

# ═══════════════════════════════════════════════════════════════
# TEST 18 : OSC validation — ADM profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 18: OSC validate (adm) ──"
OUT=$(run_cli "osc-validate --template lissajous --tracks 1-4 --port 9012 --profile adm --duration 2")
assert_contains "Validation pass" "$OUT" "PASS"

# ═══════════════════════════════════════════════════════════════
# TEST 19 : OSC packet rate is reasonable (~60fps × tracks)
# ═══════════════════════════════════════════════════════════════
echo "── Test 19: OSC packet rate ──"
OUT=$(run_cli "osc-validate --template circle --tracks 1-3 --port 9013 --profile holophonix --duration 2")
# 3 tracks × 60fps = 180 pkt/s. Check rate > 100
RATE=$(echo "$OUT" | grep "Packet rate" | grep -oP '[0-9]+\.' | head -1 | tr -d '.')
if [ -n "$RATE" ] && [ "$RATE" -gt 100 ]; then
    echo "  ✓ PASS: Packet rate > 100 ($RATE pkt/s)"
    PASS=$((PASS + 1))
else
    echo "  ✗ FAIL: Packet rate too low ($RATE)"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
    echo "ALL TESTS PASSED ✓"
    exit 0
else
    echo "SOME TESTS FAILED ✗"
    exit 1
fi
