from fastapi import FastAPI, WebSocket, HTTPException, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import asyncio
import logging
import time
import json
import uuid
from datetime import datetime

logger = logging.getLogger("stagespace.api")

from orchestrator import orchestrate
from validator import TrajectoryValidator
import math_engine
import physics_engine
from osc_sender import OSCSender, OSC_PROFILES
from osc_receiver import OscReceiver
from presets import PresetManager
from modulator import Modulator, WAVEFORMS
from bpm import BpmTracker
from audio_reactor import AudioReactor, AUDIO_SOURCES
from patch import PatchManager
from cuelist import CuelistManager
import rust_core_client as rust_core
_rust_client: Optional[rust_core.RustCoreClient] = None

app = FastAPI(title="StageSPACE API", version="1.0.0")

# ── CORS ─────────────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Active playback sessions ──────────────────────────────────────────────────
# session_id -> { sender, task, engine, fps }
_sessions: Dict[str, Dict[str, Any]] = {}
_bpm: BpmTracker = BpmTracker()
_audio: AudioReactor = AudioReactor(sessions=_sessions)
_patch: PatchManager = PatchManager()
_osc_receiver: OscReceiver = OscReceiver(port=8001, sessions=_sessions,
                                          bpm_tracker=_bpm, audio_reactor=_audio)
_presets: PresetManager = PresetManager()
_cuelist: CuelistManager = CuelistManager()
_ws_clients: List[WebSocket] = []


@app.on_event("startup")
async def _startup():
    global _rust_client
    await _osc_receiver.start()
    _osc_receiver.add_mapping('/midi/clock', '_bpm_clock', None)  # handled below
    _osc_receiver.add_mapping('/stagespace/bpm', '_bpm_set', None)
    
    # Try to start the HOLOFLOW Rust core for precise OSC timing
    try:
        rust_core.start_rust_core()
        _rust_client = rust_core.RustCoreClient()
        logger.info("Rust core started successfully")
    except Exception as exc:
        logger.warning("Could not start Rust core; falling back to Python engine: %s", exc)
        _rust_client = None


@app.on_event("shutdown")
async def _shutdown():
    await _osc_receiver.stop()
    rust_core.stop_rust_core()


# ── Patch endpoints ─────────────────────────────────────────────────────────

class ObjectDef(BaseModel):
    name:  str  = ''
    color: str  = ''
    notes: str  = ''


class GroupDef(BaseModel):
    object_ids: List[int]
    engine:     str            = 'circular'
    params:     Dict[str, Any] = {}
    profile:    str            = 'adm_osc'
    color:      str            = ''
    anchor:     Dict[str, float] = {'x': 0.0, 'y': 0.0, 'z': 0.0}


@app.get("/api/patch")
async def patch_get():
    """Get the full patch (objects + groups)."""
    return {
        "objects": _patch.list_objects(),
        "groups":  _patch.list_groups(),
    }


@app.put("/api/patch/objects/{osc_id}")
async def patch_set_object(osc_id: int, req: ObjectDef):
    """Create or update an audio object definition."""
    return _patch.set_object(osc_id, req.name, req.color, req.notes)


@app.delete("/api/patch/objects/{osc_id}")
async def patch_remove_object(osc_id: int):
    """Remove an audio object."""
    _patch.remove_object(osc_id)
    return {"removed": osc_id}


@app.put("/api/patch/groups/{name}")
async def patch_set_group(name: str, req: GroupDef):
    """Create or update a group."""
    return _patch.set_group(name, req.object_ids, req.engine,
                             req.params, req.profile, req.color, req.anchor)


@app.delete("/api/patch/groups/{name}")
async def patch_remove_group(name: str):
    """Remove a group."""
    _patch.remove_group(name)
    return {"removed": name}


@app.post("/api/patch/groups/{name}/play")
async def patch_play_group(name: str, host: str = '127.0.0.1',
                            port: int = 9000, fps: int = 60):
    """Launch a session for a group using its default engine + params.

    Equivalent to POST /api/play with the group's config pre-filled.
    object_offset and label are set automatically from the group.
    """
    try:
        play_params = _patch.group_to_play_params(name, host, port, fps)
    except KeyError as e:
        raise HTTPException(404, str(e))

    req = PlayRequest(**play_params)
    return await play(req)


@app.delete("/api/patch")
async def patch_clear():
    """Clear the entire patch (objects + groups)."""
    _patch.clear()
    return {"status": "cleared"}


# ── Audio reactor endpoints ───────────────────────────────────────────

class AudioBindRequest(BaseModel):
    source:  str
    macro:   str
    min_val: float = 0.5
    max_val: float = 2.0
    smooth:  float = 0.7


@app.get("/api/audio")
async def audio_status():
    """Audio reactor bindings and available sources."""
    return {
        "bindings": _audio.list(),
        "sources":  list(AUDIO_SOURCES),
        "osc_addresses": {
            s: f"/audio/{s}" for s in AUDIO_SOURCES
        },
        "osc_in_port": _osc_receiver.port,
    }


@app.post("/api/audio/bind")
async def audio_bind(req: AudioBindRequest):
    """Bind an audio source to a macro.

    Example: rms → speed [0.5..2.0] with smoothing 0.7
    Send /audio/rms f to UDP:8001 to drive it.
    """
    try:
        binding = _audio.bind(req.source, req.macro,
                              req.min_val, req.max_val, req.smooth)
        return binding
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/audio/bind/{source}/{macro}")
async def audio_unbind(source: str, macro: str):
    """Remove an audio binding."""
    _audio.unbind(source, macro)
    return {"bindings": _audio.list()}


@app.delete("/api/audio/bind")
async def audio_clear():
    """Clear all audio bindings."""
    _audio.clear()
    return {"bindings": []}


# ── BPM endpoints ─────────────────────────────────────────────────

@app.post("/api/bpm/tap")
async def bpm_tap():
    """Register a tap. Returns BPM once 2+ taps received."""
    bpm = _bpm.tap()
    return {"bpm": bpm, "taps": len(_bpm._tap_times)}


@app.post("/api/bpm/set")
async def bpm_set(bpm: float):
    """Set BPM manually."""
    _bpm.bpm = bpm
    return {"bpm": _bpm.bpm}


@app.get("/api/bpm")
async def bpm_status():
    return {"bpm": _bpm.bpm}


@app.post("/api/bpm/reset")
async def bpm_reset():
    _bpm.reset()
    return {"bpm": None}


@app.post("/api/bpm/sync/{session_id}")
async def bpm_sync(session_id: str, beats: float = 4.0):
    """Sync session loop speed to current BPM over `beats` beats.

    Computes and applies the speed multiplier so one trajectory cycle
    lasts exactly `beats` beats at the current BPM.
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    if not _bpm.bpm:
        raise HTTPException(400, "BPM not set — use /api/bpm/tap or /api/bpm/set first")

    s    = _sessions[session_id]
    fps  = s["fps"]
    params = s.get("params", {})

    if s["engine"] == "custom":
        traj_duration = params.get("duration", 4.0)
    else:
        all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}
        if s["engine"] not in all_engines:
            raise HTTPException(400, f"Engine '{s['engine']}' does not support BPM sync")
        traj = all_engines[s["engine"]](fps=fps, **params)
        traj_duration = traj.get("duration", params.get("duration", 4.0))

    speed = _bpm.speed_for(traj_duration, beats)
    s["sender"].speed = speed

    return {
        "session_id":    session_id,
        "bpm":           _bpm.bpm,
        "beats":         beats,
        "traj_duration": traj_duration,
        "speed":         speed,
    }


# ── Preset endpoints ──────────────────────────────────────────────────

@app.get("/api/presets")
async def list_presets():
    """List all saved presets."""
    return {"presets": _presets.list(), "count": len(_presets.list())}


@app.get("/api/presets/{name}")
async def get_preset(name: str):
    """Get a preset config by name."""
    p = _presets.load(name)
    if not p:
        raise HTTPException(404, f"Preset '{name}' not found")
    return p


@app.post("/api/presets/{name}")
async def save_preset(name: str, config: Dict[str, Any]):
    """Save a preset manually from a config dict."""
    return _presets.save(name, config)


@app.post("/api/presets/{name}/snapshot")
async def snapshot_preset(name: str, session_id: Optional[str] = None):
    """Snapshot a live session as a named preset.

    If session_id is omitted, snapshots the first active session.
    """
    if not _sessions:
        raise HTTPException(400, "No active sessions to snapshot")
    if session_id:
        if session_id not in _sessions:
            raise HTTPException(404, f"Session '{session_id}' not found")
        s = _sessions[session_id]
    else:
        s = next(iter(_sessions.values()))
    config = PresetManager.snapshot_session(name, s)
    return _presets.save(name, config)


@app.post("/api/presets/{name}/recall")
async def recall_preset(name: str):
    """Recall a preset: launch a new session with its config + apply macros + mappings."""
    p = _presets.load(name)
    if not p:
        raise HTTPException(404, f"Preset '{name}' not found")

    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}
    if p["engine"] not in all_engines:
        raise HTTPException(400, f"Engine '{p['engine']}' not found")
    if p["profile"] not in OSC_PROFILES:
        raise HTTPException(400, f"Profile '{p['profile']}' not found")

    fps    = p.get("fps", 60)
    params = {k: v for k, v in p.get("params", {}).items() if k != "fps"}
    traj   = all_engines[p["engine"]](fps=fps, **params)
    seq    = OSCSender.frames_to_sequence(traj["frames"])

    sender = OSCSender(p["profile"], host=p["host"], port=p["port"])
    macros = p.get("macros", {})
    if "speed" in macros: sender.speed = macros["speed"]
    if "scale" in macros: sender.scale = macros["scale"]
    if "shift" in macros: sender.shift = macros["shift"]

    task = asyncio.create_task(
        sender.play_loop(seq, fps=fps, loop=p.get("loop", True))
    )
    session_id = str(uuid.uuid4())[:8]
    _sessions[session_id] = {
        "sender": sender, "task": task,
        "engine": p["engine"], "profile": p["profile"],
        "host": p["host"], "port": p["port"],
        "fps": fps, "loop": p.get("loop", True),
        "params": params,
        "started_at": datetime.now().isoformat(),
        "preset": name,
    }

    # restore OSC IN mappings
    for m in p.get("osc_mappings", []):
        transform = None
        if m.get("transform"):
            try:
                transform = eval(f"lambda v: {m['transform']}",
                                 {"abs": abs, "max": max, "min": min})
            except Exception:
                pass
        _osc_receiver.add_mapping(m["address"], m["macro"], transform)

    return {
        "session_id": session_id,
        "preset":     name,
        "engine":     p["engine"],
        "profile":    p["profile"],
        "target":     f"{p['host']}:{p['port']}",
        "frames":     len(seq),
    }


@app.delete("/api/presets/{name}")
async def delete_preset(name: str):
    """Delete a named preset."""
    if not _presets.delete(name):
        raise HTTPException(404, f"Preset '{name}' not found")
    return {"deleted": name}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

trajectory_cache: Dict[str, Dict[str, Any]] = {}


class GraphRequest(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]


class OSCConfig(BaseModel):
    renderer: str
    host: str = "127.0.0.1"
    port: int = 8000


class PlayRequest(BaseModel):
    engine:         str
    profile:        str           = "adm_osc"
    host:           str           = "127.0.0.1"
    port:           int           = 9000
    fps:            int           = 60
    loop:           bool          = True
    params:         Dict[str, Any] = {}
    object_offset:  int           = 0
    label:          str           = ''
    shift:          Dict[str, float] = {'x': 0.0, 'y': 0.0, 'z': 0.0}
    use_rust:       bool          = True  # Use Rust core when available


class MacroUpdate(BaseModel):
    speed:       Optional[float]            = None
    scale:       Optional[Dict[str, float]] = None
    shift:       Optional[Dict[str, float]] = None
    turbulence:  Optional[float]            = None


class SwapRequest(BaseModel):
    engine:      str
    params:      Dict[str, Any] = {}
    fade_frames: int            = 0


class LfoSlot(BaseModel):
    target:       str
    wave:         str   = 'sine'
    rate:         float = 0.5
    depth:        float = 0.3
    center:       float = 1.0
    phase_offset: float = 0.0


@app.get("/")
async def root():
    return {
        "name": "StageSPACE API",
        "version": "1.0.0",
        "sessions": len(_sessions),
        "status": "running",
        "engines": {
            "math": sorted(math_engine.ENGINES.keys()),
            "physics": sorted(physics_engine.ENGINES.keys()),
        },
        "profiles": sorted(OSC_PROFILES.keys()),
        "osc_in_port": _osc_receiver.port,
    }


@app.post("/api/compile-graph")
async def compile_graph(request: GraphRequest):
    """Compile un graph via l'orchestrateur (validation + compilation).

    Always returns HTTP 200.  Clients check the 'success' field:
      { success: true,  trajectory: {...}, engine: "...", issues: [], compile_ms: n }
      { success: false, issues: [{level,code,message},...], compile_ms: 0 }
    """
    graph  = {"nodes": request.nodes, "edges": request.edges}
    result = orchestrate(graph)

    payload = result.to_dict()

    if result.success:
        traj_id = f"traj_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        trajectory_cache[traj_id] = {
            "id":        traj_id,
            "trajectory": result.trajectory,
            "engine":    result.engine,
            "latency":   result.compile_ms / 1000,
            "timestamp": datetime.now().isoformat(),
        }
        payload["id"] = traj_id

    return payload


@app.post("/api/generate-direct")
async def generate_direct(engine: str, n_objects: int = 1,
                          duration: float = 10.0, fps: int = 60):
    """Génération rapide d'une trajectoire par nom de moteur (sans graph)."""
    t0 = time.perf_counter()
    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}
    if engine not in all_engines:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown engine '{engine}'. Available: {sorted(all_engines.keys())}"
        )
    try:
        trajectory = all_engines[engine](n_objects=n_objects, duration=duration, fps=fps)
        return {
            "engine": engine,
            "trajectory": trajectory,
            "latency": time.perf_counter() - t0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/trajectories")
async def list_trajectories():
    """Liste les trajectoires générées en session."""
    return {
        "count": len(trajectory_cache),
        "trajectories": [
            {"id": d["id"], "engine": d["engine"],
             "latency": d["latency"], "timestamp": d["timestamp"]}
            for d in trajectory_cache.values()
        ]
    }


@app.delete("/api/trajectories/{trajectory_id}")
async def delete_trajectory(trajectory_id: str):
    if trajectory_id in trajectory_cache:
        del trajectory_cache[trajectory_id]
        return {"status": "deleted", "id": trajectory_id}
    raise HTTPException(status_code=404, detail="Trajectory not found")


@app.get("/api/engines")
async def list_engines():
    """Liste tous les moteurs disponibles avec leurs paramètres."""
    import inspect
    result = {"math": {}, "physics": {}}
    for name, fn in math_engine.ENGINES.items():
        sig = inspect.signature(fn)
        result["math"][name] = {
            k: (p.default if p.default is not inspect.Parameter.empty else None)
            for k, p in sig.parameters.items()
            if k not in ("fps",)
        }
    for name, fn in physics_engine.ENGINES.items():
        sig = inspect.signature(fn)
        result["physics"][name] = {
            k: (p.default if p.default is not inspect.Parameter.empty else None)
            for k, p in sig.parameters.items()
            if k not in ("fps",)
        }
    return result


@app.websocket("/ws/compile")
async def websocket_compile(websocket: WebSocket):
    """
    WebSocket pour compilation en temps réel.
    Reçoit un graph JSON, retourne la trajectoire instantanément.
    """
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)

            await websocket.send_json({"status": "started", "progress": 0})

            try:
                t0 = time.perf_counter()
                result = graph_compiler.compile(payload)
                latency = time.perf_counter() - t0

                await websocket.send_json({
                    "status": "completed",
                    "progress": 100,
                    "engine": result["engine"],
                    "latency": latency,
                    "trajectory": result["trajectory"],
                })
            except Exception as e:
                await websocket.send_json({
                    "status": "error",
                    "message": str(e),
                    "progress": 100
                })
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()


@app.get("/api/renderers")
async def list_renderers():
    """List available OSC renderer profiles"""
    return {
        "renderers": [
            {
                "id": "adm_osc",
                "name": "ADM-OSC (EBU standard)",
                "format": "cartesian",
                "default_port": 9000,
                "address_pattern": "/adm/obj/{n}/cartpos"
            },
            {
                "id": "holophonix",
                "name": "Holophonix",
                "format": "cartesian",
                "default_port": 8000,
                "address_pattern": "/track/{n}/xyz"
            },
            {
                "id": "ircam_spat",
                "name": "IRCAM Spat",
                "format": "cartesian",
                "default_port": 8000,
                "address_pattern": "/source/{n}/xyz"
            },
            {
                "id": "iem_multiencoder",
                "name": "IEM MultiEncoder",
                "format": "polar",
                "default_port": 9000,
                "address_pattern": "/MultiEncoder/{n}/aed"
            },
            {
                "id": "generic_cartesian",
                "name": "Generic Cartesian",
                "format": "cartesian",
                "default_port": 7000,
                "address_pattern": "/object/{n}/xyz"
            },
            {
                "id": "generic_polar",
                "name": "Generic Polar",
                "format": "polar",
                "default_port": 7001,
                "address_pattern": "/object/{n}/azim+elev+dist"
            },
        ]
    }


# ── OSC IN config endpoint ───────────────────────────────────────────────

class MappingRequest(BaseModel):
    address:   str
    macro:     str
    transform: Optional[str] = None


@app.get("/api/osc-in")
async def osc_in_status():
    """OSC IN receiver status, native addresses, and custom mappings."""
    return {
        "port": _osc_receiver.port,
        "host": _osc_receiver.host,
        "native_addresses": [
            "/stagespace/speed          f  → all sessions",
            "/stagespace/speed/{sid}    f  → specific session",
            "/stagespace/scale/x        f",
            "/stagespace/scale/y        f",
            "/stagespace/scale/z        f",
            "/stagespace/shift/x        f",
            "/stagespace/shift/y        f",
            "/stagespace/shift/z        f",
            "/stagespace/stop               → stop all",
            "/stagespace/stop/{sid}         → stop session",
        ],
        "custom_mappings": {
            addr: macro
            for addr, (macro, _) in _osc_receiver._mappings.items()
        },
        "available_macros": [
            "speed", "scale_x", "scale_y", "scale_z",
            "scale_xy", "scale_xyz", "shift_x", "shift_y", "shift_z", "stop"
        ]
    }


@app.post("/api/osc-in/mapping")
async def add_mapping(req: MappingRequest):
    """Add a custom OSC address → macro mapping.

    Optional transform as a Python expression string, e.g.:
      '1.0 + v * 2.0'   maps raw -1..1 → speed 0..3
      'abs(v)'           maps signed → unsigned
      'v * 0.5 + 0.5'   maps -1..1 → 0..1
    """
    transform = None
    if req.transform:
        expr = req.transform
        try:
            transform = eval(f"lambda v: {expr}", {"abs": abs, "max": max, "min": min})
        except Exception as e:
            raise HTTPException(400, f"Invalid transform expression: {e}")

    _osc_receiver.add_mapping(req.address, req.macro, transform)
    return {"address": req.address, "macro": req.macro, "transform": req.transform}


@app.delete("/api/osc-in/mapping/{address:path}")
async def remove_mapping(address: str):
    """Remove a custom OSC address mapping."""
    _osc_receiver.remove_mapping('/' + address)
    return {"removed": '/' + address}


# ── Live playback endpoints ───────────────────────────────────────────────────

def _active_osc_ids() -> Dict[str, List[int]]:
    """Return {session_id: [osc_ids]} for all running sessions."""
    result: Dict[str, List[int]] = {}
    for sid, s in _sessions.items():
        sender = s["sender"]
        frame  = sender.current_frame
        if frame:
            result[sid] = [int(k) for k in frame.keys()]
        else:
            # derive from n_objects + object_offset before first frame
            n      = s.get("params", {}).get("n_objects", 1)
            offset = s.get("object_offset", 0)
            result[sid] = [offset + i + 1 for i in range(n)]
    return result


def _check_conflicts(requested_ids: List[int]) -> None:
    """Raise 409 if any requested OSC id is already owned by an active session."""
    active = _active_osc_ids()
    conflicts: Dict[int, str] = {}
    for sid, ids in active.items():
        for oid in ids:
            if oid in requested_ids:
                conflicts[oid] = sid
    if conflicts:
        detail = ", ".join(
            f"obj {oid} → session {sid}" for oid, sid in sorted(conflicts.items())
        )
        raise HTTPException(409, f"Object conflict: {detail}")


def _profile_to_address_template(profile: str) -> str:
    """Map OSC profile to address template used by Rust core."""
    templates = {
        "holophonix": "/track/{}/xyz",
        "adm_osc": "/adm/obj/{}/cartpos",
        "generic_cartesian": "/object/{}/xyz",
        "iem": "/MultiEncoder/{}/aed",
    }
    return templates.get(profile, "/track/{}/xyz")


@app.post("/api/play")
async def play(req: PlayRequest):
    """Start a trajectory loop. Returns a session_id for control."""
    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}
    if req.engine not in all_engines:
        raise HTTPException(400, f"Unknown engine '{req.engine}'. Available: {sorted(all_engines.keys())}")
    if req.profile not in OSC_PROFILES:
        raise HTTPException(400, f"Unknown profile '{req.profile}'. Available: {sorted(OSC_PROFILES.keys())}")

    n_objects = req.params.get("n_objects", 1)
    requested = [req.object_offset + i + 1 for i in range(int(n_objects))]
    _check_conflicts(requested)

    # ── Rust core fast path ───────────────────────────────────────────────────────
    rust_supported_engines = {
        "circular", "spiral", "lissajous", "figure8", "linear",
        "elliptical", "oscillation", "converge", "formation",
        "pendulum", "rose_curve", "helix",
        "bouncing", "avoidance", "spring", "follow", "swarm", "perlin_noise",
    }
    logger.debug("play request: engine=%s use_rust=%s rust_client=%s", req.engine, req.use_rust, _rust_client is not None)
    if req.use_rust and _rust_client is not None and req.engine in rust_supported_engines:
        logger.info("Using Rust core for session")
        params = {k: v for k, v in req.params.items() if k not in ('fps',)}
        params.setdefault("n_objects", 1)
        
        # Merge shift into params for Rust core
        params.setdefault("shift_x", req.shift.get('x', 0.0))
        params.setdefault("shift_y", req.shift.get('y', 0.0))
        params.setdefault("shift_z", req.shift.get('z', 0.0))
        
        session_id = str(uuid.uuid4())[:8]
        template = _profile_to_address_template(req.profile)
        
        logger.debug("Calling Rust core start_playback for session %s", session_id)
        response = await _rust_client.start_playback_async(
            session_id=session_id,
            trajectory_type=req.engine,
            params=params,
            osc_host=req.host,
            osc_port=req.port,
            osc_address_template=template,
            target_fps=req.fps,
        )
        logger.debug("Rust core response: %s", response)
        
        if not response.get("success"):
            error = response.get("error", "Unknown Rust core error")
            raise HTTPException(500, f"Rust core playback failed: {error}")
        
        _sessions[session_id] = {
            "rust":          True,
            "engine":        req.engine,
            "profile":       req.profile,
            "host":          req.host,
            "port":          req.port,
            "fps":           req.fps,
            "loop":          req.loop,
            "params":        params,
            "object_offset": req.object_offset,
            "label":         req.label,
            "started_at":    datetime.now().isoformat(),
        }
        
        return {
            "session_id":    session_id,
            "engine":        req.engine,
            "profile":       req.profile,
            "target":        f"{req.host}:{req.port}",
            "object_offset": req.object_offset,
            "label":         req.label,
            "backend":       "rust",
        }

    # ── Python fallback ─────────────────────────────────────────────────────────────
    params = {k: v for k, v in req.params.items()
              if k not in ('fps',)}
    trajectory = all_engines[req.engine](fps=req.fps, **params)
    sequence   = OSCSender.frames_to_sequence(trajectory['frames'])

    sender = OSCSender(req.profile, host=req.host, port=req.port,
                        object_offset=req.object_offset, label=req.label)
    shift = req.shift
    sender.shift = {'x': shift.get('x', 0.0),
                    'y': shift.get('y', 0.0),
                    'z': shift.get('z', 0.0)}
    task   = asyncio.create_task(
        sender.play_loop(sequence, fps=req.fps, loop=req.loop)
    )

    session_id = str(uuid.uuid4())[:8]
    modulator = Modulator(sender)
    _sessions[session_id] = {
        "sender":        sender,
        "task":          task,
        "modulator":     modulator,
        "engine":        req.engine,
        "profile":       req.profile,
        "host":          req.host,
        "port":          req.port,
        "fps":           req.fps,
        "loop":          req.loop,
        "params":        params,
        "object_offset": req.object_offset,
        "label":         req.label,
        "started_at":    datetime.now().isoformat(),
    }

    return {
        "session_id":    session_id,
        "engine":        req.engine,
        "profile":       req.profile,
        "target":        f"{req.host}:{req.port}",
        "frames":        len(sequence),
        "loop":          req.loop,
        "object_offset": req.object_offset,
        "label":         req.label,
    }


@app.post("/api/stop/{session_id}")
async def stop(session_id: str):
    """Stop a running playback session."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    s = _sessions.pop(session_id)
    if s.get("rust") and _rust_client is not None:
        await _rust_client.stop_playback_async(session_id)
    else:
        await s["modulator"].stop()
        s["sender"].stop()
        s["task"].cancel()
    return {"status": "stopped", "session_id": session_id}


@app.post("/api/stop")
async def stop_all():
    """Stop all running playback sessions."""
    stopped = []
    for sid, s in list(_sessions.items()):
        if s.get("rust") and _rust_client is not None:
            await _rust_client.stop_playback_async(sid)
        else:
            await s["modulator"].stop()
            s["sender"].stop()
            s["task"].cancel()
        stopped.append(sid)
    _sessions.clear()
    return {"status": "stopped", "sessions": stopped}


@app.patch("/api/macros/{session_id}")
async def update_macros(session_id: str, req: MacroUpdate):
    """Hot-update speed/scale/shift on a running session (no recompute)."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    sender = _sessions[session_id]["sender"]
    if req.speed      is not None: sender.speed      = req.speed
    if req.scale      is not None: sender.scale      = req.scale
    if req.shift      is not None: sender.shift      = req.shift
    if req.turbulence is not None: sender.turbulence = req.turbulence
    return {
        "session_id": session_id,
        "speed":      sender.speed,
        "scale":      sender.scale,
        "shift":      sender.shift,
        "turbulence": sender.turbulence,
    }


@app.patch("/api/params/{session_id}")
async def update_params(session_id: str, params: Dict[str, Any],
                        fade_frames: int = 0):
    """Hot-update engine params on a running session (recompiles + swaps).

    Merges new params into existing ones — only pass what changes.
    Example: PATCH /api/params/abc123?fade_frames=5
             body: {\"radius\": 0.3, \"freq_x\": 2}
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")

    s   = _sessions[session_id]
    fps = s["fps"]
    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}

    merged = dict(s.get("params", {}))
    merged.update({k: v for k, v in params.items() if k != "fps"})

    trajectory = all_engines[s["engine"]](fps=fps, **merged)
    sequence   = OSCSender.frames_to_sequence(trajectory["frames"])

    s["sender"].swap_trajectory(sequence, fps=fps, fade_frames=fade_frames)
    s["params"] = merged

    return {
        "session_id": session_id,
        "engine":     s["engine"],
        "params":     merged,
        "frames":     len(sequence),
        "fade_frames": fade_frames,
    }


@app.post("/api/resize/{session_id}")
async def resize(session_id: str, n_objects: int, fade_frames: int = 0):
    """Hot-change number of objects on a running session.

    Keeps same engine and params, only changes n_objects.
    Uses swap_trajectory internally with optional crossfade.
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    if n_objects < 1:
        raise HTTPException(400, "n_objects must be >= 1")

    s   = _sessions[session_id]
    fps = s["fps"]
    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}

    params = dict(s.get("params", {}))
    params["n_objects"] = n_objects

    trajectory = all_engines[s["engine"]](fps=fps, **params)
    sequence   = OSCSender.frames_to_sequence(trajectory["frames"])

    s["sender"].swap_trajectory(sequence, fps=fps, fade_frames=fade_frames)
    s["params"] = params

    return {
        "session_id": session_id,
        "engine":     s["engine"],
        "n_objects":  n_objects,
        "frames":     len(sequence),
        "fade_frames": fade_frames,
    }


@app.post("/api/swap/{session_id}")
async def swap(session_id: str, req: SwapRequest):
    """Hot-swap trajectory on a running session (no OSC gap).

    fade_frames=0 : immediate cut at next frame
    fade_frames>0 : linear crossfade over N frames
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")

    s   = _sessions[session_id]
    fps = s["fps"]
    all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}

    if req.engine not in all_engines:
        raise HTTPException(400, f"Unknown engine '{req.engine}'")

    params     = {k: v for k, v in req.params.items() if k != "fps"}
    trajectory = all_engines[req.engine](fps=fps, **params)
    sequence   = OSCSender.frames_to_sequence(trajectory["frames"])

    s["sender"].swap_trajectory(sequence, fps=fps, fade_frames=req.fade_frames)
    s["engine"] = req.engine

    return {
        "session_id": session_id,
        "new_engine": req.engine,
        "frames":     len(sequence),
        "fade_frames": req.fade_frames,
    }


class DrawRequest(BaseModel):
    points:      List[Dict[str, float]]   # [{x,y,z}, ...]  normalised -1..1
    duration:    Optional[float] = None   # None = auto from point count
    loop_smooth: bool            = True
    interp:      str             = 'linear'   # 'linear' | 'smooth' | 'step'
    fade_frames: int             = 8


@app.post("/api/sessions/{session_id}/draw")
async def session_draw(session_id: str, req: DrawRequest):
    """Replace trajectory on a running session with a freehand/waypoint path.

    Points are normalised [-1, 1] in XY (Z optional, defaults to 0).
    The trajectory is hot-swapped with fade — no OSC gap.
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    if len(req.points) < 2:
        raise HTTPException(400, "At least 2 points required")

    s   = _sessions[session_id]
    fps = s["fps"]
    n   = s.get("params", {}).get("n_objects", 1)

    try:
        traj = math_engine.custom_trajectory(
            points=req.points, fps=fps,
            n_objects=n, duration=req.duration,
            loop_smooth=req.loop_smooth,
            interp=req.interp,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    sequence = OSCSender.frames_to_sequence(traj["frames"])
    s["sender"].swap_trajectory(sequence, fps=fps, fade_frames=req.fade_frames)
    s["engine"] = "custom"
    s["params"]["duration"] = traj["duration"]

    return {
        "session_id": session_id,
        "points_in":  len(req.points),
        "frames":     len(sequence),
        "duration":   traj["duration"],
        "fade_frames": req.fade_frames,
    }


@app.get("/api/sessions/{session_id}/frame")
async def session_frame(session_id: str):
    """Current positions of all objects in a session (post-macro, post-offset).

    Returns: { session_id, label, objects: { osc_id: {x,y,z} } }
    Suitable for high-frequency polling (up to display fps).
    """
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    s = _sessions[session_id]
    return {
        "session_id": session_id,
        "label":      s.get("label", ""),
        "objects":    s["sender"].current_frame,
    }


@app.get("/api/sessions")
async def list_sessions():
    """List all active playback sessions."""
    return {
        "count": len(_sessions),
        "sessions": [
            {
                "id":            sid,
                "engine":        s["engine"],
                "profile":       s["profile"],
                "target":        f"{s['host']}:{s['port']}",
                "playing":       s["sender"].is_playing,
                "speed":         s["sender"].speed,
                "scale":         s["sender"].scale,
                "shift":         s["sender"].shift,
                "turbulence":    s["sender"].turbulence,
                "object_offset": s.get("object_offset", 0),
                "label":         s.get("label", ""),
                "params":        s.get("params", {}),
                "lfo_active":    s["modulator"].is_running,
                "lfo_slots":     list(s["modulator"].list().keys()),
                "started_at":    s["started_at"],
            }
            for sid, s in _sessions.items()
        ]
    }


# ── LFO endpoints ────────────────────────────────────────────────────

@app.post("/api/lfo/{session_id}")
async def add_lfo(session_id: str, req: LfoSlot):
    """Add or replace an LFO slot on a session. Starts the modulator if not running."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    s = _sessions[session_id]
    mod = s["modulator"]
    mod.add(req.target, req.wave, req.rate, req.depth, req.center, req.phase_offset)
    if not mod.is_running:
        await mod.start()
    return {"session_id": session_id, "slots": mod.list()}


@app.delete("/api/lfo/{session_id}/{target}")
async def remove_lfo(session_id: str, target: str):
    """Remove one LFO slot. Stops modulator if no slots remain."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    s = _sessions[session_id]
    mod = s["modulator"]
    mod.remove(target)
    if not mod.list() and mod.is_running:
        await mod.stop()
    return {"session_id": session_id, "slots": mod.list()}


@app.get("/api/lfo/{session_id}")
async def get_lfo(session_id: str):
    """List active LFO slots for a session."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session '{session_id}' not found")
    mod = _sessions[session_id]["modulator"]
    return {
        "session_id": session_id,
        "running":    mod.is_running,
        "slots":      mod.list(),
        "waveforms":  list(WAVEFORMS),
    }


# ── Cuelist endpoints ─────────────────────────────────────────────────────────

class CueCreate(BaseModel):
    name:         str
    groups:       List[str]
    stop_others:  bool               = True
    macros:       Dict[str, Any]     = {}
    fade_frames:  int                = 8
    note:         str                = ""
    insert_after: Optional[int]      = None

class CueUpdate(BaseModel):
    name:         Optional[str]          = None
    groups:       Optional[List[str]]    = None
    stop_others:  Optional[bool]         = None
    macros:       Optional[Dict[str, Any]] = None
    fade_frames:  Optional[int]          = None
    note:         Optional[str]          = None


@app.get("/api/cuelist")
async def get_cuelist():
    """Return full cuelist state."""
    return _cuelist.state()


@app.post("/api/cuelist/cues")
async def create_cue(req: CueCreate):
    """Append (or insert) a cue."""
    cue = _cuelist.add_cue(
        name=req.name, groups=req.groups,
        stop_others=req.stop_others, macros=req.macros,
        fade_frames=req.fade_frames, note=req.note,
        insert_after=req.insert_after,
    )
    return cue


@app.patch("/api/cuelist/cues/{cue_id}")
async def update_cue(cue_id: int, req: CueUpdate):
    """Update fields of an existing cue."""
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    cue = _cuelist.update_cue(cue_id, **data)
    if not cue:
        raise HTTPException(404, f"Cue {cue_id} not found")
    return cue


@app.delete("/api/cuelist/cues/{cue_id}")
async def delete_cue(cue_id: int):
    """Delete a cue."""
    if not _cuelist.delete_cue(cue_id):
        raise HTTPException(404, f"Cue {cue_id} not found")
    return {"deleted": cue_id}


@app.post("/api/cuelist/reorder")
async def reorder_cues(ordered_ids: List[int]):
    """Reorder cues by supplying a new list of ids."""
    return {"cues": _cuelist.reorder(ordered_ids)}


async def _execute_cue(cue: Dict[str, Any]) -> Dict[str, Any]:
    """Internal: play groups from a cue, apply macros, return session ids."""
    fade = cue.get("fade_frames", 8)
    started: List[str] = []
    swapped: List[str] = []

    # Optionally stop all running sessions first
    if cue.get("stop_others", True):
        for sid, s in list(_sessions.items()):
            await s["modulator"].stop()
            s["sender"].stop()
            s["task"].cancel()
        _sessions.clear()

    # Play each group
    for group_name in cue.get("groups", []):
        try:
            play_params = _patch.group_to_play_params(group_name)
        except KeyError:
            logger.warning("Cue %d: group '%s' not found in patch", cue["id"], group_name)
            continue

        all_engines = {**math_engine.ENGINES, **physics_engine.ENGINES}
        engine_name = play_params["engine"]
        params = {k: v for k, v in play_params["params"].items() if k != "fps"}
        fps    = play_params.get("fps", 60)

        # Check if this group already has a running session → swap instead
        existing_sid = next(
            (sid for sid, s in _sessions.items() if s.get("label") == group_name), None
        )

        if existing_sid:
            trajectory = all_engines[engine_name](fps=fps, **params)
            sequence   = OSCSender.frames_to_sequence(trajectory["frames"])
            _sessions[existing_sid]["sender"].swap_trajectory(sequence, fps=fps, fade_frames=fade)
            _sessions[existing_sid]["engine"] = engine_name
            swapped.append(existing_sid)
        else:
            trajectory = all_engines[engine_name](fps=fps, **params)
            sequence   = OSCSender.frames_to_sequence(trajectory["frames"])
            sender = OSCSender(
                play_params["profile"],
                host=play_params["host"],
                port=play_params["port"],
                object_offset=play_params["object_offset"],
                label=group_name,
            )
            shift = play_params.get("shift", {})
            sender.shift = {"x": shift.get("x", 0.0),
                            "y": shift.get("y", 0.0),
                            "z": shift.get("z", 0.0)}
            task = asyncio.create_task(
                sender.play_loop(sequence, fps=fps, loop=play_params.get("loop", True))
            )
            sid = str(uuid.uuid4())[:8]
            _sessions[sid] = {
                "sender":        sender,
                "task":          task,
                "modulator":     Modulator(sender),
                "engine":        engine_name,
                "fps":           fps,
                "started_at":    datetime.now(),
                "params":        play_params["params"],
                "object_offset": play_params["object_offset"],
                "label":         group_name,
                "profile":       play_params["profile"],
                "host":          play_params["host"],
                "port":          play_params["port"],
                "loop":          play_params.get("loop", True),
            }
            started.append(sid)

    # Apply per-cue macro overrides to all newly started sessions
    macros = cue.get("macros", {})
    if macros:
        for sid in started:
            sender = _sessions[sid]["sender"]
            if "speed"      in macros: sender.speed      = macros["speed"]
            if "scale"      in macros: sender.scale      = macros["scale"]
            if "shift"      in macros: sender.shift      = macros["shift"]
            if "turbulence" in macros: sender.turbulence = macros["turbulence"]

    return {"started": started, "swapped": swapped, "cue": cue}


@app.post("/api/cuelist/go")
async def cuelist_go():
    """Fire the next cue (GO)."""
    cue = _cuelist.go()
    if not cue:
        raise HTTPException(400, "No next cue (end of list or list empty)")
    return await _execute_cue(cue)


@app.post("/api/cuelist/back")
async def cuelist_back():
    """Re-fire the previous cue (BACK)."""
    cue = _cuelist.back()
    if not cue:
        raise HTTPException(400, "No previous cue")
    return await _execute_cue(cue)


@app.post("/api/cuelist/goto/{cue_id}")
async def cuelist_goto(cue_id: int):
    """Jump to and fire a specific cue."""
    cue = _cuelist.goto(cue_id)
    if not cue:
        raise HTTPException(404, f"Cue {cue_id} not found")
    return await _execute_cue(cue)


@app.post("/api/cuelist/reset")
async def cuelist_reset():
    """Reset current pointer to before the first cue (without stopping playback)."""
    _cuelist._current = None
    _cuelist._save_to_disk()
    return {"status": "reset", "next": _cuelist.next_cue()}


# ── WebSocket for real-time positions ────────────────────────────────────────────

@app.websocket("/ws/positions")
async def websocket_positions(websocket: WebSocket):
    """WebSocket endpoint for real-time object positions."""
    await websocket.accept()
    _ws_clients.append(websocket)
    try:
        while True:
            # Send current positions for all active sessions
            positions = {}
            try:
                for sid, s in _sessions.items():
                    sender = s.get("sender")
                    if sender and hasattr(sender, 'current_frame'):
                        frame = sender.current_frame
                        if frame:
                            positions[sid] = {
                                "label": s.get("label", ""),
                                "objects": frame
                            }
            except Exception as e:
                logger.error(f"Error getting positions: {e}")
            
            try:
                await websocket.send_json({"positions": positions, "active_sessions": len(_sessions)})
            except Exception as e:
                logger.error(f"Failed to send WebSocket message: {e}")
                break
            
            await asyncio.sleep(1/60)  # 60 FPS
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in _ws_clients:
            _ws_clients.remove(websocket)
        try:
            await websocket.close()
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
