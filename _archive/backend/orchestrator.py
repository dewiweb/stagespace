"""
GraphOrchestrator — pre-flight validation + safe compilation entry point.

Validation pipeline (runs BEFORE any engine is called):
  1. STRUCTURE    — dangling edges, unknown node types
  2. OUTPUT       — zero outputs (error), multiple outputs (warning)
  3. CYCLE        — DFS with GRAY/BLACK coloring on the reachable subgraph
  4. CONNECTIVITY — required ports missing for mix / group / sequence / output
  5. COMPAT       — static object-count trace to catch Mix/Sequence mismatches
  6. ORPHANS      — warn about subgraphs not reachable from any output
  7. PERFORMANCE  — warn when estimated trajectory size exceeds thresholds

All issues are collected in one pass — the user gets every problem at once,
not just the first one that crashes the compiler.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Set, Tuple

from graph_compiler import GraphCompiler, MOTION_ENGINES, PortGraph

# ─── Issue types ──────────────────────────────────────────────────────────────

IssueLevel = Literal["error", "warning", "info"]

# Required dual-trajectory ports per node type
_DUAL_TRAJ_NODES = {
    "mix":      ("in-trajectory-0", "in-trajectory-1"),
    "group":    ("in-trajectory-0", "in-trajectory-1"),
    "sequence": ("in-trajectory-0", "in-trajectory-1"),
}

# Default fps used by all engines
_DEFAULT_FPS = 30
# Warn if estimated n_objects × n_frames exceeds this
_PERF_WARN_POINTS  = 50_000     # light yellow
_PERF_ERROR_POINTS = 500_000    # likely to stall browser


@dataclass
class GraphIssue:
    level:   IssueLevel
    code:    str
    message: str
    node_id: Optional[str] = None

    def __str__(self) -> str:
        loc = f" [{self.node_id}]" if self.node_id else ""
        return f"{self.level.upper()}{loc}: {self.message}"


@dataclass
class OrchestrateResult:
    success:    bool
    trajectory: Optional[Dict[str, Any]] = None
    engine:     str = "unknown"
    issues:     List[GraphIssue] = field(default_factory=list)
    compile_ms: float = 0.0

    @property
    def errors(self)    -> List[GraphIssue]: return [i for i in self.issues if i.level == "error"]
    @property
    def warnings(self)  -> List[GraphIssue]: return [i for i in self.issues if i.level == "warning"]
    @property
    def infos(self)     -> List[GraphIssue]: return [i for i in self.issues if i.level == "info"]

    def to_dict(self) -> Dict[str, Any]:
        base: Dict[str, Any] = {
            "success":    self.success,
            "issues": [
                {"level": i.level, "code": i.code, "message": i.message,
                 **({"node_id": i.node_id} if i.node_id else {})}
                for i in self.issues
            ],
            "compile_ms": round(self.compile_ms, 2),
        }
        if self.success and self.trajectory:
            base["trajectory"] = self.trajectory
            base["engine"]     = self.engine
        return base


# ─── Orchestrator ─────────────────────────────────────────────────────────────

class GraphOrchestrator:
    """
    Safe entry point for graph compilation.

    Usage:
        result = GraphOrchestrator().orchestrate(graph_dict)
        if result.success:
            send_to_visualizer(result.trajectory)
        else:
            show_errors(result.errors)
    """

    def orchestrate(self, graph: Dict[str, Any]) -> OrchestrateResult:
        import time
        issues: List[GraphIssue] = []

        nodes  = graph.get("nodes", [])
        edges  = graph.get("edges", [])

        # ── 1. Empty graph ────────────────────────────────────────────────────
        if not nodes:
            issues.append(GraphIssue("error", "EMPTY_GRAPH",
                "Graph has no nodes. Add at least Objects → MotionNode → Output."))
            return OrchestrateResult(False, issues=issues)

        node_map: Dict[str, Dict] = {n["id"]: n for n in nodes}

        # ── 2. Structure: dangling edges, unknown types ───────────────────────
        self._check_structure(node_map, edges, issues)

        # ── 3. Output node(s) ─────────────────────────────────────────────────
        output_nodes = [n for n in nodes if n.get("type") == "output"]
        if not output_nodes:
            issues.append(GraphIssue("error", "NO_OUTPUT",
                "No Output node found. Drag one from the palette and connect it."))
            # Still run structure issues, but cannot continue
            return OrchestrateResult(False, issues=issues)

        if len(output_nodes) > 1:
            ids = ", ".join(n["id"] for n in output_nodes)
            issues.append(GraphIssue("warning", "MULTI_OUTPUT",
                f"Multiple Output nodes found ({ids}). Only the first will be compiled.",
                node_id=output_nodes[0]["id"]))

        output_node = output_nodes[0]
        pg = PortGraph(graph)

        # ── 4. Cycle detection (DFS from output, tracing upstream) ────────────
        cycle_path = self._detect_cycle(pg, output_node["id"], node_map)
        if cycle_path:
            issues.append(GraphIssue("error", "CYCLE_DETECTED",
                f"Cycle detected in graph: {' → '.join(cycle_path)}. "
                "Cycles cause infinite recursion and cannot be compiled."))
            return OrchestrateResult(False, issues=issues)

        # ── 5. Required port connectivity ─────────────────────────────────────
        reachable = self._reachable_nodes(pg, output_node["id"])
        self._check_connectivity(pg, reachable, node_map, issues)

        # Stop here if connectivity errors — static count check would give
        # misleading secondary errors
        if any(i.level == "error" for i in issues):
            return OrchestrateResult(False, issues=issues)

        # ── 6. Static object-count compatibility (Mix, Sequence) ──────────────
        self._check_object_counts(pg, output_node["id"], node_map, issues)

        # ── 7. Orphaned islands ───────────────────────────────────────────────
        all_ids = set(node_map.keys())
        orphans = all_ids - reachable
        if orphans:
            issues.append(GraphIssue("info", "ORPHANED_NODES",
                f"{len(orphans)} node(s) not connected to Output and will be ignored: "
                f"{', '.join(sorted(orphans))}"))

        # ── 8. Performance estimate ───────────────────────────────────────────
        self._check_performance(pg, output_node["id"], node_map, issues)

        # ── 9. Abort if errors ────────────────────────────────────────────────
        if any(i.level == "error" for i in issues):
            return OrchestrateResult(False, issues=issues)

        # ── 10. Compile ───────────────────────────────────────────────────────
        t0 = time.perf_counter()
        try:
            result = GraphCompiler().compile(graph)
        except Exception as exc:
            issues.append(GraphIssue("error", "COMPILE_ERROR", str(exc)))
            return OrchestrateResult(False, issues=issues)
        compile_ms = (time.perf_counter() - t0) * 1000

        return OrchestrateResult(
            success=True,
            trajectory=result["trajectory"],
            engine=result.get("engine", "unknown"),
            issues=issues,
            compile_ms=compile_ms,
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _check_structure(
        self,
        node_map: Dict[str, Dict],
        edges:    List[Dict],
        issues:   List[GraphIssue],
    ) -> None:
        """Dangling edge endpoints + unknown node types."""
        known_types = set(MOTION_ENGINES.keys()) | {
            "objects", "duration", "output", "mix", "group", "sequence",
        }
        for node in node_map.values():
            ntype = node.get("type", "")
            if ntype not in known_types:
                issues.append(GraphIssue("error", "UNKNOWN_NODE_TYPE",
                    f"Unknown node type '{ntype}'. "
                    f"Known types: {sorted(known_types)}",
                    node_id=node["id"]))

        for e in edges:
            src, tgt = e.get("source"), e.get("target")
            if src and src not in node_map:
                issues.append(GraphIssue("error", "DANGLING_EDGE",
                    f"Edge source '{src}' references a non-existent node."))
            if tgt and tgt not in node_map:
                issues.append(GraphIssue("error", "DANGLING_EDGE",
                    f"Edge target '{tgt}' references a non-existent node."))

    def _detect_cycle(
        self,
        pg:       PortGraph,
        start:    str,
        node_map: Dict[str, Dict],
    ) -> List[str]:
        """
        DFS from `start` following upstream edges.
        Returns the cycle path (list of node IDs) if one is found, else [].
        Uses GRAY/BLACK coloring: GRAY = currently on the DFS stack.
        """
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {}
        parent: Dict[str, Optional[str]] = {}

        def dfs(nid: str) -> Optional[List[str]]:
            color[nid] = GRAY
            for _port, (src_id, _src_port) in pg.inputs.get(nid, {}).items():
                if src_id not in node_map:
                    continue
                if color.get(src_id) == GRAY:
                    # Reconstruct cycle path
                    path = [src_id, nid]
                    cur = nid
                    while parent.get(cur) and parent[cur] != src_id:
                        cur = parent[cur]  # type: ignore[assignment]
                        path.insert(0, cur)
                    path.insert(0, src_id)
                    return path
                if color.get(src_id, WHITE) == WHITE:
                    parent[src_id] = nid
                    result = dfs(src_id)
                    if result:
                        return result
            color[nid] = BLACK
            return None

        return dfs(start) or []

    def _reachable_nodes(self, pg: PortGraph, start: str) -> Set[str]:
        """BFS/DFS upstream from start — collect all node IDs in the path."""
        visited: Set[str] = set()
        stack = [start]
        while stack:
            nid = stack.pop()
            if nid in visited:
                continue
            visited.add(nid)
            for _port, (src_id, _) in pg.inputs.get(nid, {}).items():
                if src_id not in visited:
                    stack.append(src_id)
        return visited

    def _check_connectivity(
        self,
        pg:       PortGraph,
        reachable: Set[str],
        node_map: Dict[str, Dict],
        issues:   List[GraphIssue],
    ) -> None:
        """
        For each reachable node, check that mandatory ports are connected.
        Motion nodes: in-objects and in-duration are optional (have defaults — just warn).
        Mix / Group / Sequence: both in-trajectory-X ports are mandatory (error).
        Output: in-trajectory is mandatory (error).
        """
        for nid in reachable:
            ntype = node_map[nid].get("type", "")

            if ntype == "output":
                if not pg.get_input(nid, "in-trajectory"):
                    issues.append(GraphIssue("error", "MISSING_PORT",
                        "Output node has no Trajectory input connected. "
                        "Connect a motion engine's output to it.",
                        node_id=nid))

            elif ntype in _DUAL_TRAJ_NODES:
                p0, p1 = _DUAL_TRAJ_NODES[ntype]
                if not pg.get_input(nid, p0):
                    issues.append(GraphIssue("error", "MISSING_PORT",
                        f"{ntype.capitalize()} node: input A ('{p0}') is not connected.",
                        node_id=nid))
                if not pg.get_input(nid, p1):
                    issues.append(GraphIssue("error", "MISSING_PORT",
                        f"{ntype.capitalize()} node: input B ('{p1}') is not connected.",
                        node_id=nid))

            elif ntype in MOTION_ENGINES:
                if not pg.get_input(nid, "in-objects"):
                    data = node_map[nid].get("data", {})
                    n = int(data.get("count", data.get("n_objects", 4)))
                    issues.append(GraphIssue("warning", "IMPLICIT_DEFAULT",
                        f"Motion node '{ntype}' has no Objects input — "
                        f"defaulting to {n} objects.",
                        node_id=nid))
                if not pg.get_input(nid, "in-duration"):
                    data = node_map[nid].get("data", {})
                    s = float(data.get("seconds", data.get("duration", 10.0)))
                    issues.append(GraphIssue("warning", "IMPLICIT_DEFAULT",
                        f"Motion node '{ntype}' has no Duration input — "
                        f"defaulting to {s}s.",
                        node_id=nid))

    def _static_object_count(
        self,
        pg:       PortGraph,
        node_id:  str,
        node_map: Dict[str, Dict],
        cache:    Dict[str, Optional[int]],
        issues:   List[GraphIssue],
    ) -> Optional[int]:
        """
        Lightweight dry-run that traces only n_objects through the graph.
        Returns None if count cannot be determined statically.
        """
        if node_id in cache:
            return cache[node_id]

        # Sentinel to detect re-entrancy (shouldn't happen after cycle check)
        cache[node_id] = None
        ntype = node_map[node_id].get("type", "")

        if ntype == "objects":
            count = int(node_map[node_id].get("data", {}).get("count", 4))
            cache[node_id] = count
            return count

        if ntype == "duration":
            cache[node_id] = None
            return None

        if ntype in MOTION_ENGINES:
            src = pg.get_input(node_id, "in-objects")
            if src:
                count = self._static_object_count(pg, src[0], node_map, cache, issues)
                cache[node_id] = count
                return count
            # No input — use default from data
            count = int(node_map[node_id].get("data", {}).get("n_objects", 4))
            cache[node_id] = count
            return count

        if ntype == "group":
            src_a = pg.get_input(node_id, "in-trajectory-0")
            src_b = pg.get_input(node_id, "in-trajectory-1")
            if src_a and src_b:
                a = self._static_object_count(pg, src_a[0], node_map, cache, issues)
                b = self._static_object_count(pg, src_b[0], node_map, cache, issues)
                if a is not None and b is not None:
                    cache[node_id] = a + b
                    return a + b
            cache[node_id] = None
            return None

        if ntype in ("mix", "sequence"):
            src_a = pg.get_input(node_id, "in-trajectory-0")
            src_b = pg.get_input(node_id, "in-trajectory-1")
            if src_a and src_b:
                a = self._static_object_count(pg, src_a[0], node_map, cache, issues)
                b = self._static_object_count(pg, src_b[0], node_map, cache, issues)
                if a is not None and b is not None and a != b:
                    issues.append(GraphIssue("error", "OBJECT_COUNT_MISMATCH",
                        f"{ntype.capitalize()} node requires both inputs to have "
                        f"the same object count (A={a}, B={b}). "
                        "Adjust your Objects nodes or use a Group node instead.",
                        node_id=node_id))
                result = a if (a is not None and (b is None or a == b)) else b
                cache[node_id] = result
                return result
            cache[node_id] = None
            return None

        if ntype == "output":
            src = pg.get_input(node_id, "in-trajectory")
            if src:
                count = self._static_object_count(pg, src[0], node_map, cache, issues)
                cache[node_id] = count
                return count

        cache[node_id] = None
        return None

    def _check_object_counts(
        self,
        pg:       PortGraph,
        output_id: str,
        node_map: Dict[str, Dict],
        issues:   List[GraphIssue],
    ) -> Optional[int]:
        cache: Dict[str, Optional[int]] = {}
        return self._static_object_count(pg, output_id, node_map, cache, issues)

    def _static_duration(
        self,
        pg:       PortGraph,
        node_id:  str,
        node_map: Dict[str, Dict],
        cache:    Dict[str, Optional[float]],
    ) -> Optional[float]:
        """Trace total output duration (seconds) for performance estimation."""
        if node_id in cache:
            return cache[node_id]
        cache[node_id] = None
        ntype = node_map[node_id].get("type", "")

        if ntype == "duration":
            val = float(node_map[node_id].get("data", {}).get("seconds", 10.0))
            cache[node_id] = val
            return val

        if ntype in MOTION_ENGINES:
            src = pg.get_input(node_id, "in-duration")
            if src:
                val = self._static_duration(pg, src[0], node_map, cache)
                cache[node_id] = val
                return val
            val = float(node_map[node_id].get("data", {}).get("duration", 10.0))
            cache[node_id] = val
            return val

        if ntype in ("mix", "group"):
            src_a = pg.get_input(node_id, "in-trajectory-0")
            if src_a:
                val = self._static_duration(pg, src_a[0], node_map, cache)
                cache[node_id] = val
                return val

        if ntype == "sequence":
            src_a = pg.get_input(node_id, "in-trajectory-0")
            src_b = pg.get_input(node_id, "in-trajectory-1")
            da = self._static_duration(pg, src_a[0], node_map, cache) if src_a else None
            db = self._static_duration(pg, src_b[0], node_map, cache) if src_b else None
            if da is not None and db is not None:
                total = da + db
                cache[node_id] = total
                return total

        if ntype == "output":
            src = pg.get_input(node_id, "in-trajectory")
            if src:
                val = self._static_duration(pg, src[0], node_map, cache)
                cache[node_id] = val
                return val

        cache[node_id] = None
        return None

    def _check_performance(
        self,
        pg:        PortGraph,
        output_id: str,
        node_map:  Dict[str, Dict],
        issues:    List[GraphIssue],
    ) -> None:
        n_objects = self._check_object_counts(pg, output_id, node_map, [])  # no-op issues
        duration  = self._static_duration(pg, output_id, node_map, {})
        if n_objects is None or duration is None:
            return
        n_frames = int(duration * _DEFAULT_FPS)
        points   = n_objects * n_frames
        if points > _PERF_ERROR_POINTS:
            issues.append(GraphIssue("warning", "PERFORMANCE_HEAVY",
                f"Estimated trajectory: {n_objects} objects × {n_frames} frames "
                f"= {points:,} data points. This may be slow to compile and "
                "freeze the visualizer. Consider reducing objects or duration."))
        elif points > _PERF_WARN_POINTS:
            issues.append(GraphIssue("info", "PERFORMANCE_NOTICE",
                f"Estimated trajectory: {n_objects} objects × {n_frames} frames "
                f"= {points:,} data points."))


# ─── Convenience singleton ────────────────────────────────────────────────────

_orchestrator = GraphOrchestrator()

def orchestrate(graph: Dict[str, Any]) -> OrchestrateResult:
    """Module-level shorthand used by api.py."""
    return _orchestrator.orchestrate(graph)


# ─── Self-tests ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from pprint import pprint

    def _run(label: str, graph: dict) -> None:
        result = orchestrate(graph)
        status = "OK " if result.success else "ERR"
        md = result.trajectory["_metadata"] if result.success else {}
        print(f"\n[{status}] {label}")
        if result.success:
            print(f"      → {md['engine']}  {md['n_objects']} obj  "
                  f"{md['n_frames']} frames  {result.compile_ms:.1f}ms")
        for i in result.issues:
            print(f"      {str(i)}")

    # ── 1. Normal linear graph ────────────────────────────────────────────────
    _run("Normal: circular", {
        "nodes": [
            {"id": "obj", "type": "objects",  "data": {"count": 6}},
            {"id": "dur", "type": "duration", "data": {"seconds": 5}},
            {"id": "mov", "type": "circular", "data": {"radius": 1.2}},
            {"id": "out", "type": "output",   "data": {}},
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects",    "target": "mov", "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "mov", "targetHandle": "in-duration"},
            {"source": "mov", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 2. Mix (valid) ────────────────────────────────────────────────────────
    _run("Mix valid: lissajous + figure8, 10 obj", {
        "nodes": [
            {"id": "obj", "type": "objects",   "data": {"count": 10}},
            {"id": "dur", "type": "duration",  "data": {"seconds": 8}},
            {"id": "ma",  "type": "lissajous", "data": {}},
            {"id": "mb",  "type": "figure8",   "data": {}},
            {"id": "mix", "type": "mix",        "data": {"blend": 0.3}},
            {"id": "out", "type": "output",     "data": {}},
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects",    "target": "ma",  "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "ma",  "targetHandle": "in-duration"},
            {"source": "obj", "sourceHandle": "out-objects",    "target": "mb",  "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "mb",  "targetHandle": "in-duration"},
            {"source": "ma",  "sourceHandle": "out-trajectory", "target": "mix", "targetHandle": "in-trajectory-0"},
            {"source": "mb",  "sourceHandle": "out-trajectory", "target": "mix", "targetHandle": "in-trajectory-1"},
            {"source": "mix", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 3. Mix with object count mismatch ─────────────────────────────────────
    _run("Mix MISMATCH: 6 obj vs 10 obj (should error)", {
        "nodes": [
            {"id": "o1",  "type": "objects",   "data": {"count": 6}},
            {"id": "o2",  "type": "objects",   "data": {"count": 10}},
            {"id": "dur", "type": "duration",  "data": {"seconds": 5}},
            {"id": "ma",  "type": "circular",  "data": {}},
            {"id": "mb",  "type": "spiral",    "data": {}},
            {"id": "mix", "type": "mix",        "data": {"blend": 0.5}},
            {"id": "out", "type": "output",     "data": {}},
        ],
        "edges": [
            {"source": "o1",  "sourceHandle": "out-objects",    "target": "ma",  "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "ma",  "targetHandle": "in-duration"},
            {"source": "o2",  "sourceHandle": "out-objects",    "target": "mb",  "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "mb",  "targetHandle": "in-duration"},
            {"source": "ma",  "sourceHandle": "out-trajectory", "target": "mix", "targetHandle": "in-trajectory-0"},
            {"source": "mb",  "sourceHandle": "out-trajectory", "target": "mix", "targetHandle": "in-trajectory-1"},
            {"source": "mix", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 4. Missing Output node ────────────────────────────────────────────────
    _run("No Output node (should error)", {
        "nodes": [
            {"id": "obj", "type": "objects",  "data": {"count": 4}},
            {"id": "mov", "type": "circular", "data": {}},
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects", "target": "mov", "targetHandle": "in-objects"},
        ],
    })

    # ── 5. Cycle detection ────────────────────────────────────────────────────
    # Artificial cycle by injecting edge that creates a loop
    # (not possible via UI due to port typing, but API must handle it)
    _run("CYCLE detected (should error)", {
        "nodes": [
            {"id": "a",   "type": "circular", "data": {}},
            {"id": "b",   "type": "mix",      "data": {"blend": 0.5}},
            {"id": "out", "type": "output",   "data": {}},
        ],
        "edges": [
            # b depends on a
            {"source": "a", "sourceHandle": "out-trajectory", "target": "b",   "targetHandle": "in-trajectory-0"},
            # a depends on b (cycle)
            {"source": "b", "sourceHandle": "out-trajectory", "target": "a",   "targetHandle": "in-objects"},
            {"source": "b", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 6. Orphaned island ────────────────────────────────────────────────────
    _run("Orphaned island (info)", {
        "nodes": [
            {"id": "obj", "type": "objects",  "data": {"count": 4}},
            {"id": "dur", "type": "duration", "data": {"seconds": 5}},
            {"id": "mov", "type": "circular", "data": {}},
            {"id": "out", "type": "output",   "data": {}},
            {"id": "orp", "type": "swarm",    "data": {}},  # orphan
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects",    "target": "mov", "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "mov", "targetHandle": "in-duration"},
            {"source": "mov", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 7. Sequence (valid, same count) ───────────────────────────────────────
    _run("Sequence valid: circular(5) → formation(5)", {
        "nodes": [
            {"id": "obj", "type": "objects",   "data": {"count": 5}},
            {"id": "da",  "type": "duration",  "data": {"seconds": 4}},
            {"id": "db",  "type": "duration",  "data": {"seconds": 6}},
            {"id": "ma",  "type": "circular",  "data": {}},
            {"id": "mb",  "type": "formation", "data": {}},
            {"id": "seq", "type": "sequence",  "data": {}},
            {"id": "out", "type": "output",    "data": {}},
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects",    "target": "ma",  "targetHandle": "in-objects"},
            {"source": "da",  "sourceHandle": "out-duration",   "target": "ma",  "targetHandle": "in-duration"},
            {"source": "obj", "sourceHandle": "out-objects",    "target": "mb",  "targetHandle": "in-objects"},
            {"source": "db",  "sourceHandle": "out-duration",   "target": "mb",  "targetHandle": "in-duration"},
            {"source": "ma",  "sourceHandle": "out-trajectory", "target": "seq", "targetHandle": "in-trajectory-0"},
            {"source": "mb",  "sourceHandle": "out-trajectory", "target": "seq", "targetHandle": "in-trajectory-1"},
            {"source": "seq", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })

    # ── 8. Performance warning (heavy graph) ──────────────────────────────────
    _run("Performance warning: 200 obj × 60s", {
        "nodes": [
            {"id": "obj", "type": "objects",  "data": {"count": 200}},
            {"id": "dur", "type": "duration", "data": {"seconds": 60}},
            {"id": "mov", "type": "swarm",    "data": {}},
            {"id": "out", "type": "output",   "data": {}},
        ],
        "edges": [
            {"source": "obj", "sourceHandle": "out-objects",    "target": "mov", "targetHandle": "in-objects"},
            {"source": "dur", "sourceHandle": "out-duration",   "target": "mov", "targetHandle": "in-duration"},
            {"source": "mov", "sourceHandle": "out-trajectory", "target": "out", "targetHandle": "in-trajectory"},
        ],
    })
