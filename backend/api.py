from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import time
import json
from datetime import datetime

from orchestrator import orchestrate
from validator import TrajectoryValidator
import math_engine
import physics_engine

app = FastAPI(title="OSCAI API", version="2.0.0")

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


@app.get("/")
async def root():
    return {
        "name": "OSCAI API",
        "version": "2.0.0",
        "status": "running",
        "engines": {
            "math": sorted(math_engine.ENGINES.keys()),
            "physics": sorted(physics_engine.ENGINES.keys()),
        }
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
                "id": "iem_multiencoder",
                "name": "IEM MultiEncoder",
                "format": "polar",
                "default_port": 9000
            },
            {
                "id": "holophonix",
                "name": "Holophonix",
                "format": "cartesian",
                "default_port": 8000
            },
            {
                "id": "ircam_spat",
                "name": "IRCAM Spat",
                "format": "cartesian",
                "default_port": 8000
            },
            {
                "id": "generic_cartesian",
                "name": "Generic Cartesian",
                "format": "cartesian",
                "default_port": 7000
            },
            {
                "id": "generic_polar",
                "name": "Generic Polar",
                "format": "polar",
                "default_port": 7001
            }
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
