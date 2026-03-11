import { describe, it, expect } from 'vitest'
import { getAllFalloffs, getFalloff, getFalloffsByCategory } from '../registry'
import type { FalloffContext } from '../types'

function makeCtx(overrides: Partial<FalloffContext> = {}): FalloffContext {
  return {
    t: 0,
    duration: 10,
    phase: 0,
    objectIndex: 0,
    objectCount: 4,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

describe('Falloff registry', () => {
  it('has 15 falloffs registered', () => {
    expect(getAllFalloffs()).toHaveLength(15)
  })

  it('getFalloff returns correct descriptor', () => {
    const f = getFalloff('time.linear')
    expect(f).toBeDefined()
    expect(f!.id).toBe('time.linear')
    expect(f!.category).toBe('time')
  })

  it('getFalloff returns undefined for unknown id', () => {
    expect(getFalloff('nonexistent')).toBeUndefined()
  })

  it('getFalloffsByCategory returns correct subsets', () => {
    const time    = getFalloffsByCategory('time')
    const spatial = getFalloffsByCategory('spatial')
    const math    = getFalloffsByCategory('math')
    expect(time.length).toBe(5)
    expect(spatial.length).toBe(4)
    expect(math.length).toBe(6)
    expect(time.every(f => f.category === 'time')).toBe(true)
    expect(spatial.every(f => f.category === 'spatial')).toBe(true)
    expect(math.every(f => f.category === 'math')).toBe(true)
  })
})

describe('All falloffs — output is a finite number', () => {
  for (const f of getAllFalloffs()) {
    it(`${f.id} returns finite scalar`, () => {
      const v = f.fn(makeCtx({ phase: 0.5 }), f.defaultParams)
      expect(isFinite(v)).toBe(true)
    })
  }
})

describe('Time falloffs', () => {
  it('time.linear — phase=0 → 0, phase=1 → 1', () => {
    const f = getFalloff('time.linear')!
    expect(f.fn(makeCtx({ phase: 0 }), f.defaultParams)).toBeCloseTo(0, 5)
    expect(f.fn(makeCtx({ phase: 1 }), f.defaultParams)).toBeCloseTo(1, 5)
  })

  it('time.linear — invert=1 flips output', () => {
    const f = getFalloff('time.linear')!
    const v0 = f.fn(makeCtx({ phase: 0.3 }), { ...f.defaultParams, invert: 0 })
    const v1 = f.fn(makeCtx({ phase: 0.3 }), { ...f.defaultParams, invert: 1 })
    expect(v0 + v1).toBeCloseTo(1, 5)
  })

  it('time.sine — output stays in [0,1]', () => {
    for (let i = 0; i <= 20; i++) {
      const f = getFalloff('time.sine')!
      const v = f.fn(makeCtx({ phase: i / 20 }), f.defaultParams)
      expect(v).toBeGreaterThanOrEqual(-0.001)
      expect(v).toBeLessThanOrEqual(1.001)
    }
  })

  it('time.sine — oscillates (not constant)', () => {
    const f = getFalloff('time.sine')!
    // phase=0.25 → sin(π/2)=1 → 1.0 ; phase=0.75 → sin(3π/2)=-1 → 0.0
    const v0 = f.fn(makeCtx({ phase: 0.25 }), f.defaultParams)
    const v1 = f.fn(makeCtx({ phase: 0.75 }), f.defaultParams)
    expect(v0).toBeCloseTo(1, 3)
    expect(v1).toBeCloseTo(0, 3)
  })

  it('time.pulse — produces 0 or 1 at extremes', () => {
    const f = getFalloff('time.pulse')!
    // frequency=1, width=0.5 → ON from 0 to 0.5, OFF from 0.5 to 1
    const p = { frequency: 1, width: 0.5, smoothness: 0 }
    const vOn  = f.fn(makeCtx({ phase: 0.2 }), p)
    const vOff = f.fn(makeCtx({ phase: 0.8 }), p)
    expect(vOn).toBeCloseTo(1, 2)
    expect(vOff).toBeCloseTo(0, 2)
  })

  it('time.ramp — clamps output to [0,1]', () => {
    const f = getFalloff('time.ramp')!
    const p = { start: 0.3, end: 0.7, clamp: 1 }
    expect(f.fn(makeCtx({ phase: 0 }), p)).toBeCloseTo(0, 5)
    expect(f.fn(makeCtx({ phase: 1 }), p)).toBeCloseTo(1, 5)
    expect(f.fn(makeCtx({ phase: 0.5 }), p)).toBeCloseTo(0.5, 3)
  })

  it('time.stagger — different objects have different phases', () => {
    const f = getFalloff('time.stagger')!
    const p = { offset: 0.5, invert: 0 }
    const v0 = f.fn(makeCtx({ objectIndex: 0, objectCount: 4, phase: 0 }), p)
    const v1 = f.fn(makeCtx({ objectIndex: 1, objectCount: 4, phase: 0 }), p)
    expect(v0).not.toBeCloseTo(v1, 3)
  })
})

describe('Spatial falloffs', () => {
  it('spatial.pointDistance — center position → 1', () => {
    const f = getFalloff('spatial.pointDistance')!
    const p = { ...f.defaultParams, cx: 0, cy: 0, cz: 0, radius: 1 }
    const v = f.fn(makeCtx({ position: { x: 0, y: 0, z: 0 } }), p)
    expect(v).toBeCloseTo(1, 5)
  })

  it('spatial.pointDistance — outside radius → 0', () => {
    const f = getFalloff('spatial.pointDistance')!
    const p = { ...f.defaultParams, cx: 0, cy: 0, cz: 0, radius: 1 }
    const v = f.fn(makeCtx({ position: { x: 2, y: 0, z: 0 } }), p)
    expect(v).toBeCloseTo(0, 5)
  })

  it('spatial.pointDistance — halfway → ~0.5 (linear, exponent=1)', () => {
    const f = getFalloff('spatial.pointDistance')!
    const p = { ...f.defaultParams, cx: 0, cy: 0, cz: 0, radius: 2, exponent: 1 }
    const v = f.fn(makeCtx({ position: { x: 1, y: 0, z: 0 } }), p)
    expect(v).toBeCloseTo(0.5, 3)
  })

  it('spatial.pointDistance — invert flips output', () => {
    const f = getFalloff('spatial.pointDistance')!
    const base   = { cx: 0, cy: 0, cz: 0, radius: 2, invert: 0, exponent: 1 }
    const inv    = { ...base, invert: 1 }
    const ctx    = makeCtx({ position: { x: 1, y: 0, z: 0 } })
    const v0 = f.fn(ctx, base)
    const v1 = f.fn(ctx, inv)
    expect(v0 + v1).toBeCloseTo(1, 5)
  })

  it('spatial.axisDistance — on-axis center → 1', () => {
    const f = getFalloff('spatial.axisDistance')!
    const p = { axis: 0, center: 0, radius: 1, invert: 0 }
    const v = f.fn(makeCtx({ position: { x: 0, y: 5, z: -3 } }), p)
    expect(v).toBeCloseTo(1, 5)
  })

  it('spatial.objectIndex — returns 0 for first, 1 for last', () => {
    const f = getFalloff('spatial.objectIndex')!
    const p = { invert: 0, exponent: 1 }
    const v0 = f.fn(makeCtx({ objectIndex: 0, objectCount: 4 }), p)
    const v3 = f.fn(makeCtx({ objectIndex: 3, objectCount: 4 }), p)
    expect(v0).toBeCloseTo(0, 5)
    expect(v3).toBeCloseTo(1, 5)
  })

  it('spatial.randomPerObject — different objects produce different values', () => {
    const f = getFalloff('spatial.randomPerObject')!
    const p = { seed: 42, min: 0, max: 1 }
    const vals = new Set(
      Array.from({ length: 8 }, (_, i) =>
        f.fn(makeCtx({ objectIndex: i, objectCount: 8 }), p).toFixed(4)
      )
    )
    expect(vals.size).toBeGreaterThan(4)
  })

  it('spatial.randomPerObject — same seed produces same value', () => {
    const f = getFalloff('spatial.randomPerObject')!
    const p = { seed: 99, min: 0, max: 1 }
    const ctx = makeCtx({ objectIndex: 2 })
    expect(f.fn(ctx, p)).toBeCloseTo(f.fn(ctx, p), 10)
  })
})

describe('Math falloffs', () => {
  it('math.constant — always returns value', () => {
    const f = getFalloff('math.constant')!
    for (let ph = 0; ph <= 1; ph += 0.2) {
      expect(f.fn(makeCtx({ phase: ph }), { value: 0.7 })).toBeCloseTo(0.7, 5)
    }
  })

  it('math.smoothstep — monotonically increasing 0→1', () => {
    const f = getFalloff('math.smoothstep')!
    const vals = Array.from({ length: 11 }, (_, i) =>
      f.fn(makeCtx({ phase: i / 10 }), f.defaultParams)
    )
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i-1] - 1e-9)
    }
    expect(vals[0]).toBeCloseTo(0, 5)
    expect(vals[10]).toBeCloseTo(1, 5)
  })

  it('math.remap — maps phase linearly', () => {
    const f = getFalloff('math.remap')!
    const p = { inMin: 0, inMax: 1, outMin: -1, outMax: 1, clamp: 0 }
    expect(f.fn(makeCtx({ phase: 0 }), p)).toBeCloseTo(-1, 5)
    expect(f.fn(makeCtx({ phase: 0.5 }), p)).toBeCloseTo(0, 5)
    expect(f.fn(makeCtx({ phase: 1 }), p)).toBeCloseTo(1, 5)
  })

  it('math.mix — t=0 returns a, t=1 returns b', () => {
    const f = getFalloff('math.mix')!
    expect(f.fn(makeCtx(), { a: 0.2, b: 0.8, t: 0 })).toBeCloseTo(0.2, 5)
    expect(f.fn(makeCtx(), { a: 0.2, b: 0.8, t: 1 })).toBeCloseTo(0.8, 5)
  })

  it('math.multiply — scales phase', () => {
    const f = getFalloff('math.multiply')!
    expect(f.fn(makeCtx({ phase: 0.5 }), { factor: 2 })).toBeCloseTo(1.0, 5)
  })

  it('math.power — exponent=1 is identity', () => {
    const f = getFalloff('math.power')!
    const p = { exponent: 1, invert: 0 }
    expect(f.fn(makeCtx({ phase: 0.6 }), p)).toBeCloseTo(0.6, 5)
  })

  it('math.power — exponent=2 gives quadratic', () => {
    const f = getFalloff('math.power')!
    const p = { exponent: 2, invert: 0 }
    expect(f.fn(makeCtx({ phase: 0.5 }), p)).toBeCloseTo(0.25, 5)
  })
})
