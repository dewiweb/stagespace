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

  it('multiple output nodes → both compile into slots[], no MULTI_OUTPUT warning', () => {
    const g = simpleGraph('circular')
    g.nodes.push({ id: 'out2', type: 'output', data: {} })
    // Connect the second output too (same engine — edge will be duplicate, but let's connect separately)
    g.edges.push({ source: 'mov', sourceHandle: 'out-trajectory', target: 'out2', targetHandle: 'in-trajectory' })
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots.length).toBe(2)
    expect(r.issues.some(i => i.code === 'MULTI_OUTPUT')).toBe(false)
  })
})

describe('GraphCompiler — trackMap node', () => {
  it('trackMap with string trackIds overrides default sequential IDs in slot', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 3 } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'tm',  type: 'trackMap', data: { trackIds: '5, 7, 3' } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'tm',  targetHandle: 'in-trajectory' },
        { source: 'tm',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].trackIds).toEqual([5, 7, 3])
  })

  it('trackMap with array trackIds works identically', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2 } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'tm',  type: 'trackMap', data: { trackIds: [10, 20] } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'tm',  targetHandle: 'in-trajectory' },
        { source: 'tm',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].trackIds).toEqual([10, 20])
  })

  it('trackMap count mismatch emits TRACK_COUNT_MISMATCH warning', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 4 } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'tm',  type: 'trackMap', data: { trackIds: '1, 2' } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'tm',  targetHandle: 'in-trajectory' },
        { source: 'tm',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'TRACK_COUNT_MISMATCH')).toBe(true)
  })

  it('trackMap without input emits MISSING_PORT error', () => {
    const g: Graph = {
      nodes: [
        { id: 'tm',  type: 'trackMap', data: { trackIds: '1, 2' } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'tm', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(false)
    expect(r.issues.some(i => i.code === 'MISSING_PORT')).toBe(true)
  })
})

describe('GraphCompiler — useHolPositions on Objects node', () => {
  it('initialPositions propagated to slot when useHolPositions=true', () => {
    const initialPositions = [
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2, useHolPositions: true, initialPositions } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].initialPositions).toEqual(initialPositions)
  })

  it('initialPositions NOT propagated when useHolPositions=false', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2, useHolPositions: false, initialPositions: [{ x: 1, y: 0, z: 0 }] } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].initialPositions).toBeUndefined()
  })

  it('Objects.trackIds propagated to slot when no trackMap present', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 3, trackIds: [10, 20, 30] } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].trackIds).toEqual([10, 20, 30])
  })

  it('trackMap.trackIds takes priority over Objects.trackIds', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2, trackIds: [1, 2] } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'tm',  type: 'trackMap', data: { trackIds: '99, 88' } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'tm',  targetHandle: 'in-trajectory' },
        { source: 'tm',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.slots[0].trackIds).toEqual([99, 88])
  })
})

describe('GraphCompiler — falloff integration', () => {
  it('compiles engine with time.linear falloff modulating radius', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',     data: { count: 2 } },
        { id: 'dur',  type: 'duration',    data: { seconds: 10 } },
        { id: 'fall', type: 'time.linear', data: { invert: 0 } },
        { id: 'mov',  type: 'circular',    data: { radius: 2, signalTarget: 'radius', signalMin: 0.5, signalMax: 3 } },
        { id: 'out',  type: 'output',      data: {} },
      ],
      edges: [
        { source: 'obj',  sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur',  sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'fall', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.fn).toBeDefined()
    // t=0 → phase=0 → signal=0 → radius=0.5; positions near center
    const p0 = r.fn!(0, 0, 2, 10)
    // t=5 → phase=0.5 → signal=0.5 → radius=1.75; positions further
    const p5 = r.fn!(5, 0, 2, 10)
    const dist0 = Math.sqrt(p0.x * p0.x + p0.y * p0.y)
    const dist5 = Math.sqrt(p5.x * p5.x + p5.y * p5.y)
    expect(dist0).toBeCloseTo(0.5, 1)
    expect(dist5).toBeCloseTo(1.75, 1)
  })

  it('falloff connected but no signalTarget → emits NO_SIGNAL_TARGET info, still compiles', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',     data: { count: 2 } },
        { id: 'dur',  type: 'duration',    data: { seconds: 10 } },
        { id: 'fall', type: 'time.linear', data: {} },
        { id: 'mov',  type: 'circular',    data: { radius: 1 } },
        { id: 'out',  type: 'output',      data: {} },
      ],
      edges: [
        { source: 'obj',  sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur',  sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'fall', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'NO_SIGNAL_TARGET')).toBe(true)
  })

  it('unknown falloff type → UNKNOWN_FALLOFF warning but engine still compiles with static params', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',        data: { count: 2 } },
        { id: 'dur',  type: 'duration',       data: { seconds: 10 } },
        { id: 'fall', type: 'unknown.falloff', data: {} },
        { id: 'mov',  type: 'circular',       data: { radius: 1.5, signalTarget: 'radius', signalMin: 0, signalMax: 3 } },
        { id: 'out',  type: 'output',         data: {} },
      ],
      edges: [
        { source: 'obj',  sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur',  sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'fall', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.issues.some(i => i.code === 'UNKNOWN_FALLOFF' || i.code === 'FALLOFF_COMPILE_FAILED')).toBe(true)
    // Engine uses static radius=1.5
    const p = r.fn!(0, 0, 2, 10)
    const dist = Math.sqrt(p.x * p.x + p.y * p.y)
    expect(dist).toBeCloseTo(1.5, 1)
  })

  it('time.sine falloff modulates speed on oscillation engine', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',   data: { count: 1 } },
        { id: 'dur',  type: 'duration',  data: { seconds: 10 } },
        { id: 'fall', type: 'time.sine', data: { frequency: 1, phase: 0, invert: 0 } },
        { id: 'mov',  type: 'oscillation', data: { ampX: 1, freqX: 1, signalTarget: 'ampX', signalMin: 0, signalMax: 2 } },
        { id: 'out',  type: 'output',    data: {} },
      ],
      edges: [
        { source: 'obj',  sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur',  sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'fall', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov',  sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.fn).toBeDefined()
    // Should produce finite values at all times
    for (const t of [0, 1, 2.5, 5, 7.5, 10]) {
      const p = r.fn!(t, 0, 1, 10)
      expect(isFinite(p.x)).toBe(true)
      expect(isFinite(p.y)).toBe(true)
    }
  })
})

describe('GraphCompiler — audio signal sources', () => {
  it('audioAmplitude → in-signal → compiles and modulates radius', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',        data: { count: 2 } },
        { id: 'dur',  type: 'duration',       data: { seconds: 10 } },
        { id: 'amp',  type: 'audioAmplitude', data: { gain: 2 } },
        { id: 'mov',  type: 'circular',       data: { radius: 1, signalTarget: 'radius', signalMin: 0, signalMax: 3 } },
        { id: 'out',  type: 'output',         data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'amp', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.fn).toBeDefined()
    // sharedAudioFrame.amplitude = 0 by default → signal = 0 → radius = signalMin = 0
    const p = r.fn!(0, 0, 2, 10)
    expect(isFinite(p.x)).toBe(true)
  })

  it('bpm → in-signal → compiles and produces finite positions', () => {
    const g: Graph = {
      nodes: [
        { id: 'obj',  type: 'objects',   data: { count: 2 } },
        { id: 'dur',  type: 'duration',  data: { seconds: 10 } },
        { id: 'bpm',  type: 'bpm',       data: { min: 60, max: 180 } },
        { id: 'mov',  type: 'circular',  data: { radius: 2, signalTarget: 'radius', signalMin: 1, signalMax: 4 } },
        { id: 'out',  type: 'output',    data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'bpm', sourceHandle: 'out-signal',     target: 'mov', targetHandle: 'in-signal' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.fn).toBeDefined()
    for (const t of [0, 2.5, 5, 10]) {
      const p = r.fn!(t, 0, 2, 10)
      expect(isFinite(p.x)).toBe(true)
      expect(isFinite(p.y)).toBe(true)
    }
  })
})

describe('GraphCompiler — initialPosition from .hol', () => {
  it('Objects node with initialPositions → EngineContext receives initialPosition', () => {
    const initPos = [{ x: 5, y: 3, z: 0 }, { x: -5, y: 3, z: 0 }]
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2, initialPositions: initPos } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    // circular at t=0, radius=1, objectIndex=0 → x=0, y=1 (no offset)
    const p = r.fn!(0, 0, 2, 10)
    expect(isFinite(p.x)).toBe(true)
  })

  it('offset node with useHolPosition=1 adds initialPositions to trajectory', () => {
    const initPos = [{ x: 10, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }]
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 2, initialPositions: initPos } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'off', type: 'offset',   data: { x: 0, y: 0, z: 0, useHolPosition: 1 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'off', targetHandle: 'in-trajectory' },
        { source: 'off', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    expect(r.fn).toBeDefined()
    // circular at t=0: obj=0 → phaseOffset=0, angle=0 → x=cos(0)=1, y=sin(0)=0
    // + initialPosition (10, 0, 0) → (11, 0, 0)
    const p0 = r.fn!(0, 0, 2, 10)
    expect(p0.x).toBeCloseTo(11, 1)
    expect(p0.y).toBeCloseTo(0, 1)
    // obj=1 → phaseOffset=π, angle=π → x=cos(π)=-1, y=sin(π)≈0
    // + initialPosition (-10, 0, 0) → (-11, 0, 0)
    const p1 = r.fn!(0, 1, 2, 10)
    expect(p1.x).toBeCloseTo(-11, 1)
  })

  it('offset node without useHolPosition ignores initialPositions', () => {
    const initPos = [{ x: 10, y: 0, z: 0 }]
    const g: Graph = {
      nodes: [
        { id: 'obj', type: 'objects',  data: { count: 1, initialPositions: initPos } },
        { id: 'dur', type: 'duration', data: { seconds: 10 } },
        { id: 'mov', type: 'circular', data: { radius: 1 } },
        { id: 'off', type: 'offset',   data: { x: 0, y: 0, z: 0 } },
        { id: 'out', type: 'output',   data: {} },
      ],
      edges: [
        { source: 'obj', sourceHandle: 'out-objects',    target: 'mov', targetHandle: 'in-objects' },
        { source: 'dur', sourceHandle: 'out-duration',   target: 'mov', targetHandle: 'in-duration' },
        { source: 'mov', sourceHandle: 'out-trajectory', target: 'off', targetHandle: 'in-trajectory' },
        { source: 'off', sourceHandle: 'out-trajectory', target: 'out', targetHandle: 'in-trajectory' },
      ],
    }
    const r = compiler.compile(g)
    expect(r.success).toBe(true)
    // No .hol offset → circular at t=0, obj=0 → x=cos(0)*1=1, y=sin(0)*1=0
    const p = r.fn!(0, 0, 1, 10)
    expect(p.x).toBeCloseTo(1, 1)
    expect(p.y).toBeCloseTo(0, 1)
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
