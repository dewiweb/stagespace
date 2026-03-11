"""
Graph Compiler — Port-aware, topological execution.

Architecture:
  - Each edge carries sourceHandle / targetHandle (typed port IDs).
  - The compiler traces backwards from the 'output' sink node to collect
    all needed node values, then executes engines in dependency order.
  - Port ID convention: "{in|out}-{type}[-{index}]"
    e.g. "out-objects", "in-duration", "out-trajectory"

Extensibility:
  - New node types (transform, merge, sequence…) only need an entry in
    NODE_EXECUTORS.  Each executor receives resolved port values and returns
    a dict of port_id → value.
"""

from __future__ import annotations
from typing import Any, Dict, Optional, Tuple
from collections import defaultdict
import inspect

import math_engine
import physics_engine


# ─────────────────────────────────────────────
#  Engine registry
# ─────────────────────────────────────────────

MOTION_ENGINES: Dict[str, Any] = {
    # Math
    "circular":     math_engine.circular,
    "spiral":       math_engine.spiral,
    "lissajous":    math_engine.lissajous,
    "figure8":      math_engine.figure8,
    "linear":       math_engine.linear,
    "oscillation":  math_engine.oscillation,
    "perlin_noise": math_engine.perlin_noise,
    "formation":    math_engine.formation,
    "converge":     math_engine.converge,
    "pendulum":     math_engine.pendulum,
    # Physics
    "bouncing":     physics_engine.bouncing,
    "avoidance":    physics_engine.avoidance,
    "spring":       physics_engine.spring,
    "follow":       physics_engine.follow,
    "swarm":        physics_engine.swarm,
}


# ─────────────────────────────────────────────
#  Port-value graph
# ─────────────────────────────────────────────

class PortGraph:
    """
    Wraps the raw nodes/edges list and provides:
    - lookup: node_id → node dict
    - inputs: (node_id, target_port) → (source_node_id, source_port)
    """

    def __init__(self, graph: Dict[str, Any]):
        self.nodes: Dict[str, Dict] = {n["id"]: n for n in graph["nodes"]}
        # inputs[node_id][target_port] = (source_id, source_port)
        self.inputs: Dict[str, Dict[str, Tuple[str, str]]] = defaultdict(dict)

        for e in graph.get("edges", []):
            src, tgt = e["source"], e["target"]
            sh = e.get("sourceHandle") or "out-any"
            th = e.get("targetHandle") or "in-any"
            self.inputs[tgt][th] = (src, sh)

    def get_input(self, node_id: str, target_port: str) -> Optional[Tuple[str, str]]:
        """Return (source_node_id, source_handle) or None."""
        return self.inputs.get(node_id, {}).get(target_port)

    def node_type(self, node_id: str) -> str:
        return self.nodes[node_id].get("type", "")

    def node_data(self, node_id: str) -> Dict:
        return self.nodes[node_id].get("data", {})


# ─────────────────────────────────────────────
#  Node executors
# ─────────────────────────────────────────────

def _exec_objects(pg: PortGraph, node_id: str, _cache: Dict) -> Dict[str, Any]:
    data = pg.node_data(node_id)
    return {"out-objects": int(data.get("count", 4))}


def _exec_duration(pg: PortGraph, node_id: str, _cache: Dict) -> Dict[str, Any]:
    data = pg.node_data(node_id)
    return {"out-duration": float(data.get("seconds", 10.0))}


def _exec_motion(pg: PortGraph, node_id: str, cache: Dict) -> Dict[str, Any]:
    """Generic executor for all motion-engine nodes."""
    ntype = pg.node_type(node_id)
    fn    = MOTION_ENGINES[ntype]
    data  = pg.node_data(node_id)

    # Resolve n_objects from in-objects port
    n_objects = 4
    src = pg.get_input(node_id, "in-objects")
    if src:
        vals = _eval_node(pg, src[0], cache)
        n_objects = int(vals.get(src[1], 4))

    # Resolve duration from in-duration port
    duration = 10.0
    src = pg.get_input(node_id, "in-duration")
    if src:
        vals = _eval_node(pg, src[0], cache)
        duration = float(vals.get(src[1], 10.0))

    # Build params: data keys are already snake_case matching engine signatures
    sig        = inspect.signature(fn)
    valid_keys = set(sig.parameters.keys())

    params: Dict[str, Any] = {}
    for k, v in data.items():
        if k in valid_keys:
            # Cast to the right type based on default annotation
            anno = sig.parameters[k].default
            try:
                if isinstance(anno, bool):
                    params[k] = bool(v)
                elif isinstance(anno, int):
                    params[k] = int(float(v))
                elif isinstance(anno, float):
                    params[k] = float(v)
                elif isinstance(anno, str):
                    params[k] = str(v)
                else:
                    params[k] = v
            except (TypeError, ValueError):
                params[k] = v

    # Inject resolved n_objects / duration (override data if connected)
    if "n_objects" in valid_keys:
        params["n_objects"] = n_objects
    if "duration" in valid_keys:
        params["duration"] = duration

    trajectory = fn(**params)
    return {"out-trajectory": trajectory, "_engine": ntype}


def _exec_output(pg: PortGraph, node_id: str, cache: Dict) -> Dict[str, Any]:
    """Output/sink node — resolves the connected trajectory."""
    src = pg.get_input(node_id, "in-trajectory")
    if not src:
        raise ValueError("Output node has no trajectory input connected.")
    vals = _eval_node(pg, src[0], cache)
    return {"out-result": vals.get(src[1]), "_engine": vals.get("_engine", "unknown")}


def _exec_mix(pg: PortGraph, node_id: str, cache: Dict) -> Dict[str, Any]:
    """
    Mix node — interpolate positions of two same-n_objects trajectories.

    pos_i = (1 - blend) * A_pos_i + blend * B_pos_i

    Both inputs must have the same n_objects.
    Output has the same n_objects — no duplication.
    Duration = min(A, B).
    """
    src_a = pg.get_input(node_id, "in-trajectory-0")
    src_b = pg.get_input(node_id, "in-trajectory-1")

    if not src_a or not src_b:
        raise ValueError("Mix node requires both A and B trajectory inputs to be connected.")

    vals_a = _eval_node(pg, src_a[0], cache)
    vals_b = _eval_node(pg, src_b[0], cache)
    traj_a = vals_a.get(src_a[1])
    traj_b = vals_b.get(src_b[1])

    if traj_a is None or traj_b is None:
        raise ValueError("Mix node: one or both trajectory inputs did not resolve.")

    frames_a: list = traj_a["frames"]
    frames_b: list = traj_b["frames"]
    n_obj_a = len(frames_a)
    n_obj_b = len(frames_b)

    if n_obj_a != n_obj_b:
        raise ValueError(
            f"Mix node: object count mismatch — A has {n_obj_a}, B has {n_obj_b}. "
            "Both must have the same number of objects. "
            "Use Group instead to combine objects from two different sources."
        )

    blend    = float(pg.node_data(node_id).get("blend", 0.5))
    inv_b    = 1.0 - blend
    n_frames = min(len(frames_a[0]), len(frames_b[0]))

    mixed = []
    for obj_i in range(n_obj_a):
        obj_frames = []
        fa = frames_a[obj_i]
        fb = frames_b[obj_i]
        for f in range(n_frames):
            x = inv_b * fa[f][0] + blend * fb[f][0]
            y = inv_b * fa[f][1] + blend * fb[f][1]
            z = inv_b * fa[f][2] + blend * fb[f][2]
            obj_frames.append([x, y, z])
        mixed.append(obj_frames)

    fps      = traj_a.get("fps", 30)
    duration = n_frames / fps
    engine_a = vals_a.get("_engine", "?")
    engine_b = vals_b.get("_engine", "?")

    trajectory = {
        "frames":   mixed,
        "fps":      fps,
        "duration": duration,
        "objects":  list(range(n_obj_a)),
        "_metadata": {
            "engine":    f"mix({engine_a},{engine_b})",
            "n_objects": n_obj_a,
            "n_frames":  n_frames,
            "description": (
                f"Mix {engine_a} + {engine_b}, "
                f"{n_obj_a} obj, blend={blend:.2f}"
            ),
        },
    }
    return {
        "out-trajectory": trajectory,
        "_engine": f"mix({engine_a},{engine_b})",
    }


def _exec_group(pg: PortGraph, node_id: str, cache: Dict) -> Dict[str, Any]:
    """
    Group node — combine two trajectories by merging objects simultaneously.

    Objects 0…n_A-1 follow motion A.
    Objects n_A…n_A+n_B-1 follow motion B.
    Duration = min(A.duration, B.duration).
    n_frames = min(A.n_frames, B.n_frames).
    """
    import numpy as np

    src_a = pg.get_input(node_id, "in-trajectory-0")
    src_b = pg.get_input(node_id, "in-trajectory-1")

    if not src_a or not src_b:
        raise ValueError(
            "Group node requires both A and B trajectory inputs to be connected."
        )

    vals_a = _eval_node(pg, src_a[0], cache)
    vals_b = _eval_node(pg, src_b[0], cache)
    traj_a = vals_a.get(src_a[1])
    traj_b = vals_b.get(src_b[1])

    if traj_a is None or traj_b is None:
        raise ValueError("Group node: one or both trajectory inputs did not resolve.")

    frames_a: list = traj_a["frames"]   # [n_obj_a][n_frames_a][3]
    frames_b: list = traj_b["frames"]   # [n_obj_b][n_frames_b][3]
    n_frames = min(len(frames_a[0]), len(frames_b[0]))

    # Trim both to same frame count and concatenate object lists
    combined = [obj[:n_frames] for obj in frames_a] + [obj[:n_frames] for obj in frames_b]

    n_objects = len(combined)
    fps       = traj_a.get("fps", 30)
    duration  = n_frames / fps
    engine_a  = vals_a.get("_engine", "?")
    engine_b  = vals_b.get("_engine", "?")

    trajectory = {
        "frames":   combined,
        "fps":      fps,
        "duration": duration,
        "objects":  list(range(n_objects)),
        "_metadata": {
            "engine":    f"group({engine_a}+{engine_b})",
            "n_objects": n_objects,
            "n_frames":  n_frames,
            "description": f"Group: {engine_a} × {len(frames_a)} obj + {engine_b} × {len(frames_b)} obj",
        },
    }
    return {
        "out-trajectory": trajectory,
        "_engine": f"group({engine_a}+{engine_b})",
    }


def _exec_sequence(pg: PortGraph, node_id: str, cache: Dict) -> Dict[str, Any]:
    """
    Sequence node — run First trajectory then Then trajectory back-to-back.

    Both inputs must have the same object count.
    Total duration = First.duration + Then.duration.
    """
    src_first = pg.get_input(node_id, "in-trajectory-0")
    src_then  = pg.get_input(node_id, "in-trajectory-1")

    if not src_first or not src_then:
        raise ValueError(
            "Sequence node requires both First and Then trajectory inputs to be connected."
        )

    vals_first = _eval_node(pg, src_first[0], cache)
    vals_then  = _eval_node(pg, src_then[0],  cache)
    traj_first = vals_first.get(src_first[1])
    traj_then  = vals_then.get(src_then[1])

    if traj_first is None or traj_then is None:
        raise ValueError("Sequence node: one or both trajectory inputs did not resolve.")

    frames_first: list = traj_first["frames"]  # [n_obj][n_f1][3]
    frames_then:  list = traj_then["frames"]   # [n_obj][n_f2][3]

    n_obj_first = len(frames_first)
    n_obj_then  = len(frames_then)
    if n_obj_first != n_obj_then:
        raise ValueError(
            f"Sequence node: object count mismatch — First has {n_obj_first} objects, "
            f"Then has {n_obj_then}. Both must match."
        )

    # Concatenate frames for each object
    combined = [frames_first[i] + frames_then[i] for i in range(n_obj_first)]

    n_frames = len(combined[0])
    fps      = traj_first.get("fps", 30)
    duration = n_frames / fps
    engine_a = vals_first.get("_engine", "?")
    engine_b = vals_then.get("_engine",  "?")

    trajectory = {
        "frames":   combined,
        "fps":      fps,
        "duration": duration,
        "objects":  list(range(n_obj_first)),
        "_metadata": {
            "engine":    f"sequence({engine_a}→{engine_b})",
            "n_objects": n_obj_first,
            "n_frames":  n_frames,
            "description": f"Sequence: {engine_a} then {engine_b}, {n_obj_first} objects",
        },
    }
    return {
        "out-trajectory": trajectory,
        "_engine": f"sequence({engine_a}→{engine_b})",
    }


# Registry
NODE_EXECUTORS = {
    "objects":  _exec_objects,
    "duration": _exec_duration,
    "output":   _exec_output,
    "mix":      _exec_mix,
    "group":    _exec_group,
    "sequence": _exec_sequence,
    **{k: _exec_motion for k in MOTION_ENGINES},
}


# ─────────────────────────────────────────────
#  Memoised eval
# ─────────────────────────────────────────────

def _eval_node(pg: PortGraph, node_id: str, cache: Dict[str, Dict]) -> Dict[str, Any]:
    """Evaluate node_id, caching results to avoid re-computation."""
    if node_id in cache:
        return cache[node_id]

    ntype = pg.node_type(node_id)
    exec_fn = NODE_EXECUTORS.get(ntype)
    if exec_fn is None:
        # Unknown node — pass through as identity
        cache[node_id] = {}
        return {}

    result = exec_fn(pg, node_id, cache)
    cache[node_id] = result
    return result


# ─────────────────────────────────────────────
#  Fallback: legacy flat-graph traversal
# ─────────────────────────────────────────────

def _fallback_compile(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Used when the graph has no 'output' node (legacy flat graphs).
    Merges all node params and calls the first motion engine found.
    """
    nodes = graph["nodes"]
    merged: Dict[str, Any] = {}
    motion_type: Optional[str] = None

    for node in nodes:
        ntype = node.get("type", "")
        data  = node.get("data", {})
        if ntype == "objects":
            merged["n_objects"] = int(data.get("count", 4))
        elif ntype == "duration":
            merged["duration"] = float(data.get("seconds", 10.0))
        elif ntype in MOTION_ENGINES:
            motion_type = ntype
            merged.update({k: v for k, v in data.items()})

    if motion_type is None:
        raise ValueError(
            "Graph contains no recognised motion node. "
            f"Available: {sorted(MOTION_ENGINES.keys())}"
        )

    fn         = MOTION_ENGINES[motion_type]
    sig        = inspect.signature(fn)
    valid_keys = set(sig.parameters.keys())
    params     = {k: v for k, v in merged.items() if k in valid_keys}
    trajectory = fn(**params)
    return {"trajectory": trajectory, "engine": motion_type}


# ─────────────────────────────────────────────
#  GraphCompiler
# ─────────────────────────────────────────────

class GraphCompiler:
    """
    Compile a React Flow graph into a trajectory.

    Port-aware execution:
      1. Find the 'output' sink node.
      2. Evaluate it — which recursively evaluates upstream nodes.
      3. Return the resolved trajectory.

    Falls back to legacy flat-scan if no output node exists.
    """

    def compile(self, graph: Dict[str, Any]) -> Dict[str, Any]:
        nodes_list = graph.get("nodes", [])

        # Check for output node
        output_node = next(
            (n for n in nodes_list if n.get("type") == "output"), None
        )

        if output_node is None:
            # Legacy / no output node — use flat fallback
            return _fallback_compile(graph)

        pg    = PortGraph(graph)
        cache: Dict[str, Dict] = {}
        result = _eval_node(pg, output_node["id"], cache)

        trajectory = result.get("out-result")
        if trajectory is None:
            raise ValueError(
                "Output node did not produce a trajectory. "
                "Make sure a motion node's Trajectory port is connected to Output."
            )

        engine_name = result.get("_engine", "unknown")
        return {"trajectory": trajectory, "engine": engine_name}


# ─────────────────────────────────────────────
#  Test
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import time

    compiler = GraphCompiler()

    # Port-aware tests (new format)
    port_cases = [
        ("Circular 4 obj [port]", {
            "nodes": [
                {"id": "obj", "type": "objects",  "data": {"count": 4}},
                {"id": "dur", "type": "duration", "data": {"seconds": 10}},
                {"id": "mov", "type": "circular", "data": {"radius": 1.0, "speed": 1.0}},
                {"id": "out", "type": "output",   "data": {}},
            ],
            "edges": [
                {"source": "obj", "sourceHandle": "out-objects",    "target": "mov", "targetHandle": "in-objects"},
                {"source": "dur", "sourceHandle": "out-duration",   "target": "mov", "targetHandle": "in-duration"},
                {"source": "mov", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
            ],
        }),
        ("Swarm 8 boids [port]", {
            "nodes": [
                {"id": "obj", "type": "objects",  "data": {"count": 8}},
                {"id": "dur", "type": "duration", "data": {"seconds": 8}},
                {"id": "mov", "type": "swarm",    "data": {"cohesion": 0.5, "separation": 1.5, "speed": 0.4}},
                {"id": "out", "type": "output",   "data": {}},
            ],
            "edges": [
                {"source": "obj", "sourceHandle": "out-objects",    "target": "mov", "targetHandle": "in-objects"},
                {"source": "dur", "sourceHandle": "out-duration",   "target": "mov", "targetHandle": "in-duration"},
                {"source": "mov", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
            ],
        }),
    ]

    print("=== Graph Compiler Tests (port-aware) ===\n")
    for label, graph in port_cases:
        t0 = time.perf_counter()
        res = compiler.compile(graph)
        ms  = (time.perf_counter() - t0) * 1000
        md  = res["trajectory"]["_metadata"]
        print(f"  {label:35s}  {ms:6.1f}ms  "
              f"{md['n_objects']} obj  {md['n_frames']} frames  "
              f"engine={res['engine']}")

    # Legacy (no output node)
    print("\n=== Legacy flat-graph fallback ===\n")
    legacy = {
        "nodes": [
            {"id": "a", "type": "objects",  "data": {"count": 6}},
            {"id": "b", "type": "bouncing", "data": {"restitution": 0.7, "gravity": 9.8}},
            {"id": "c", "type": "duration", "data": {"seconds": 8}},
        ],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}],
    }
    t0  = time.perf_counter()
    res = compiler.compile(legacy)
    ms  = (time.perf_counter() - t0) * 1000
    md  = res["trajectory"]["_metadata"]
    print(f"  bouncing 6 obj (legacy)  {ms:6.1f}ms  "
          f"{md['n_objects']} obj  {md['n_frames']} frames  engine={res['engine']}")
