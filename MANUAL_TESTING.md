# Manual Test Checklist — Stagespace Real-Life Testing

This checklist covers the 20% of testing that automated tests cannot reach:
visual rendering, performance, audio, OSC hardware, and long-running stability.

## Setup

```bash
# Terminal 1: Start the app
cd tauri-app && npm run tauri dev

# Terminal 2: OSC listener (optional, for validation)
cd tauri-app/src-tauri
./target/debug/stagespace-cli "osc-listen --port 8000 --validate --profile holophonix --timeout 300 --quiet"
```

---

## Phase 1: Project Setup

### 1.1 Import .hol
- [ ] Click "Import .hol" in toolbar
- [ ] Select a .hol file
- [ ] Track count appears in toolbar
- [ ] 3D markers appear at actual positions
- [ ] Track names appear in Inspector
- [ ] No console errors (F12 → Console)

### 1.2 OSC Configuration
- [ ] Click Settings → set Host/Port/Profile
- [ ] For Holophonix: host = `holophonix.local` or IP, port = 7788
- [ ] Click "Discover" → finds OSC targets on network
- [ ] No connection error in console

### 1.3 Audio Input (optional)
- [ ] Select microphone device in Audio Panel
- [ ] Click "Start listening"
- [ ] BPM appears (if music playing)
- [ ] Amplitude bars move (RMS, Bass, Mid, High)
- [ ] Spectrum visualization updates

---

## Phase 2: Trajectory Creation

### 2.1 Simple Mode (sliders)
- [ ] Click "+ Move" → slot appears
- [ ] Select template "Circle" from dropdown
- [ ] Adjust radius slider → 3D preview updates
- [ ] Adjust speed slider → trajectory animates faster
- [ ] No lag in slider response

### 2.2 Expert Mode (node editor)
- [ ] Toggle "Expert" mode
- [ ] Node editor appears (React Flow canvas)
- [ ] Drag a node from palette → appears on canvas
- [ ] Connect two nodes (drag from output to input)
- [ ] Click a node → parameters in Inspector
- [ ] Delete a node (select + Delete key)
- [ ] Click "★ Save" → graph saved as Custom animation

### 2.3 Draw Mode
- [ ] Enable draw mode in 3D view
- [ ] Z slider adjusts height
- [ ] Click and drag → freehand path drawn
- [ ] Click "Done" → DrawSpline node created
- [ ] Trajectory follows drawn path

### 2.4 Track Assignment
- [ ] Open track picker for a move slot
- [ ] Select specific tracks (e.g., 1, 3, 5)
- [ ] Only selected tracks move when playing
- [ ] Unselected tracks stay still

---

## Phase 3: Playback

### 3.1 Single Move
- [ ] Click ▶ on a move slot
- [ ] Status indicator turns green ("1 live")
- [ ] Objects move in 3D preview
- [ ] Trajectory line visible
- [ ] No jitter/stutter at 60fps

### 3.2 Preview Mode
- [ ] Enable "preview" on a move
- [ ] Objects move in 3D
- [ ] No OSC sent (check listener — no packets)
- [ ] Status shows "preview"

### 3.3 Multiple Moves (parallel)
- [ ] Activate move A (tracks 1-3, circle)
- [ ] Activate move B (tracks 4-6, spiral)
- [ ] Both move simultaneously
- [ ] No interference between tracks
- [ ] Try overlapping tracks (1-3 + 3-5) → merge strategy applies

### 3.4 Merge Strategies
- [ ] Set merge strategy to "Override" → last move wins on conflict
- [ ] Set to "Crossfade" → smooth blend on conflict
- [ ] Set to "Blend" → average positions
- [ ] Set to "Priority" → highest priority wins
- [ ] No jitter on conflicting tracks

---

## Phase 4: Live Control

### 4.1 Macros (real-time)
- [ ] Adjust Scale slider → trajectory resizes instantly
- [ ] Adjust Speed → animation speeds up/slows down
- [ ] Adjust Shift X/Y/Z → trajectory moves
- [ ] Adjust Yaw/Pitch/Roll → trajectory rotates
- [ ] No lag between slider and 3D update

### 4.2 Hot-swap Graph
- [ ] While move is playing, switch to Expert mode
- [ ] Modify a node parameter (e.g., circle radius)
- [ ] Trajectory updates without stopping
- [ ] Crossfade is smooth (no jump)
- [ ] No OSC interruption

### 4.3 Manipulate Mode
- [ ] Enable manipulate mode in 3D view
- [ ] Drag an object → position overrides
- [ ] Object stays at dragged position
- [ ] Release → object resumes trajectory
- [ ] Drag the group handle → all objects move together

### 4.4 Panic
- [ ] Press Esc or click Panic button
- [ ] All movements stop immediately
- [ ] Status returns to "Idle"
- [ ] No residual OSC output

### 4.5 Keyboard Shortcuts (Live)
- [ ] Space — play/stop the selected move (click a move first to select it)
- [ ] Enter — GO (setlist advance, crossfade)
- [ ] Shift+Enter — recall next cue
- [ ] Backspace — recall previous cue
- [ ] Esc — Panic (stop all + send origin positions)
- [ ] Ctrl+Z / Ctrl+Y — Undo/Redo graph edits
- [ ] Verify: shortcuts don't fire when typing in input fields

---

## Phase 5: Setlist

### 5.1 Build Setlist
- [ ] Click ★ on a move → adds to setlist
- [ ] Reorder setlist items (up/down)
- [ ] Setlist order displayed correctly

### 5.2 GO
- [ ] Click "GO ▶" → current moves stop, next setlist item plays
- [ ] Fade duration respected
- [ ] Setlist index advances

---

## Phase 6: Performance

### 6.1 Frame Rate
- [ ] Open DevTools → Performance tab
- [ ] Record 10 seconds during playback
- [ ] Check: 60fps maintained
- [ ] No frame drops > 16ms

### 6.2 CPU/Memory
- [ ] Check Task Manager / Activity Monitor
- [ ] CPU < 15% for 8 tracks
- [ ] Memory stable (no leak over 5 minutes)
- [ ] No thread explosion (check thread count)

### 6.3 Long-Running Stability
- [ ] Leave playback running for 10 minutes
- [ ] No crash
- [ ] No memory growth
- [ ] Frame rate stable
- [ ] OSC output continuous (check listener)

---

## Phase 7: OSC Output Validation

### 7.1 Format Check
- [ ] Start `osc-listen --port <port> --validate --profile <profile>`
- [ ] Activate a move
- [ ] Listener shows: ✓ All packets valid
- [ ] Correct addresses (e.g., `/track/1/xyz` for Holophonix)
- [ ] 3 float args per packet (x, y, z or aed)
- [ ] No NaN/Inf values

### 7.2 Rate Check
- [ ] Packet rate ~60 × n_tracks per second
- [ ] No gaps in output
- [ ] No duplicate packets

### 7.3 Real Hardware (if available)
- [ ] Connect to Holophonix/SPAT
- [ ] Sources move in the spatialization software
- [ ] Positions match 3D preview
- [ ] No jitter in hardware software

### 7.4 OSC Error Detection
- [ ] Start a move with valid OSC target
- [ ] Disconnect network cable (or change target IP to unreachable)
- [ ] Verify: red toast appears after ~1s: "OSC output failing: X% packet loss"
- [ ] Reconnect network
- [ ] Verify: toast does not reappear on next playback session

### 7.5 Storage Quota Warning
- [ ] Fill localStorage to near quota (save many large graphs)
- [ ] Verify: red sticky toast appears: "Storage full! Export your show file immediately"
- [ ] Export a .json show file as backup
- [ ] Clear some storage and verify toast disappears on next save

### 7.6 OSC Config Lock During Playback
- [ ] Start a move (playback active)
- [ ] Try to change OSC address in Toolbar
- [ ] Verify: warning toast "Cannot change OSC address during playback"
- [ ] Try to change OSC port
- [ ] Verify: warning toast appears
- [ ] Stop all moves
- [ ] Change OSC address — should now succeed

---

## Phase 8: Persistence

### 8.1 Save/Load
- [ ] Save graph to .hfg file
- [ ] Load graph from .hfg file
- [ ] Graph restored correctly

### 8.2 Auto-save
- [ ] Modify a move
- [ ] Close app
- [ ] Reopen app
- [ ] Moves and graphs restored from localStorage

### 8.3 Cues
- [ ] Store a cue (current state snapshot)
- [ ] Recall the cue → state restored
- [ ] Cue persists after restart

---

## Phase 9: Edge Cases

### 9.1 Empty State
- [ ] Start app with no .hol → manual OSC IDs work
- [ ] No graph loaded → default Circle preset appears
- [ ] No moves active → status "Idle"

### 9.2 Error Handling
- [ ] Invalid graph (no Output node) → error message shown
- [ ] OSC connection failed → error in console, app doesn't crash
- [ ] Audio device unavailable → graceful fallback

### 9.3 Rapid Interaction
- [ ] Click ▶ then ■ rapidly → no crash
- [ ] Change template rapidly → no race condition
- [ ] Drag slider rapidly → no lag/crash
- [ ] Switch Expert/Simple rapidly → no crash

---

## Quick Smoke Test (5 minutes)

Minimum viable test before a demo:

1. [ ] App launches without error
2. [ ] Import .hol → tracks visible
3. [ ] Create move (circle) → ▶ Play → objects move
4. [ ] Slider scale → trajectory resizes
5. [ ] Panic (Esc) → everything stops
6. [ ] No console errors during the whole test

---

## Automated OSC Validation (CLI)

```bash
# Validate Holophonix format
./stagespace-cli "osc-validate --template circle --tracks 1-5 --port 8000 --profile holophonix --duration 3"

# Validate IEM format
./stagespace-cli "osc-validate --template spiral --tracks 1-5 --port 8000 --profile iem --duration 3"

# Validate ADM format
./stagespace-cli "osc-validate --template lissajous --tracks 1-8 --port 8000 --profile adm --duration 3"

# Listen manually (while clicking in the UI)
./stagespace-cli "osc-listen --port 8000 --validate --profile holophonix --timeout 60"
```

Expected output: `✓ PASS: All packets valid, rate OK, all tracks covered`

---

## Phase 0 — Automated smoke test (validated 2026-11-01)

Real boot + end-to-end OSC-IN chain, without UI automation:

```bash
cd tauri-app/frontend && npm run build            # fresh dist
cd ../src-tauri && cargo build --bin stagespace-tauri  # ~2min incremental

# Launch for 30s on the real display
(timeout 30 ./target/debug/stagespace-tauri > /tmp/stagespace-smoke.log 2>&1 &)
sleep 4

# Send a real OSC-IN packet — end-to-end show-control
python3 -c "
import socket
def osc_str(s):
    b = s.encode() + b'\0'
    return b + b'\0' * ((4 - len(b) % 4) % 4)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for a in ['/stagespace/disarm', '/stagespace/arm']:
    sock.sendto(osc_str(a) + osc_str(','), ('127.0.0.1', 8001))
"
sleep 6 && tail -10 /tmp/stagespace-smoke.log
```

**Expected**: plugins loaded · `OSC receiver listening on port 8001` ·
supervisor active · `OSC output now sending to …` · `OSC master arm:
DISARMED` then `ARMED`. Proves: healthy boot, live webview, real
show-control backend (UDP → command → state).

**Not covered**: inter-webview events (`conduite:state/cmd`,
`live:state`) — opening the detached window needs a UI click
(no xdotool). Covered in jsdom: `useConduiteBroadcast.test`,
`liveStateChannel.*.test` (14 tests).

### Detached windows checklist (manual)

- [ ] `▶` in PerformView opens `?view=run` — pads/radar/gestures at live
      state (not frozen — the `live:state` channel must feed them)
- [ ] `⧉` opens `?view=conduite` — populated cue list, live NOW/NEXT
- [ ] Dbl-click cue in the detached window → recall in the main one
- [ ] Detached DRY-RUN button → toggles arm in the main one
- [ ] Closing the main window: the detached one continues (watchdog repoll >5s)
- [ ] Closing the detached window: `live:state` continues in the main one
