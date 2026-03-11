import { describe, it, expect } from 'vitest'
import { GraphCompiler } from '../GraphCompiler'
import type { Graph } from '../types'

const compiler = new GraphCompiler()

// ── Graph builders ────────────────────────────────────────────────────────────

function simpleGraph(engineId: string, count = 4, seconds = 10, params: Record<string, number> = {}): Graph {
  return {
    nodes: [
      { id: 'obj', type: 'objects',  data: { count } },
      { id: 'dur', type: 'duration', data: { seconds } },
      { id: 'mov', type: engineId,   data: params },
      { id: 'out', type: 'output',   data: {} },
    ],
    edges: [
      { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
      { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
      { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
    ],
  }
}

function mixGraph(engA: string, engB: string, count = 4, blend = 0.5): Graph {
  return {
    nodes: [
      { id: 'obj', type: 'objects',  data: { count } },
      { id: 'dur', type: 'duration', data: { seconds: 8 } },
      { id: 'ma',  type: engA,       data: {} },
      { id: 'mb',  type: engB,       data: {} },
      { id: 'mix', type: 'mix',      data: { blend } },
      { id: 'out', type: 'output',   data: {} },
    ],
    edges: [
      { source: 'obj', sourceHandle: 'out-objects',    target: 'ma',  targetHandle: 'in-objects' },
      { source: 'dur', sourceHandle: 'out-duration',   target: 'ma',  targetHandle: 'in-duration' },
      { source: 'obj', sourceHandle: 'out-objects',    target: 'mb',  targetHandle: 'in-objects' },
      { source: 'dur', sourceHandle: 'out-duration',   target: 'mb',  targetHandle: 'in-duration' },
      { source: 'ma',  sourceHandle: 'out-trajectory', target: 'mix', targetHandle: 'in-trajectory-0' },
      { source: 'mb',  sourceHandle: 'out-trajectory', target: 'mix', targetHandle: 'in-trajectory-1' },
      { source: 'mix', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
    ],
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GraphCompiler — basic', () => {
  it('compiles a simple circular graph', () => {
    const result = compiler.compile(simpleGraph('circular'))
    expect(result.success).toBe(true)
    expect(result.fn).toBeDefined()
    expect(result.objectCount).toBe(4)
    expect(result.duration).toBe(10)
    expect(result.compileMs).toBeGreaterThanOrEqual(0)
  })

  it('compiled fn returns finite Vector3', () => {
    const result = compiler.compile(simpleGraph('circular', 4, 10))
    expect(result.fn).toBeDefined()
    const pos = result.fn!(1.0, 0, 4, 10)
    expect(isFinite(pos.x)).toBe(true)
    expect(isFinite(pos.y)).toBe(true)
    expect(isFinite(pos.z)).toBe(true)
  })

  it('compiles all 13 math engines', () => {
    const engines = ['circular','elliptical','spiral','lissajous','figure8','linear',
      'oscillation','perlinNoise','formation','converge','pendulum','roseCurve','helix']
    for (const id of engines) {
      const result = compiler.compile(simpleGraph(id))
      expect(result.success).toBe(true)
      const pos = result.fn!(2.0, 1, 4, 10)
      expect(isFinite(pos.x)).toBe(true)
    }
  })

  it('compiles all 5 physics engines', () => {
    const engines = ['bouncing','spring','follow','swarm','avoidance']
    for (const id of engines) {
      const result = compiler.compile(simpleGraph(id, 4, 5))
      expect(result.success).toBe(true)
    }
  })
})

describe('GraphCompiler — errors', () => {
  it('fails with no output node', () => {
    const g: Graph = {
      nodes: [{ id: 'a', type: 'circular', data: {} }],
      edges: [],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'NO_OUTPUT')).toBe(true)
  })

  it('fails when output has no trajectory input', () => {
    const g: Graph = {
      nodes: [{ id: 'out', type: 'output', data: {} }],
      edges: [],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })

  it('fails on cycle', () => {
    const g: Graph = {
      nodes: [
        { id: 'a', type: 'circular', data: {} },
        { id: 'b', type: 'mix',      data: { blend: 0.5 } },
        { id: 'out', type: 'output', data: {} },
      ],
      edges: [
        { source: 'a',   sourceHandle: 'out-trajectory', target: 'b',   targetHandle: 'in-trajectory-0' },
        { source: 'b',   sourceHandle: 'out-trajectory', target: 'a',   targetHandle: 'in-objects' }, // cycle
        { source: 'b',   sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'CYCLE')).toBe(true)
  })

  it('fails on unknown node type used as source', () => {
    // Unknown type with no in-trajectory → MISSING_PORT → null → EMPTY_RESULT → failure
    const g: Graph = {
      nodes: [
        { id: 'bad', type: 'nonexistent_engine', data: {} },
        { id: 'out', type: 'output', data: {} },
      ],
      edges: [
        { source: 'bad', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.level === 'error')).toBe(true)
  })

  it('fails on unknown node type used as modifier', () => {
    // Unknown type with in-trajectory connected → UNKNOWN_NODE in compileModifierNode
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',          data: { count: 4 } },
        { id: 'dur', type: 'duration',         data: { seconds: 5 } },
        { id: 'mov', type: 'circular',         data: {} },
        { id: 'bad', type: 'nonexistent_mod',  data: {} },
        { id: 'out', type: 'output',           data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'bad', targetHandle: 'in-trajectory' },
        { source: 'bad', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'UNKNOWN_NODE')).toBe(true)
  })

  it('fails on mix with mismatched object counts', () => {
    const g: Graph = {
      nodes: [
        { id: 'o1',  type: 'objects',  data: { count: 4 } },
        { id: 'o2',  type: 'objects',  data: { count: 6 } },
        { id: 'dur', type: 'duration', data: { seconds: 5 } },
        { id: 'ma',  type: 'circular', data: {} },
        { id: 'mb',  type: 'spiral',   data: {} },
        { id: 'mix', type: 'mix',      data: { blend: 0.5 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'o1',  sourceHandle: 'out-objects',    target: 'ma',  targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'ma',  targetHandle: 'in-duration' },
        { source: 'o2',  sourceHandle: 'out-objects',    target: 'mb',  targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mb',  targetHandle: 'in-duration' },
        { source: 'ma',  sourceHandle: 'out-trajectory', target: 'mix', targetHandle: 'in-trajectory-0' },
        { source: 'mb',  sourceHandle: 'out-trajectory', target: 'mix', targetHandle: 'in-trajectory-1' },
        { source: 'mix', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'OBJECT_COUNT_MISMATCH')).toBe(true)
  })
})

describe('GraphCompiler — Mix node', () => {
  it('compiles mix of circular + lissajous', () => {
    const r = compiler.compile(mixGraph('circular', 'lissajous'))
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(4)
  })

  it('blend=0 → result equals A', () => {
    // Both graphs use duration=8 so phases are identical
    const gA = simpleGraph('circular', 4, 8)
    const gMix = mixGraph('circular', 'spiral', 4, 0)
    const rA   = compiler.compile(gA)
    const rMix = compiler.compile(gMix)
    const posA   = rA.fn!(2.0, 0, 4, 8)
    const posMix = rMix.fn!(2.0, 0, 4, 8)
    expect(posMix.x).toBeCloseTo(posA.x, 3)
    expect(posMix.y).toBeCloseTo(posA.y, 3)
  })

  it('blend=1 → result equals B', () => {
    const gB   = simpleGraph('spiral', 4, 8)
    const gMix = mixGraph('circular', 'spiral', 4, 1)
    const rB   = compiler.compile(gB)
    const rMix = compiler.compile(gMix)
    const posB   = rB.fn!(2.0, 0, 4, 8)
    const posMix = rMix.fn!(2.0, 0, 4, 8)
    expect(posMix.x).toBeCloseTo(posB.x, 3)
  })
})

describe('GraphCompiler — Group node', () => {
  it('compiles group with different object counts', () => {
    const g: Graph = {
      nodes: [
        { id: 'o1',  type: 'objects',  data: { count: 3 } },
        { id: 'o2',  type: 'objects',  data: { count: 5 } },
        { id: 'dur', type: 'duration', data: { seconds: 8 } },
        { id: 'ma',  type: 'circular', data: {} },
        { id: 'mb',  type: 'spiral',   data: {} },
        { id: 'grp', type: 'group',    data: {} },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'o1',  sourceHandle: 'out-objects',    target: 'ma',  targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'ma',  targetHandle: 'in-duration' },
        { source: 'o2',  sourceHandle: 'out-objects',    target: 'mb',  targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mb',  targetHandle: 'in-duration' },
        { source: 'ma',  sourceHandle: 'out-trajectory', target: 'grp', targetHandle: 'in-trajectory-0' },
        { source: 'mb',  sourceHandle: 'out-trajectory', target: 'grp', targetHandle: 'in-trajectory-1' },
        { source: 'grp', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.objectCount).toBe(8) // 3 + 5
  })
})

describe('GraphCompiler — Sequence node', () => {
  it('compiles sequence with total duration = a + b', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 4 } },
        { id: 'da',  type: 'duration', data: { seconds: 4 } },
        { id: 'db',  type: 'duration', data: { seconds: 6 } },
        { id: 'ma',  type: 'circular', data: {} },
        { id: 'mb',  type: 'formation', data: {} },
        { id: 'seq', type: 'sequence', data: {} },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'ma',  targetHandle: 'in-objects' },
        { source: 'da',  sourceHandle: 'out-duration',   target: 'ma',  targetHandle: 'in-duration' },
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mb',  targetHandle: 'in-objects' },
        { source: 'db',  sourceHandle: 'out-duration',   target: 'mb',  targetHandle: 'in-duration' },
        { source: 'ma',  sourceHandle: 'out-trajectory', target: 'seq', targetHandle: 'in-trajectory-0' },
        { source: 'mb',  sourceHandle: 'out-trajectory', target: 'seq', targetHandle: 'in-trajectory-1' },
        { source: 'seq', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.duration).toBe(10) // 4 + 6
    expect(r.objectCount).toBe(4)
  })
})

describe('GraphCompiler — Modifier nodes', () => {
  it('scale modifier doubles positions', () => {
    const base = simpleGraph('circular', 1, 10)
    const withScale: Graph = {
      nodes: [
        ...base.nodes,
        { id: 'scl', type: 'scale', data: { x: 2, y: 2, z: 1 } },
      ],
      edges: [
        ...base.edges.filter(e => e.target !== 'out'),
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'scl', targetHandle: 'in-trajectory' },
        { source: 'scl', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const rBase  = compiler.compile(base)
    const rScale = compiler.compile(withScale)
    const p1 = rBase.fn!(1.0, 0, 1, 10)
    const p2 = rScale.fn!(1.0, 0, 1, 10)
    expect(p2.x).toBeCloseTo(p1.x * 2, 3)
    expect(p2.y).toBeCloseTo(p1.y * 2, 3)
  })

  it('offset modifier shifts positions', () => {
    const base = simpleGraph('circular', 1, 10)
    const withOffset: Graph = {
      nodes: [
        ...base.nodes,
        { id: 'off', type: 'offset', data: { x: 5, y: -3, z: 1 } },
      ],
      edges: [
        ...base.edges.filter(e => e.target !== 'out'),
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'off', targetHandle: 'in-trajectory' },
        { source: 'off', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const rBase   = compiler.compile(base)
    const rOffset = compiler.compile(withOffset)
    const p1 = rBase.fn!(1.0, 0, 1, 10)
    const p2 = rOffset.fn!(1.0, 0, 1, 10)
    expect(p2.x).toBeCloseTo(p1.x + 5, 3)
    expect(p2.y).toBeCloseTo(p1.y - 3, 3)
    expect(p2.z).toBeCloseTo(p1.z + 1, 3)
  })

  it('phaseShift makes objects lead/lag', () => {
    const base = simpleGraph('circular', 4, 10)
    const withShift: Graph = {
      nodes: [
        ...base.nodes,
        { id: 'ps', type: 'phaseShift', data: { shift: 0.1 } },
      ],
      edges: [
        ...base.edges.filter(e => e.target !== 'out'),
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'ps',  targetHandle: 'in-trajectory' },
        { source: 'ps',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(withShift)
    expect(r.success).toBe(true)
    const p0 = r.fn!(1.0, 0, 4, 10)
    const p1 = r.fn!(1.0, 1, 4, 10)
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
  })
})

describe('GraphCompiler — warnings', () => {
  it('warns when no Objects/Duration connected (uses defaults)', () => {
    const g: Graph = {
      nodes: [
        { id: 'mov', type: 'circular', data: {} },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'IMPLICIT_DEFAULT')).toBe(true)
  })

  it('warns on multiple output nodes but still compiles', () => {
    const g = simpleGraph('circular')
    g.nodes.push({ id: 'out2', type: 'output', data: {} })
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'MULTI_OUTPUT')).toBe(true)
  })
})

describe('GraphCompiler — integration with Runtime', () => {
  it('compiled fn plugs directly into Runtime.setEngine', async () => {
    const { Runtime } = await import('../../runtime/Runtime')
    const g = simpleGraph('circular', 4, 10)
    const result = compiler.compile(g)
    expect(result.success).toBe(true)
    const tracks = Array.from({ length: result.objectCount }, (_, i) => ({ id: i + 1, objectIndex: i }))
    const rt = new Runtime({ duration: result.duration })
    rt.setEngine(result.fn!, tracks)
    const frames = rt.tickOnce(1.0)
    expect(frames).toHaveLength(4)
    for (const f of frames) {
      expect(isFinite(f.position.x)).toBe(true)
    }
  })
})
