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
# + sweep de TOUS les templates (Test 20)
# + couverture des commandes spatial FX / OSC IN / zones / perf (Tests 21-25)
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

# Sortie de la dernière commande run_cli (OUT) et son exit code (CLI_RC).
OUT=""
CLI_RC=0

# ─── Helper : exécute le CLI et capture la sortie + l'exit code ───
# N'avorte jamais — c'est au caller de décider si l'erreur est attendue
# (assert_exit_ok pour le happy path, assert_contains pour les erreurs).
run_cli() {
    CLI_RC=0
    OUT=$("$CLI" "$1" 2>&1) || CLI_RC=$?
}

# ─── Helpers : assertions ───
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

# ─── Helper : la dernière commande happy-path doit avoir exit 0 ───
# Sans ça, un "✗ Unknown ..." silencieux dans la sortie passerait inaperçu.
assert_exit_ok() {
    local label="$1"
    if [ "$CLI_RC" -eq 0 ]; then
        echo "  $PASS_STR: $label (exit 0)"
        PASS=$((PASS + 1))
    else
        echo "  $FAIL_STR: $label (exit code $CLI_RC, attendu 0)"
        echo "    Got: $OUT"
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
run_cli "import-hol $HOL_FILE"
assert_exit_ok "import-hol exits 0"
assert_contains "Import success message" "$OUT" "Imported 8 tracks"
assert_contains "File path in output" "$OUT" "test_project.hol"

# ═══════════════════════════════════════════════════════════════
# TEST 2 : List tracks
# ═══════════════════════════════════════════════════════════════
echo "── Test 2: List tracks ──"
run_cli "import-hol $HOL_FILE; list-tracks"
assert_exit_ok "list-tracks exits 0"
assert_contains "Track 1 name" "$OUT" "Lead Vocal"
assert_contains "Track 5 name" "$OUT" "Bass"
assert_contains "Track count" "$OUT" "8"

# ═══════════════════════════════════════════════════════════════
# TEST 3 : Activate move (circle)
# ═══════════════════════════════════════════════════════════════
echo "── Test 3: Activate move ──"
run_cli "import-hol $HOL_FILE; activate-move circle --tracks 1-5 --name myCircle"
assert_exit_ok "activate-move exits 0"
assert_contains "Activation message" "$OUT" "activated"
assert_contains "Move name" "$OUT" "myCircle"
assert_contains "Track range" "$OUT" "tracks=1-5"
assert_contains "Mode live" "$OUT" "mode=live"

# ═══════════════════════════════════════════════════════════════
# TEST 4 : List moves
# ═══════════════════════════════════════════════════════════════
echo "── Test 4: List moves ──"
run_cli "import-hol $HOL_FILE; activate-move circle --tracks 1-3 --name circleA; list-moves"
assert_exit_ok "list-moves exits 0"
assert_contains "Move in list" "$OUT" "circleA"
assert_contains "Track count" "$OUT" "3"

# ═══════════════════════════════════════════════════════════════
# TEST 5 : Sample trajectory — circle should produce circular motion
# ═══════════════════════════════════════════════════════════════
echo "── Test 5: Sample trajectory (circle) ──"
run_cli "activate-move circle --tracks 1-5; sample --move circle-1 --obj 0 --samples 5 --duration 4"
assert_exit_ok "sample exits 0"
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
run_cli "activate-move circle --tracks 1-5; set-macros --scale 2.0; sample --move circle-1 --obj 0 --samples 3 --duration 4"
assert_exit_ok "set-macros exits 0"
# With scale=2.0, first point should be at (1.0, 0, 0)
assert_contains "Scaled x=1.0" "$OUT" "0.000, 1.000000"
assert_contains "X range = 2.0" "$OUT" "x=\[2.000\]"

# ═══════════════════════════════════════════════════════════════
# TEST 7 : Two moves in parallel
# ═══════════════════════════════════════════════════════════════
echo "── Test 7: Two moves parallel ──"
run_cli "activate-move circle --tracks 1-3 --name A; activate-move spiral --tracks 4-6 --name B; list-moves"
assert_exit_ok "parallel moves exits 0"
assert_contains "Move A in list" "$OUT" "A"
assert_contains "Move B in list" "$OUT" "B"
# Count table rows with "live" (exclude activation messages which also contain "live")
MOVE_COUNT=$(echo "$OUT" | grep "live" | grep -v "activated" | grep -v "mode=live" | wc -l)
assert_eq "Two active moves" "$MOVE_COUNT" "2"

# ═══════════════════════════════════════════════════════════════
# TEST 8 : Merge strategy
# ═══════════════════════════════════════════════════════════════
echo "── Test 8: Merge strategy ──"
run_cli "activate-move circle --tracks 1-3; set-merge-strategy crossfade"
assert_exit_ok "set-merge-strategy exits 0"
assert_contains "Strategy set" "$OUT" "crossfade"
run_cli "set-merge-strategy invalid"
assert_contains "Invalid strategy error" "$OUT" "Unknown strategy"

# ═══════════════════════════════════════════════════════════════
# TEST 9 : Set move speed
# ═══════════════════════════════════════════════════════════════
echo "── Test 9: Set move speed ──"
run_cli "activate-move circle --tracks 1-3; set-move-speed circle-1 2.0"
assert_exit_ok "set-move-speed exits 0"
assert_contains "Speed set" "$OUT" "speed set to 2"

# ═══════════════════════════════════════════════════════════════
# TEST 10 : Stop move
# ═══════════════════════════════════════════════════════════════
echo "── Test 10: Stop move ──"
run_cli "activate-move circle --tracks 1-3 --name testMove; stop-move testMove-1"
assert_contains "Move stopped" "$OUT" "stopped"

# ═══════════════════════════════════════════════════════════════
# TEST 11 : Stop all
# ═══════════════════════════════════════════════════════════════
echo "── Test 11: Stop all ──"
run_cli "activate-move circle --tracks 1-3 --name A; activate-move spiral --tracks 4-6 --name B; stop-all"
assert_exit_ok "stop-all exits 0"
assert_contains "Stopped 2 moves" "$OUT" "Stopped 2 move"

# ═══════════════════════════════════════════════════════════════
# TEST 12 : Preview mode (no OSC)
# ═══════════════════════════════════════════════════════════════
echo "── Test 12: Preview mode ──"
run_cli "activate-move circle --tracks 1-3 --preview"
assert_exit_ok "preview activate exits 0"
assert_contains "Preview mode" "$OUT" "mode=preview"

# ═══════════════════════════════════════════════════════════════
# TEST 13 : Templates list
# ═══════════════════════════════════════════════════════════════
echo "── Test 13: Templates list ──"
run_cli "templates"
assert_exit_ok "templates exits 0"
assert_contains "Circle template" "$OUT" "circle"
assert_contains "Spiral template" "$OUT" "spiral"
assert_contains "Swarm template" "$OUT" "swarm"

# ═══════════════════════════════════════════════════════════════
# TEST 14 : Unknown template error
# ═══════════════════════════════════════════════════════════════
echo "── Test 14: Unknown template ──"
run_cli "activate-move nonexistent --tracks 1-3"
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
CLI_RC=0
OUT=$("$CLI" --file "$TMP_SCRIPT" 2>&1) || CLI_RC=$?
rm "$TMP_SCRIPT"
assert_exit_ok "workflow script exits 0"
assert_contains "Import OK" "$OUT" "Imported 8 tracks"
assert_contains "Activate OK" "$OUT" "activated"
# With .hol imported, origin = centroid of tracks 1-5, so positions are offset
# Check that the range is 1.0 (circle diameter = 2 * radius = 1.0)
assert_contains "Sample range = 1.0" "$OUT" "x=\[1.000\]"
# After scale=1.5, range should be 1.5
assert_contains "Scaled range = 1.5" "$OUT" "x=\[1.500\]"
assert_contains "Stop OK" "$OUT" "Stopped 1 move"

# ═══════════════════════════════════════════════════════════════
# TEST 16 : OSC validation — Holophonix profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 16: OSC validate (holophonix) ──"
run_cli "osc-validate --template circle --tracks 1-3 --port 9010 --profile holophonix --duration 2"
assert_exit_ok "osc-validate exits 0"
assert_contains "Validation pass" "$OUT" "PASS"
assert_contains "All packets valid" "$OUT" "All packets valid"
assert_contains "3 track IDs" "$OUT" "3 (1,2,3)"
assert_contains "No invalid packets" "$OUT" "Invalid: 0"

# ═══════════════════════════════════════════════════════════════
# TEST 17 : OSC validation — IEM profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 17: OSC validate (iem) ──"
run_cli "osc-validate --template spiral --tracks 1-5 --port 9011 --profile iem --duration 2"
assert_exit_ok "osc-validate iem exits 0"
assert_contains "Validation pass" "$OUT" "PASS"
assert_contains "5 track IDs" "$OUT" "5 (1,2,3,4,5)"

# ═══════════════════════════════════════════════════════════════
# TEST 18 : OSC validation — ADM profile
# ═══════════════════════════════════════════════════════════════
echo "── Test 18: OSC validate (adm) ──"
run_cli "osc-validate --template lissajous --tracks 1-4 --port 9012 --profile adm --duration 2"
assert_exit_ok "osc-validate adm exits 0"
assert_contains "Validation pass" "$OUT" "PASS"

# ═══════════════════════════════════════════════════════════════
# TEST 19 : OSC packet rate is reasonable (~60fps × tracks)
# ═══════════════════════════════════════════════════════════════
echo "── Test 19: OSC packet rate ──"
run_cli "osc-validate --template circle --tracks 1-3 --port 9013 --profile holophonix --duration 2"
assert_exit_ok "osc-validate rate exits 0"
# 3 tracks × 60fps = 180 pkt/s. Check rate > 100
RATE=$(echo "$OUT" | grep "Packet rate" | grep -oP '[0-9]+\.' | head -1 | tr -d '.')
if [ -n "$RATE" ] && [ "$RATE" -gt 100 ]; then
    echo "  ✓ PASS: Packet rate > 100 ($RATE pkt/s)"
    PASS=$((PASS + 1))
else
    echo "  ✗ FAIL: Packet rate too low ($RATE)"
    FAIL=$((FAIL + 1))
fi

# ═══════════════════════════════════════════════════════════════
# TEST 20 : Template sweep — chaque template doit compiler + sampler + stopper
# Couvre les engines non testés ailleurs : vectorfield, follow modes
# (pursue/evade/orbit/arrive), figure8, pendulum, perlin, bouncing, etc.
# ═══════════════════════════════════════════════════════════════
echo "── Test 20: Template sweep (tous les templates + alias follow) ──"
run_cli "templates"
# Les ids sont la 1re colonne des lignes commençant par une minuscule
TEMPLATE_IDS=$(echo "$OUT" | awk '/^[a-z]/ {print $1}')
# Les alias de follow ne sont pas listés par `templates` — on les ajoute
TEMPLATE_IDS="$TEMPLATE_IDS pursue evade orbit arrive"
for t in $TEMPLATE_IDS; do
    run_cli "activate-move $t --tracks 1-3; sample --move $t-1 --obj 0 --samples 3 --duration 2; stop-all"
    if [ "$CLI_RC" -eq 0 ] \
        && echo "$OUT" | grep -q "activated" \
        && echo "$OUT" | grep -q "0.000," \
        && echo "$OUT" | grep -q "Stopped 1 move"; then
        echo "  $PASS_STR: template '$t' (activate → sample → stop)"
        PASS=$((PASS + 1))
    else
        echo "  $FAIL_STR: template '$t' (exit $CLI_RC)"
        echo "    Got: $OUT"
        FAIL=$((FAIL + 1))
    fi
done

# ═══════════════════════════════════════════════════════════════
# TEST 21 : Spatial channels (P1) — set-channel / clear-channel
# ═══════════════════════════════════════════════════════════════
echo "── Test 21: Spatial channels ──"
run_cli "set-channel 0 gain 0.8; set-channel 0 spread 0.5"
assert_exit_ok "set-channel exits 0"
assert_contains "gain set" "$OUT" "Channel 'gain' set to 0.8"
assert_contains "spread set" "$OUT" "Channel 'spread' set to 0.5"
run_cli "set-channel 0 gain 0.8; clear-channel 0 gain"
assert_exit_ok "clear-channel exits 0"
assert_contains "channel cleared" "$OUT" "cleared for object 0"
run_cli "set-channel 1 gain 0.5; set-channel 2 yaw 45; clear-channel all"
assert_contains "all channels cleared" "$OUT" "All spatial channels cleared"
run_cli "set-channel 0 bogus 1"
assert_contains "invalid channel rejected" "$OUT" "Unknown spatial channel"

# ═══════════════════════════════════════════════════════════════
# TEST 22 : Modulations cinématiques (P2) — mod-add/mod-list/mod-clear
# ═══════════════════════════════════════════════════════════════
echo "── Test 22: Kinematic modulations ──"
run_cli "mod-add speed gain 0.5"
assert_exit_ok "mod-add exits 0"
assert_contains "speed modulation added" "$OUT" "Modulation #0 added"
assert_contains "speed → gain" "$OUT" "speed → gain"
# angvel = vitesse angulaire autour du listener (arg positionnel 7 : x,y,z)
run_cli "mod-add angvel yaw 1.0 - - - - 0,0,1.5"
assert_exit_ok "mod-add angvel exits 0"
assert_contains "angvel modulation added" "$OUT" "angvel → yaw"
run_cli "mod-add speed spread 0.3 0.1 0 1 2; mod-list"
assert_contains "mod-list shows rules" "$OUT" "Modulations:"
assert_contains "object filter listed" "$OUT" "obj=Some(2)"
run_cli "mod-add speed gain 0.5; mod-clear all"
assert_contains "all modulations cleared" "$OUT" "All modulations cleared"
run_cli "kin-smoothing 0.8"
assert_contains "kin-smoothing set" "$OUT" "Kinematic smoothing set to 0.8"
run_cli "mod-add bogus gain 1"
assert_contains "invalid source rejected" "$OUT" "Unknown kinematic source"

# ═══════════════════════════════════════════════════════════════
# TEST 23 : Zones d'effets spatiaux (P4) — zone-add/zone-list/zone-clear
# ═══════════════════════════════════════════════════════════════
echo "── Test 23: Spatial FX zones ──"
run_cli "zone-add sphere 0 0 0 0.5 --channels gain=0.5,spread=1 --falloff 0.2"
assert_exit_ok "zone-add sphere exits 0"
assert_contains "zone added" "$OUT" "Zone #0 added"
run_cli "zone-add sphere 0 0 0 0.5 --channels gain=0.5; zone-add box -1 -1 -1 1 1 1 --channels spread=0.3 --objs 0,2; zone-list"
assert_exit_ok "zone-list exits 0"
assert_contains "two zones listed" "$OUT" "Zones (2):"
assert_contains "sphere zone listed" "$OUT" "sphere"
assert_contains "box zone listed" "$OUT" "box"
assert_contains "objs filter listed" "$OUT" "objs=\[0, 2\]"
run_cli "zone-add sphere 0 0 0 0.5 --channels gain=0.5; zone-clear all"
assert_contains "all zones cleared" "$OUT" "All zones cleared"
run_cli "zone-add sphere 0 0 0 0.5; zone-list"
assert_contains "missing --channels rejected" "$OUT" "Missing --channels"

# ═══════════════════════════════════════════════════════════════
# TEST 24 : OSC IN mappings (P3) — osc-map/osc-maps/osc-inject/osc-unmap/osc-in
# ═══════════════════════════════════════════════════════════════
echo "── Test 24: OSC IN mappings ──"
run_cli "osc-map /ctl/scale macro:scale --scale 2 --min 0.1 --max 4"
assert_exit_ok "osc-map exits 0"
assert_contains "mapping added" "$OUT" "Mapping added"
run_cli "osc-map /ctl/scale macro:scale; osc-maps"
assert_contains "mapping listed" "$OUT" "/ctl/scale"
assert_contains "macro destination" "$OUT" "macro:scale"
# osc-inject route un message dans le pipeline sans socket UDP
run_cli "osc-map /ctl/gain channel:gain:0; osc-inject /ctl/gain 0.7"
assert_exit_ok "osc-inject exits 0"
assert_contains "inject ack" "$OUT" "Injected /ctl/gain"
assert_contains "value routed" "$OUT" "routed=1"
run_cli "osc-map /ctl/x macro:scale; osc-unmap /ctl/x; osc-maps"
assert_contains "mapping removed" "$OUT" "Mapping removed"
assert_contains "no mappings left" "$OUT" "No OSC IN mappings"
run_cli "osc-in stats"
assert_contains "stats counters" "$OUT" "received="
run_cli "osc-in off; osc-in stats; osc-in on"
assert_contains "anti-loop disable" "$OUT" "OSC IN disabled"
assert_contains "enabled=false in stats" "$OUT" "enabled=false"
run_cli "osc-unmap /nonexistent"
assert_contains "unmap missing → error" "$OUT" "No mapping for address"

# ═══════════════════════════════════════════════════════════════
# TEST 25 : Perf stats
# ═══════════════════════════════════════════════════════════════
echo "── Test 25: Perf stats ──"
run_cli "activate-move circle --tracks 1-3; perf; stop-all"
assert_exit_ok "perf exits 0"
assert_contains "MergeRuntime header" "$OUT" "MergeRuntime:"
assert_contains "fps field" "$OUT" "fps:"
assert_contains "active_moves field" "$OUT" "active_moves: 1"

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
