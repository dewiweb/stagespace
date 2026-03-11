import { describe, it, expect } from 'vitest'
import { getAllEngines, getMathEngines, getPhysicsEngines, getEngine } from '../registry'
import type { EngineContext } from '../types'

function makeCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    t: 1.0,
    duration: 10,
    objectIndex: 0,
    objectCount: 4,
    phase: 0.1,
    ...overrides,
  }
}

describe('Engine registry', () => {
  it('exports all 18 engines', () => {
    expect(getAllEngines()).toHaveLength(18)
  })

  it('math engines count', () => {
    expect(getMathEngines()).toHaveLength(13)
  })

  it('physics engines count', () => {
    expect(getPhysicsEngines()).toHaveLength(5)
  })

  it('getEngine returns correct descriptor', () => {
    const e = getEngine('circular')
    expect(e).toBeDefined()
    expect(e!.id).toBe('circular')
  })

  it('getEngine returns undefined for unknown id', () => {
    expect(getEngine('nonexistent')).toBeUndefined()
  })
})

describe('All engines return valid Vector3', () => {
  const ctx = makeCtx()
  for (const engine of getAllEngines()) {
    it(`${engine.id} — returns finite x,y,z`, () => {
      const result = engine.fn(ctx, engine.defaultParams)
      expect(typeof result.x).toBe('number')
      expect(typeof result.y).toBe('number')
      expect(typeof result.z).toBe('number')
      expect(isFinite(result.x)).toBe(true)
      expect(isFinite(result.y)).toBe(true)
      expect(isFinite(result.z)).toBe(true)
    })
  }
})

describe('All engines — multiple objects produce distinct positions', () => {
  for (const engine of getMathEngines()) {
    it(`${engine.id} — 4 objects have different phases`, () => {
      const results = Array.from({ length: 4 }, (_, i) =>
        engine.fn(makeCtx({ objectIndex: i, objectCount: 4 }), engine.defaultParams)
      )
      // At least one pair must differ (phase offset per object)
      const allSame = results.every(r =>
        r.x === results[0].x && r.y === results[0].y && r.z === results[0].z
      )
      expect(allSame).toBe(false)
    })
  }
})

describe('All engines — phase=0 and phase=0.5 produce different results', () => {
  // formation with speed=0 is intentionally static (fixed placement) — skip it here
  const movingEngines = getMathEngines().filter(e => e.id !== 'formation')
  for (const engine of movingEngines) {
    it(`${engine.id} — moves over time`, () => {
      const r0 = engine.fn(makeCtx({ phase: 0, t: 0 }), engine.defaultParams)
      const r1 = engine.fn(makeCtx({ phase: 0.5, t: 5 }), engine.defaultParams)
      const moved = r0.x !== r1.x || r0.y !== r1.y || r0.z !== r1.z
      expect(moved).toBe(true)
    })
  }

  it('formation — rotates when speed != 0', () => {
    const e = getMathEngines().find(e => e.id === 'formation')!
    const r0 = e.fn(makeCtx({ phase: 0, t: 0 }), { ...e.defaultParams, speed: 1 })
    const r1 = e.fn(makeCtx({ phase: 0.5, t: 5 }), { ...e.defaultParams, speed: 1 })
    const moved = r0.x !== r1.x || r0.y !== r1.y || r0.z !== r1.z
    expect(moved).toBe(true)
  })
})

describe('Physics engines — precompute cache and return consistent frames', () => {
  for (const engine of getPhysicsEngines()) {
    it(`${engine.id} — same ctx → same result`, () => {
      const ctx0 = makeCtx({ objectCount: 6, duration: 5 })
      const r1 = engine.fn(ctx0, engine.defaultParams)
      const r2 = engine.fn(ctx0, engine.defaultParams)
      expect(r1.x).toBeCloseTo(r2.x, 5)
      expect(r1.y).toBeCloseTo(r2.y, 5)
      expect(r1.z).toBeCloseTo(r2.z, 5)
    })
  }
})

describe('Circular engine — specific geometry', () => {
  it('phase=0 → cos(0)*radius on X', () => {
    const e = getEngine('circular')!
    const r = e.fn(makeCtx({ phase: 0, t: 0, objectIndex: 0, objectCount: 1 }), { ...e.defaultParams, radius: 2, speed: 1, centerX: 0, centerY: 0, centerZ: 0, tiltX: 0, tiltZ: 0 })
    expect(r.x).toBeCloseTo(2, 4)
    expect(r.y).toBeCloseTo(0, 4)
    expect(r.z).toBeCloseTo(0, 4)
  })

  it('radius scales output correctly', () => {
    const e = getEngine('circular')!
    const ctx = makeCtx({ phase: 0, t: 0, objectIndex: 0, objectCount: 1 })
    const r1 = e.fn(ctx, { ...e.defaultParams, radius: 1, speed: 1, centerX: 0, centerY: 0, centerZ: 0, tiltX: 0, tiltZ: 0 })
    const r3 = e.fn(ctx, { ...e.defaultParams, radius: 3, speed: 1, centerX: 0, centerY: 0, centerZ: 0, tiltX: 0, tiltZ: 0 })
    expect(r3.x).toBeCloseTo(r1.x * 3, 4)
  })
})

describe('Linear engine', () => {
  it('phase=0 → start point', () => {
    const e = getEngine('linear')!
    const r = e.fn(
      makeCtx({ phase: 0, t: 0, objectIndex: 0, objectCount: 1 }),
      { x0: -2, y0: 0, z0: 0, x1: 2, y1: 0, z1: 0, pingpong: 0 }
    )
    expect(r.x).toBeCloseTo(-2, 4)
  })

  it('phase=1 → end point', () => {
    const e = getEngine('linear')!
    const r = e.fn(
      makeCtx({ phase: 0.9999, t: 9.999, objectIndex: 0, objectCount: 1 }),
      { x0: -2, y0: 0, z0: 0, x1: 2, y1: 0, z1: 0, pingpong: 0 }
    )
    expect(r.x).toBeCloseTo(2, 1)
  })

  it('pingpong — phase=0.5 → end point', () => {
    const e = getEngine('linear')!
    const r = e.fn(
      makeCtx({ phase: 0.5, t: 5, objectIndex: 0, objectCount: 1 }),
      { x0: -2, y0: 0, z0: 0, x1: 2, y1: 0, z1: 0, pingpong: 1 }
    )
    expect(r.x).toBeCloseTo(2, 3)
  })
})

describe('Lissajous engine — freq ratios produce distinct shapes', () => {
  it('3:2 ratio differs from 1:1 ratio', () => {
    const e = getEngine('lissajous')!
    const ctx = makeCtx({ phase: 0.3, objectCount: 1, objectIndex: 0 })
    const r32 = e.fn(ctx, { ...e.defaultParams, freqX: 3, freqY: 2 })
    const r11 = e.fn(ctx, { ...e.defaultParams, freqX: 1, freqY: 1 })
    expect(r32.x === r11.x && r32.y === r11.y).toBe(false)
  })
})

describe('Pendulum engine — builds LUT and returns oscillatory motion', () => {
  it('oscillates around pivot', () => {
    const e = getEngine('pendulum')!
    const params = { ...e.defaultParams, pendulumLength: 2, pivotX: 0, pivotY: 0, pivotZ: 1 }
    const positions = [0, 0.25, 0.5, 0.75].map(phase =>
      e.fn(makeCtx({ phase, t: phase * 10, objectCount: 1, objectIndex: 0, duration: 10 }), params)
    )
    // x should not be constant
    const xs = positions.map(p => p.x)
    expect(new Set(xs.map(x => x.toFixed(3))).size).toBeGreaterThan(1)
  })
})
