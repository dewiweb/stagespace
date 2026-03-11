import { describe, it, expect } from 'vitest'
import { Runtime, xyzToAed, aedToXyz } from '../Runtime'
import type { EngineCompiledFn } from '../types'

// Simple circular engine compiled fn for tests
const circularFn: EngineCompiledFn = (t, objectIndex, objectCount, duration) => {
  const phase = (t / duration) % 1
  const phaseOffset = (objectIndex / objectCount) * Math.PI * 2
  const angle = phase * Math.PI * 2 + phaseOffset
  return { x: Math.cos(angle), y: Math.sin(angle), z: 0 }
}

const tracks = [
  { id: 1, objectIndex: 0 },
  { id: 2, objectIndex: 1 },
  { id: 3, objectIndex: 2 },
]

describe('Runtime — initialization', () => {
  it('starts in stopped state', () => {
    const rt = new Runtime()
    expect(rt.getState().running).toBe(false)
    expect(rt.getState().t).toBe(0)
    expect(rt.getState().ticks).toBe(0)
  })

  it('getConfig returns defaults', () => {
    const rt = new Runtime()
    expect(rt.getConfig().fps).toBe(60)
    expect(rt.getConfig().duration).toBe(10)
    expect(rt.getConfig().coordSystem).toBe('xyz')
    expect(rt.getConfig().macroSpeed).toBe(1)
  })

  it('updateConfig patches correctly', () => {
    const rt = new Runtime()
    rt.updateConfig({ fps: 30, oscPort: 4003 })
    expect(rt.getConfig().fps).toBe(30)
    expect(rt.getConfig().oscPort).toBe(4003)
    expect(rt.getConfig().duration).toBe(10) // unchanged
  })
})

describe('Runtime — tickOnce (synchronous, no scheduler)', () => {
  it('advances t by dt * macroSpeed', () => {
    const rt = new Runtime({ duration: 10, macroSpeed: 1 })
    rt.setEngine(circularFn, tracks)
    rt.tickOnce(1.0)
    expect(rt.getState().t).toBeCloseTo(1.0, 5)
    expect(rt.getState().ticks).toBe(1)
  })

  it('wraps t at duration boundary', () => {
    const rt = new Runtime({ duration: 5, macroSpeed: 1 })
    rt.setEngine(circularFn, tracks)
    rt.tickOnce(4.9)
    rt.tickOnce(0.5) // crosses 5s → wraps
    expect(rt.getState().t).toBeCloseTo(0.4, 3)
  })

  it('macroSpeed=2 advances twice as fast', () => {
    const rt = new Runtime({ duration: 100, macroSpeed: 2 })
    rt.setEngine(circularFn, tracks)
    rt.tickOnce(1.0)
    expect(rt.getState().t).toBeCloseTo(2.0, 5)
  })

  it('returns one frame per track', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    const frames = rt.tickOnce(0.1)
    expect(frames).toHaveLength(3)
    expect(frames.map(f => f.trackId)).toEqual([1, 2, 3])
  })

  it('returns empty frames when no engine set', () => {
    const rt = new Runtime()
    const frames = rt.tickOnce(0.1)
    expect(frames).toHaveLength(0)
  })

  it('positions are finite numbers', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    const frames = rt.tickOnce(0.5)
    for (const f of frames) {
      expect(isFinite(f.position.x)).toBe(true)
      expect(isFinite(f.position.y)).toBe(true)
      expect(isFinite(f.position.z)).toBe(true)
    }
  })
})

describe('Runtime — macroScale and macroShift', () => {
  it('macroScale doubles positions', () => {
    const rt1 = new Runtime({ macroScale: { x: 1, y: 1, z: 1 } })
    const rt2 = new Runtime({ macroScale: { x: 2, y: 2, z: 2 } })
    rt1.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    rt2.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    const f1 = rt1.tickOnce(1.0)
    const f2 = rt2.tickOnce(1.0)
    expect(f2[0].position.x).toBeCloseTo(f1[0].position.x * 2, 5)
    expect(f2[0].position.y).toBeCloseTo(f1[0].position.y * 2, 5)
  })

  it('macroShift offsets positions', () => {
    const rt = new Runtime({ macroShift: { x: 5, y: -3, z: 1 } })
    rt.setEngine((_t, _i, _n, _d) => ({ x: 0, y: 0, z: 0 }), [{ id: 1, objectIndex: 0 }])
    const frames = rt.tickOnce(0.1)
    expect(frames[0].position.x).toBeCloseTo(5, 5)
    expect(frames[0].position.y).toBeCloseTo(-3, 5)
    expect(frames[0].position.z).toBeCloseTo(1, 5)
  })
})

describe('Runtime — OSC sender called per track', () => {
  it('calls sendOSC once per track per tick', () => {
    const rt = new Runtime({ coordSystem: 'xyz' })
    rt.setEngine(circularFn, tracks)
    const oscCalls: { address: string; args: number[] }[] = []
    rt.setOSCSender((address, args) => oscCalls.push({ address, args }))
    rt.tickOnce(0.5)
    expect(oscCalls).toHaveLength(3)
    expect(oscCalls[0].address).toBe('/track/1/xyz')
    expect(oscCalls[0].args).toHaveLength(3)
  })

  it('sends AED when coordSystem=aed', () => {
    const rt = new Runtime({ coordSystem: 'aed' })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    const oscCalls: { address: string; args: number[] }[] = []
    rt.setOSCSender((address, args) => oscCalls.push({ address, args }))
    rt.tickOnce(0.5)
    expect(oscCalls[0].address).toBe('/track/1/aed')
    expect(oscCalls[0].args).toHaveLength(3)
  })

  it('uses custom profile address', () => {
    const rt = new Runtime({
      coordSystem: 'xyz',
      profile: {
        name: 'SPAT',
        xyzAddress: (id) => `/spat/source/${id}/xyz`,
        aedAddress: (id) => `/spat/source/${id}/aed`,
      },
    })
    rt.setEngine(circularFn, [{ id: 2, objectIndex: 0 }])
    const addresses: string[] = []
    rt.setOSCSender((address) => addresses.push(address))
    rt.tickOnce(0.5)
    expect(addresses[0]).toBe('/spat/source/2/xyz')
  })
})

describe('Runtime — frameCallback', () => {
  it('fires callback with frames on each tick', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    const received: number[] = []
    rt.setFrameCallback((_frames, t) => received.push(t))
    rt.tickOnce(0.1)
    rt.tickOnce(0.1)
    expect(received).toHaveLength(2)
  })
})

describe('Runtime — start/stop/reset', () => {
  it('start sets running=true', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    rt.start()
    expect(rt.getState().running).toBe(true)
    rt.stop()
  })

  it('stop sets running=false', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    rt.start()
    rt.stop()
    expect(rt.getState().running).toBe(false)
  })

  it('reset sets t=0 and ticks=0', () => {
    const rt = new Runtime()
    rt.setEngine(circularFn, tracks)
    rt.tickOnce(3.0)
    rt.reset()
    expect(rt.getState().t).toBe(0)
    expect(rt.getState().ticks).toBe(0)
  })

  it('start is idempotent (double start does not double-tick)', () => {
    const rt = new Runtime({ fps: 1000 })
    rt.setEngine(circularFn, tracks)
    rt.start()
    rt.start() // second call should be no-op
    expect(rt.getState().running).toBe(true)
    rt.stop()
  })
})

describe('xyzToAed / aedToXyz conversions', () => {
  it('xyz (1,0,0) → azimuth=0, elevation=0, distance=1', () => {
    const aed = xyzToAed({ x: 1, y: 0, z: 0 })
    expect(aed.a).toBeCloseTo(0, 3)
    expect(aed.e).toBeCloseTo(0, 3)
    expect(aed.d).toBeCloseTo(1, 3)
  })

  it('xyz (0,1,0) → azimuth=90', () => {
    const aed = xyzToAed({ x: 0, y: 1, z: 0 })
    expect(aed.a).toBeCloseTo(90, 3)
  })

  it('xyz (0,0,1) → elevation=90', () => {
    const aed = xyzToAed({ x: 0, y: 0, z: 1 })
    expect(aed.e).toBeCloseTo(90, 3)
  })

  it('aedToXyz is inverse of xyzToAed', () => {
    const orig = { x: 1.5, y: -0.7, z: 0.3 }
    const aed = xyzToAed(orig)
    const back = aedToXyz(aed.a, aed.e, aed.d)
    expect(back.x).toBeCloseTo(orig.x, 5)
    expect(back.y).toBeCloseTo(orig.y, 5)
    expect(back.z).toBeCloseTo(orig.z, 5)
  })

  it('zero vector returns d=0', () => {
    const aed = xyzToAed({ x: 0, y: 0, z: 0 })
    expect(aed.d).toBe(0)
  })
})

describe('OSC profiles', () => {
  it('Holophonix profile format', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('holophonix')
    expect(p.xyzAddress(3)).toBe('/track/3/xyz')
    expect(p.aedAddress(3)).toBe('/track/3/aed')
  })

  it('SPAT profile format', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('spat')
    expect(p.xyzAddress(1)).toBe('/spat/source/1/xyz')
  })

  it('unknown profile falls back to holophonix', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('nonexistent')
    expect(p.name).toBe('Holophonix')
  })
})
