import type { Graph, GraphNode, GraphEdge, CompileResult, CompileIssue } from './types'
import type { EngineCompiledFn } from '../runtime/types'
import type { Vector3, EngineContext } from '../types'
import { getEngine } from '../registry'
import { buildSplineLUT, evaluateSpline } from '../spline/catmullRom'
import type { Spline, SplinePoint } from '../spline/types'

// ── Port graph helper ─────────────────────────────────────────────────────────
// inputs[nodeId][portName] = [sourceNodeId, sourcePortName]

type InputMap = Map<string, Map<string, [string, string]>>

function buildInputMap(edges: GraphEdge[], issues: CompileIssue[]): InputMap {
  const map: InputMap = new Map()
  for (const e of edges) {
    if (!e.sourceHandle || !e.targetHandle) continue
    if (!map.has(e.target)) map.set(e.target, new Map())
    const existing = map.get(e.target)!.get(e.targetHandle)
    if (existing) {
      issues.push({ level: 'warning', code: 'DUPLICATE_EDGE', message: `Port '${e.targetHandle}' on node '${e.target}' has multiple connections — only the last one is used.`, nodeId: e.target })
    }
    map.get(e.target)!.set(e.targetHandle, [e.source, e.sourceHandle])
  }
  return map
}

function getInput(inputs: InputMap, nodeId: string, port: string): [string, string] | undefined {
  return inputs.get(nodeId)?.get(port)
}

// ── Trajectory type ───────────────────────────────────────────────────────────
// Internal compiled trajectory: a function that returns position for one object

type TrajFn = (t: number, objectIndex: number, objectCount: number, duration: number) => Vector3

interface TrajNode {
  fn: TrajFn
  objectCount: number
  duration: number
}

// ── Spline cache ──────────────────────────────────────────────────────────────
// Compiled LUT for drawSpline nodes, keyed by nodeId

type SplineCache = Map<string, ReturnType<typeof buildSplineLUT>>

// ── Compiler ─────────────────────────────────────────────────────────────────

export class GraphCompiler {
  compile(graph: Graph): CompileResult {
    const t0 = performance.now()
    const issues: CompileIssue[] = []
    const nodeMap = new Map<string, GraphNode>(graph.nodes.map(n => [n.id, n]))
    const inputs = buildInputMap(graph.edges, issues)

    // ── 1. Find output node ──────────────────────────────────────────────────
    const outputNodes = graph.nodes.filter(n => n.type === 'output')
    if (outputNodes.length === 0) {
      issues.push({ level: 'error', code: 'NO_OUTPUT', message: 'No Output node found.' })
      return { success: false, objectCount: 0, duration: 0, issues, compileMs: elapsed(t0) }
    }
    if (outputNodes.length > 1) {
      issues.push({ level: 'warning', code: 'MULTI_OUTPUT', message: `${outputNodes.length} Output nodes found — using first.`, nodeId: outputNodes[0].id })
    }
    const outputNode = outputNodes[0]

    // ── 2. Cycle detection (DFS) ─────────────────────────────────────────────
    const cyclePath = detectCycle(outputNode.id, inputs, nodeMap)
    if (cyclePath.length > 0) {
      issues.push({ level: 'error', code: 'CYCLE', message: `Cycle detected: ${cyclePath.join(' → ')}` })
      return { success: false, objectCount: 0, duration: 0, issues, compileMs: elapsed(t0) }
    }

    // ── 2b. Warn about orphan nodes (not reachable from output) ────────────────
    warnOrphans(outputNode.id, inputs, nodeMap, issues)

    // ── 3. Compile recursively from output ───────────────────────────────────
    const cache = new Map<string, TrajNode | null>()
    const splineCache: SplineCache = new Map()
    let traj: TrajNode | null
    try {
      traj = compileNode(outputNode.id, nodeMap, inputs, cache, splineCache, issues)
    } catch (err) {
      issues.push({ level: 'error', code: 'COMPILE_ERROR', message: String(err) })
      return { success: false, objectCount: 0, duration: 0, issues, compileMs: elapsed(t0) }
    }


    if (!traj) {
      issues.push({ level: 'error', code: 'EMPTY_RESULT', message: 'Output node produced no trajectory.' })
      return { success: false, objectCount: 0, duration: 0, issues, compileMs: elapsed(t0) }
    }

    // ── 4. Wrap as EngineCompiledFn ──────────────────────────────────────────
    const { fn, objectCount, duration } = traj
    const compiledFn: EngineCompiledFn = (t, objectIndex, _n, _dur) =>
      fn(t, objectIndex, objectCount, duration)

    return {
      success: true,
      fn: compiledFn,
      objectCount,
      duration,
      issues,
      compileMs: elapsed(t0),
    }
  }
}

// ── Node compilation (recursive) ─────────────────────────────────────────────

function compileNode(
  nodeId: string,
  nodeMap: Map<string, GraphNode>,
  inputs: InputMap,
  cache: Map<string, TrajNode | null>,
  splineCache: SplineCache,
  issues: CompileIssue[],
): TrajNode | null {
  if (cache.has(nodeId)) return cache.get(nodeId)!

  // sentinel to catch re-entrancy (shouldn't happen after cycle check)
  cache.set(nodeId, null)

  const node = nodeMap.get(nodeId)
  if (!node) {
    issues.push({ level: 'warning', code: 'MISSING_NODE', message: `Node '${nodeId}' is referenced by an edge but does not exist — it may have been deleted.` })
    return null
  }

  let result: TrajNode | null = null

  switch (node.type) {

    case 'output': {
      const src = getInput(inputs, nodeId, 'in-trajectory')
      if (!src) {
        issues.push({ level: 'error', code: 'MISSING_PORT', message: 'Output node has no trajectory input.', nodeId })
        break
      }
      result = compileNode(src[0], nodeMap, inputs, cache, splineCache, issues)
      break
    }

    case 'objects':
    case 'duration':
      // Data nodes — consumed by motion engines, not compiled directly
      result = null
      break

    case 'mix': {
      const srcA = getInput(inputs, nodeId, 'in-trajectory-0')
      const srcB = getInput(inputs, nodeId, 'in-trajectory-1')
      if (!srcA || !srcB) {
        issues.push({ level: 'error', code: 'MISSING_PORT', message: 'Mix node requires both inputs.', nodeId })
        break
      }
      const a = compileNode(srcA[0], nodeMap, inputs, cache, splineCache, issues)
      const b = compileNode(srcB[0], nodeMap, inputs, cache, splineCache, issues)
      if (!a || !b) break
      if (a.objectCount !== b.objectCount) {
        issues.push({ level: 'error', code: 'OBJECT_COUNT_MISMATCH', message: `Mix: A has ${a.objectCount} objects, B has ${b.objectCount}. Must match.`, nodeId })
        break
      }
      const blend = num(node.data.blend, 0.5)
      result = {
        fn: (t, i, n, dur) => lerpV3(a.fn(t, i, n, dur), b.fn(t, i, n, dur), blend),
        objectCount: a.objectCount,
        duration: Math.max(a.duration, b.duration),
      }
      break
    }

    case 'group': {
      const srcA = getInput(inputs, nodeId, 'in-trajectory-0')
      const srcB = getInput(inputs, nodeId, 'in-trajectory-1')
      if (!srcA || !srcB) {
        issues.push({ level: 'error', code: 'MISSING_PORT', message: 'Group node requires both inputs.', nodeId })
        break
      }
      const a = compileNode(srcA[0], nodeMap, inputs, cache, splineCache, issues)
      const b = compileNode(srcB[0], nodeMap, inputs, cache, splineCache, issues)
      if (!a || !b) break
      const totalCount = a.objectCount + b.objectCount
      result = {
        fn: (t, i, _n, dur) => {
          if (i < a.objectCount) return a.fn(t, i, a.objectCount, dur)
          return b.fn(t, i - a.objectCount, b.objectCount, dur)
        },
        objectCount: totalCount,
        duration: Math.max(a.duration, b.duration),
      }
      break
    }

    case 'sequence': {
      const srcA = getInput(inputs, nodeId, 'in-trajectory-0')
      const srcB = getInput(inputs, nodeId, 'in-trajectory-1')
      if (!srcA || !srcB) {
        issues.push({ level: 'error', code: 'MISSING_PORT', message: 'Sequence node requires both inputs.', nodeId })
        break
      }
      const a = compileNode(srcA[0], nodeMap, inputs, cache, splineCache, issues)
      const b = compileNode(srcB[0], nodeMap, inputs, cache, splineCache, issues)
      if (!a || !b) break
      if (a.objectCount !== b.objectCount) {
        issues.push({ level: 'error', code: 'OBJECT_COUNT_MISMATCH', message: `Sequence: A has ${a.objectCount} objects, B has ${b.objectCount}. Must match.`, nodeId })
        break
      }
      const totalDur = a.duration + b.duration
      result = {
        fn: (t, i, n, _dur) => {
          const tWrapped = t % totalDur
          if (tWrapped < a.duration) return a.fn(tWrapped, i, n, a.duration)
          return b.fn(tWrapped - a.duration, i, n, b.duration)
        },
        objectCount: a.objectCount,
        duration: totalDur,
      }
      break
    }

    case 'drawSpline': {
      result = compileDrawSplineNode(node, splineCache)
      break
    }

    case 'evaluateSpline': {
      result = compileEvaluateSplineNode(node, nodeMap, inputs, splineCache, issues)
      break
    }

    default: {
      // Motion engine or modifier node
      result = compileEngineNode(node, nodeMap, inputs, cache, splineCache, issues)
      break
    }
  }

  cache.set(nodeId, result)
  return result
}

// ── Compile a motion engine node ─────────────────────────────────────────────

function compileEngineNode(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  inputs: InputMap,
  cache: Map<string, TrajNode | null>,
  splineCache: SplineCache,
  issues: CompileIssue[],
): TrajNode | null {
  const engine = getEngine(node.type)
  if (!engine) {
    // Unknown signal/falloff nodes — skip gracefully with info
    const signalTypes = ['bpm','audioAmplitude','audioSpectrum','oscInput']
    const isFalloff = node.type.includes('.')
    if (signalTypes.includes(node.type) || isFalloff) {
      issues.push({ level: 'info', code: 'SIGNAL_NODE_SKIPPED', message: `'${node.type}' is a signal/falloff node — not yet compilable as trajectory source.`, nodeId: node.id })
      return null
    }
    return compileModifierNode(node, nodeMap, inputs, cache, splineCache, issues)
  }

  // Resolve objectCount from connected Objects node or node data
  let objectCount = num(node.data.count ?? node.data.n_objects, 4)
  const objSrc = getInput(inputs, node.id, 'in-objects')
  if (objSrc) {
    const objNode = nodeMap.get(objSrc[0])
    if (objNode?.type === 'objects') {
      objectCount = num(objNode.data.count, 4)
    } else {
      issues.push({ level: 'warning', code: 'WRONG_PORT_TYPE', message: `${node.type}: 'in-objects' connected to '${objNode?.type}' instead of 'objects' node — count ignored.`, nodeId: node.id })
    }
  } else {
    issues.push({ level: 'info', code: 'IMPLICIT_DEFAULT', message: `${node.type}: no Objects node connected — using count=${objectCount}`, nodeId: node.id })
  }

  // Resolve duration from connected Duration node or node data
  let duration = num(node.data.duration ?? node.data.seconds, 10)
  const durSrc = getInput(inputs, node.id, 'in-duration')
  if (durSrc) {
    const durNode = nodeMap.get(durSrc[0])
    if (durNode?.type === 'duration') {
      duration = num(durNode.data.seconds, 10)
    } else {
      issues.push({ level: 'warning', code: 'WRONG_PORT_TYPE', message: `${node.type}: 'in-duration' connected to '${durNode?.type}' instead of 'duration' node — duration ignored.`, nodeId: node.id })
    }
  } else {
    issues.push({ level: 'info', code: 'IMPLICIT_DEFAULT', message: `${node.type}: no Duration node connected — using ${duration}s`, nodeId: node.id })
  }

  // Merge engine default params with node data overrides
  const params: Record<string, number> = { ...engine.defaultParams }
  for (const [k, v] of Object.entries(node.data)) {
    if (typeof v === 'number') params[k] = v
  }

  const engineFn = engine.fn
  return {
    fn: (t, objectIndex, objectCount_, duration_) => {
      const ctx: EngineContext = {
        t,
        duration: duration_,
        objectIndex,
        objectCount: objectCount_,
        phase: duration_ > 0 ? (t % duration_) / duration_ : 0,
      }
      return engineFn(ctx, params)
    },
    objectCount,
    duration,
  }
}

// ── Compile drawSpline: builds LUT, stores in splineCache, returns null (not a trajectory)

function compileDrawSplineNode(
  node: GraphNode,
  splineCache: SplineCache,
): TrajNode | null {
  const rawPoints = node.data.points
  const pts: SplinePoint[] = Array.isArray(rawPoints) && rawPoints.length >= 2
    ? (rawPoints as SplinePoint[])
    : [{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]

  const spline: Spline = {
    points: pts,
    closed: !!node.data.closed,
    tension: num(node.data.tension, 0.5),
  }
  splineCache.set(node.id, buildSplineLUT(spline))
  return null  // drawSpline is not a trajectory source by itself
}

// ── Compile evaluateSpline: reads spline from in-spline, produces trajectory

function compileEvaluateSplineNode(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  inputs: InputMap,
  splineCache: SplineCache,
  issues: CompileIssue[],
): TrajNode | null {
  // Resolve spline from connected drawSpline node
  const splineSrc = getInput(inputs, node.id, 'in-spline')
  let lut: ReturnType<typeof buildSplineLUT> | undefined

  if (splineSrc) {
    const splineNode = nodeMap.get(splineSrc[0])
    if (splineNode?.type === 'drawSpline') {
      // Ensure LUT is built (may not be in cache if drawSpline not yet visited)
      if (!splineCache.has(splineSrc[0])) {
        compileDrawSplineNode(splineNode, splineCache)
      }
      lut = splineCache.get(splineSrc[0])
    } else {
      issues.push({ level: 'warning', code: 'WRONG_PORT_TYPE', message: `evaluateSpline: 'in-spline' must connect to a 'drawSpline' node.`, nodeId: node.id })
    }
  } else {
    issues.push({ level: 'warning', code: 'MISSING_PORT', message: `evaluateSpline: no spline connected — using default 3-point spline.`, nodeId: node.id })
  }

  if (!lut) {
    const spline: Spline = {
      points: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
      closed: false, tension: 0.5,
    }
    lut = buildSplineLUT(spline)
  }

  // Resolve objectCount
  let objectCount = num(node.data.count ?? node.data.n_objects, 4)
  const objSrc = getInput(inputs, node.id, 'in-objects')
  if (objSrc) {
    const objNode = nodeMap.get(objSrc[0])
    if (objNode?.type === 'objects') objectCount = num(objNode.data.count, 4)
    else issues.push({ level: 'warning', code: 'WRONG_PORT_TYPE', message: `evaluateSpline: 'in-objects' expects an 'objects' node.`, nodeId: node.id })
  } else {
    issues.push({ level: 'info', code: 'IMPLICIT_DEFAULT', message: `evaluateSpline: no Objects node — using count=${objectCount}`, nodeId: node.id })
  }

  // Resolve duration
  let duration = num(node.data.seconds ?? node.data.duration, 10)
  const durSrc = getInput(inputs, node.id, 'in-duration')
  if (durSrc) {
    const durNode = nodeMap.get(durSrc[0])
    if (durNode?.type === 'duration') duration = num(durNode.data.seconds, 10)
    else issues.push({ level: 'warning', code: 'WRONG_PORT_TYPE', message: `evaluateSpline: 'in-duration' expects a 'duration' node.`, nodeId: node.id })
  } else {
    issues.push({ level: 'info', code: 'IMPLICIT_DEFAULT', message: `evaluateSpline: no Duration node — using ${duration}s`, nodeId: node.id })
  }

  const speed = num(node.data.speed, 1)
  const perObjOffset = num(node.data.offset, 0.25)
  const mode = Math.round(num(node.data.mode, 0))
  const lutRef = lut

  return {
    fn: (t, i, n, d) => {
      const phase = d > 0 ? ((t * speed) % d) / d : 0
      const tAlong = mode === 1
        // spread: objects distributed along spline, slowly rotating
        ? ((i / Math.max(n - 1, 1)) + phase) % 1
        // travel: each object travels the full spline with per-object offset
        : (phase + (i / Math.max(n, 1)) * perObjOffset) % 1
      return evaluateSpline(lutRef, tAlong)
    },
    objectCount,
    duration,
  }
}

// ── Compile modifier nodes ────────────────────────────────────────────────────

function compileModifierNode(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  inputs: InputMap,
  cache: Map<string, TrajNode | null>,
  splineCache: SplineCache,
  issues: CompileIssue[],
): TrajNode | null {
  const src = getInput(inputs, node.id, 'in-trajectory')
  if (!src) {
    issues.push({ level: 'error', code: 'MISSING_PORT', message: `${node.type}: no trajectory input.`, nodeId: node.id })
    return null
  }
  const upstream = compileNode(src[0], nodeMap, inputs, cache, splineCache, issues)
  if (!upstream) return null

  switch (node.type) {
    case 'scale': {
      const sx = num(node.data.x, 1), sy = num(node.data.y, 1), sz = num(node.data.z, 1)
      return {
        fn: (t, i, n, d) => { const p = upstream.fn(t, i, n, d); return { x: p.x * sx, y: p.y * sy, z: p.z * sz } },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }
    case 'offset': {
      const ox = num(node.data.x, 0), oy = num(node.data.y, 0), oz = num(node.data.z, 0)
      return {
        fn: (t, i, n, d) => { const p = upstream.fn(t, i, n, d); return { x: p.x + ox, y: p.y + oy, z: p.z + oz } },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }
    case 'phaseShift': {
      const shift = num(node.data.shift, 0.1)
      return {
        fn: (t, i, n, d) => {
          const tShifted = (t + i * shift * d) % d
          return upstream.fn(tShifted, i, n, d)
        },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }
    case 'rotate': {
      const ax = num(node.data.angleX, 0), ay = num(node.data.angleY, 0), az = num(node.data.angleZ, 0)
      return {
        fn: (t, i, n, d) => rotateV3(upstream.fn(t, i, n, d), ax, ay, az),
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }
    case 'barycentricGroup': {
      const cx = num(node.data.centerX, 0), cy = num(node.data.centerY, 0), cz = num(node.data.centerZ, 0)
      if (upstream.objectCount > 16) {
        issues.push({ level: 'warning', code: 'PERF_WARNING', message: `barycentricGroup: ${upstream.objectCount} objects — O(n²) per frame, may be slow.`, nodeId: node.id })
      }
      return {
        fn: (t, i, n, d) => {
          const pos = upstream.fn(t, i, n, d)
          const positions = Array.from({ length: n }, (_, j) => upstream.fn(t, j, n, d))
          const bx = positions.reduce((s, p) => s + p.x, 0) / n
          const by = positions.reduce((s, p) => s + p.y, 0) / n
          const bz = positions.reduce((s, p) => s + p.z, 0) / n
          return { x: pos.x - bx + cx, y: pos.y - by + cy, z: pos.z - bz + cz }
        },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }
    case 'trimSpline': {
      const tStart = Math.max(0, Math.min(1, num(node.data.start, 0)))
      const tEnd   = Math.max(0, Math.min(1, num(node.data.end,   1)))
      return {
        fn: (t, i, n, d) => {
          const tLocal = tStart + (tEnd - tStart) * (d > 0 ? (t % d) / d : 0)
          return upstream.fn(tLocal * d, i, n, d)
        },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }

    case 'offsetSpline': {
      const ox = num(node.data.x, 0)
      const oy = num(node.data.y, 0)
      const oz = num(node.data.z, 0)
      return {
        fn: (t, i, n, d) => {
          const p = upstream.fn(t, i, n, d)
          return { x: p.x + ox, y: p.y + oy, z: p.z + oz }
        },
        objectCount: upstream.objectCount,
        duration: upstream.duration,
      }
    }

    default: {
      issues.push({ level: 'error', code: 'UNKNOWN_NODE', message: `Unknown node type: '${node.type}'. Is it in the engine registry?`, nodeId: node.id })
      return null
    }
  }
}

// ── Orphan detection ──────────────────────────────────────────────────────────
// Warns about nodes that exist in the graph but are not reachable from output

function warnOrphans(
  outputId: string,
  inputs: InputMap,
  nodeMap: Map<string, GraphNode>,
  issues: CompileIssue[],
): void {
  const reachable = new Set<string>()
  function visit(id: string) {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const [, [srcId]] of (inputs.get(id) ?? new Map())) {
      if (nodeMap.has(srcId)) visit(srcId)
    }
  }
  visit(outputId)
  for (const [id, node] of nodeMap) {
    if (!reachable.has(id)) {
      // drawSpline nodes linked to evaluateSpline are reachable via in-spline, not trajectory
      // — they won't appear in inputs map traversal, skip them
      const skipTypes = ['objects', 'duration', 'drawSpline']
      if (!skipTypes.includes(node.type)) {
        issues.push({ level: 'info', code: 'ORPHAN_NODE', message: `Node '${node.type}' (id: ${id}) is not connected to the Output.`, nodeId: id })
      }
    }
  }
}

// ── Cycle detection ───────────────────────────────────────────────────────────

function detectCycle(
  startId: string,
  inputs: InputMap,
  nodeMap: Map<string, GraphNode>,
): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  const parent = new Map<string, string | undefined>()

  function dfs(id: string): string[] {
    color.set(id, GRAY)
    for (const [, [srcId]] of (inputs.get(id) ?? new Map())) {
      if (!nodeMap.has(srcId)) continue
      if (color.get(srcId) === GRAY) {
        // reconstruct cycle path
        const path: string[] = [id, srcId]
        let cur: string = id
        for (let i = 0; i < nodeMap.size; i++) {
          const p = parent.get(cur)
          if (!p || p === srcId) break
          path.unshift(p)
          cur = p
        }
        path.unshift(srcId)
        return path
      }
      if (!color.has(srcId) || color.get(srcId) === WHITE) {
        parent.set(srcId, id)
        const r = dfs(srcId)
        if (r.length) return r
      }
    }
    color.set(id, BLACK)
    return []
  }

  return dfs(startId)
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function lerpV3(a: Vector3, b: Vector3, t: number): Vector3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function rotateV3(v: Vector3, ax: number, ay: number, az: number): Vector3 {
  // Rotate around Z axis (az)
  let x = v.x * Math.cos(az) - v.y * Math.sin(az)
  let y = v.x * Math.sin(az) + v.y * Math.cos(az)
  let z = v.z
  // Rotate around Y axis (ay)
  const x2 = x * Math.cos(ay) + z * Math.sin(ay)
  const z2 = -x * Math.sin(ay) + z * Math.cos(ay)
  x = x2; z = z2
  // Rotate around X axis (ax)
  const y2 = y * Math.cos(ax) - z * Math.sin(ax)
  const z3 = y * Math.sin(ax) + z * Math.cos(ax)
  return { x, y: y2, z: z3 }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback
}

function elapsed(t0: number): number {
  return performance.now() - t0
}
