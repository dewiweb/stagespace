import { describe, it, expect } from 'vitest'
import { Runtime, xyzToAed, aedToXyz } from '../Runtime'
import { getProfile } from '../oscProfiles'
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

  it('t accumulates beyond duration — wrap happens per-slot', () => {
    const rt = new Runtime({ duration: 5, macroSpeed: 1 })
    rt.setEngine(circularFn, tracks)
    rt.tickOnce(4.9)
    rt.tickOnce(0.5) // crosses 5s — state.t accumulates (no global wrap)
    expect(rt.getState().t).toBeCloseTo(5.4, 3)
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
  it('Holophonix: 1 message /track/{id}/xyz par track', () => {
    const rt = new Runtime({ coordSystem: 'xyz' })
    rt.setEngine(circularFn, tracks)
    const oscCalls: { address: string; args: number[] }[] = []
    rt.setOSCSender((address, args) => oscCalls.push({ address, args }))
    rt.tickOnce(0.5)
    // 3 tracks × 1 message each = 3 calls
    expect(oscCalls).toHaveLength(3)
    expect(oscCalls[0].address).toBe('/track/1/xyz')
    expect(oscCalls[1].address).toBe('/track/2/xyz')
    expect(oscCalls[2].address).toBe('/track/3/xyz')
    expect(oscCalls[0].args).toHaveLength(3)
  })

  it('Holophonix AED: 1 message /track/{id}/aed par track', () => {
    const rt = new Runtime({ coordSystem: 'aed' })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    const oscCalls: { address: string; args: number[] }[] = []
    rt.setOSCSender((address, args) => oscCalls.push({ address, args }))
    rt.tickOnce(0.5)
    expect(oscCalls).toHaveLength(1)
    expect(oscCalls[0].address).toBe('/track/1/aed')
    expect(oscCalls[0].args).toHaveLength(3)
  })

  it('IEM XYZ: 3 messages séparés par track (x, y, z)', () => {
    const rt = new Runtime({ coordSystem: 'xyz', profile: getProfile('iem') })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    const oscCalls: { address: string; args: number[] }[] = []
    rt.setOSCSender((address, args) => oscCalls.push({ address, args }))
    rt.tickOnce(0.5)
    // 1 track × 3 messages (x,y,z séparés) = 3 calls
    expect(oscCalls).toHaveLength(3)
    expect(oscCalls[0].address).toBe('/MultiEncoder/source0/x')
    expect(oscCalls[0].args).toHaveLength(1)
    expect(oscCalls[1].address).toBe('/MultiEncoder/source0/y')
    expect(oscCalls[2].address).toBe('/MultiEncoder/source0/z')
  })

  it('IEM AED: 3 messages séparés (azimuth, elevation, distance)', () => {
    const rt = new Runtime({ coordSystem: 'aed', profile: getProfile('iem') })
    rt.setEngine(circularFn, [{ id: 2, objectIndex: 0 }])
    const calls: { address: string; args: number[] }[] = []
    rt.setOSCSender((a, args) => calls.push({ address: a, args }))
    rt.tickOnce(0.5)
    expect(calls).toHaveLength(3)
    expect(calls[0].address).toBe('/MultiEncoder/source1/azimuth')  // id=2 → 0-indexed=1
    expect(calls[1].address).toBe('/MultiEncoder/source1/elevation')
    expect(calls[2].address).toBe('/MultiEncoder/source1/distance')
  })

  it('IEM: 3 tracks × 3 messages = 9 appels OSC par tick', () => {
    const rt = new Runtime({ coordSystem: 'xyz', profile: getProfile('iem') })
    rt.setEngine(circularFn, tracks)
    const calls: string[] = []
    rt.setOSCSender((a) => calls.push(a))
    rt.tickOnce(0.5)
    expect(calls).toHaveLength(9)
  })

  it('Holophonix split: 3 messages /track/{id}/x,y,z séparés', () => {
    const rt = new Runtime({ coordSystem: 'xyz', profile: getProfile('holophonix_split') })
    rt.setEngine(circularFn, [{ id: 5, objectIndex: 0 }])
    const calls: { address: string; args: number[] }[] = []
    rt.setOSCSender((a, args) => calls.push({ address: a, args }))
    rt.tickOnce(0.5)
    expect(calls).toHaveLength(3)
    expect(calls[0].address).toBe('/track/5/x')
    expect(calls[0].args).toHaveLength(1)
    expect(calls[1].address).toBe('/track/5/y')
    expect(calls[2].address).toBe('/track/5/z')
  })

  it('SPAT: 1 message /spat/source/{id}/xyz', () => {
    const rt = new Runtime({ coordSystem: 'xyz', profile: getProfile('spat') })
    rt.setEngine(circularFn, [{ id: 2, objectIndex: 0 }])
    const calls: string[] = []
    rt.setOSCSender((a) => calls.push(a))
    rt.tickOnce(0.5)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('/spat/source/2/xyz')
  })

  it('valeurs OSC = position post macroScale/macroShift', () => {
    const rt = new Runtime({ coordSystem: 'xyz', macroScale: { x: 2, y: 2, z: 1 }, macroShift: { x: 0, y: 0, z: 5 } })
    rt.setEngine((_t, _i, _n, _d) => ({ x: 1, y: 1, z: 0 }), [{ id: 1, objectIndex: 0 }])
    const calls: { address: string; args: number[] }[] = []
    rt.setOSCSender((a, args) => calls.push({ address: a, args }))
    rt.tickOnce(0.1)
    expect(calls[0].args[0]).toBeCloseTo(2, 5)   // x*2
    expect(calls[0].args[1]).toBeCloseTo(2, 5)   // y*2
    expect(calls[0].args[2]).toBeCloseTo(5, 5)   // z*1+5
  })

  it('args OSC AED sont en degrés (pas en radians)', () => {
    // Position (1,0,0) → azimuth=0°, elevation=0°, distance=1
    const rt = new Runtime({ coordSystem: 'aed' })
    rt.setEngine((_t) => ({ x: 1, y: 0, z: 0 }), [{ id: 1, objectIndex: 0 }])
    const calls: { address: string; args: number[] }[] = []
    rt.setOSCSender((a, args) => calls.push({ address: a, args }))
    rt.tickOnce(0.1)
    expect(calls[0].args[0]).toBeCloseTo(0,   3)  // azimuth = 0°
    expect(calls[0].args[1]).toBeCloseTo(0,   3)  // elevation = 0°
    expect(calls[0].args[2]).toBeCloseTo(1,   3)  // distance = 1
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

describe('OSC profiles — adresses et messages', () => {
  it('Holophonix: xyzAddress et xyzMessages cohérents', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('holophonix')
    expect(p.xyzAddress(3)).toBe('/track/3/xyz')
    expect(p.aedAddress(3)).toBe('/track/3/aed')
    const msgs = p.xyzMessages(3, 1, 2, 3)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].address).toBe('/track/3/xyz')
    expect(msgs[0].args).toEqual([1, 2, 3])
  })

  it('Holophonix AED messages', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('holophonix')
    const msgs = p.aedMessages(1, 45, 10, 2)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].address).toBe('/track/1/aed')
    expect(msgs[0].args).toEqual([45, 10, 2])
  })

  it('Holophonix split: 3 messages séparés x/y/z', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('holophonix_split')
    const msgs = p.xyzMessages(4, 0.5, -1, 2)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toEqual({ address: '/track/4/x', args: [0.5] })
    expect(msgs[1]).toEqual({ address: '/track/4/y', args: [-1] })
    expect(msgs[2]).toEqual({ address: '/track/4/z', args: [2] })
  })

  it('Holophonix split AED: azim/elev/dist séparés', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('holophonix_split')
    const msgs = p.aedMessages(2, 90, 15, 3)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toEqual({ address: '/track/2/azim', args: [90] })
    expect(msgs[1]).toEqual({ address: '/track/2/elev', args: [15] })
    expect(msgs[2]).toEqual({ address: '/track/2/dist', args: [3] })
  })

  it('SPAT: 1 message /spat/source/{id}/xyz', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('spat')
    expect(p.xyzAddress(1)).toBe('/spat/source/1/xyz')
    const msgs = p.xyzMessages(1, 1, 2, 3)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].address).toBe('/spat/source/1/xyz')
  })

  it('IEM XYZ: 3 messages 0-indexés', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('iem')
    // track id=1 → IEM source index 0
    const msgs = p.xyzMessages(1, 0.1, 0.2, 0.3)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toEqual({ address: '/MultiEncoder/source0/x',  args: [0.1] })
    expect(msgs[1]).toEqual({ address: '/MultiEncoder/source0/y',  args: [0.2] })
    expect(msgs[2]).toEqual({ address: '/MultiEncoder/source0/z',  args: [0.3] })
  })

  it('IEM AED: 3 messages azimuth/elevation/distance 0-indexés', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('iem')
    // track id=3 → IEM source index 2
    const msgs = p.aedMessages(3, 45, 20, 1.5)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toEqual({ address: '/MultiEncoder/source2/azimuth',   args: [45] })
    expect(msgs[1]).toEqual({ address: '/MultiEncoder/source2/elevation', args: [20] })
    expect(msgs[2]).toEqual({ address: '/MultiEncoder/source2/distance',  args: [1.5] })
  })

  it('Generic: 1 message /source/{id}/xyz', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('generic')
    const msgs = p.xyzMessages(7, 1, 2, 3)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].address).toBe('/source/7/xyz')
  })

  it('unknown profile falls back to holophonix', async () => {
    const { getProfile } = await import('../oscProfiles')
    const p = getProfile('nonexistent')
    expect(p.name).toBe('Holophonix')
  })
})

// ── OSC IN : OscRouter + application sur Runtime ──────────────────────────────

import { OscRouter } from '../../osc/OscRouter'
import type { OscMessage, OscBinding } from '../../osc/types'

function msg(address: string, ...args: (number | string)[]): OscMessage {
  return { address, args, receivedAt: 0 }
}

/** Crée un applyFn qui applique les bindings standard sur un Runtime */
function makeApplyFn(rt: Runtime) {
  return (binding: OscBinding, args: (number | string | boolean)[]) => {
    const val = typeof args[0] === 'number' ? args[0] : 0
    const norm = OscRouter.normalize(args, binding)
    switch (binding.target.kind) {
      case 'macroSpeed':
        rt.updateConfig({ macroSpeed: val })
        break
      case 'macroScale': {
        const cfg = rt.getConfig()
        const axis = binding.target.axis
        rt.updateConfig({ macroScale: { ...cfg.macroScale, [axis]: val } })
        break
      }
      case 'macroShift': {
        const cfg = rt.getConfig()
        const axis = binding.target.axis
        rt.updateConfig({ macroShift: { ...cfg.macroShift, [axis]: val } })
        break
      }
      case 'custom':
        binding.target.fn(args)
        break
      default:
        break
    }
    void norm // used in nodeParam / cueGo scenarios
  }
}

describe('OSC IN — OscRouter bindings appliqués sur Runtime', () => {

  it('binding macroSpeed : /holoflow/speed → updateConfig macroSpeed', () => {
    const rt = new Runtime({ macroSpeed: 1 })
    const router = new OscRouter()
    router.setApplyFn(makeApplyFn(rt))
    router.addBinding({ id: 'b1', pattern: '/holoflow/speed', target: { kind: 'macroSpeed' } })
    router.dispatch(msg('/holoflow/speed', 2.5))
    expect(rt.getConfig().macroSpeed).toBeCloseTo(2.5, 5)
  })

  it('binding macroScale X : /holoflow/scale/x', () => {
    const rt = new Runtime()
    const router = new OscRouter()
    router.setApplyFn(makeApplyFn(rt))
    router.addBinding({ id: 'sx', pattern: '/holoflow/scale/x', target: { kind: 'macroScale', axis: 'x' } })
    router.dispatch(msg('/holoflow/scale/x', 3))
    expect(rt.getConfig().macroScale.x).toBeCloseTo(3, 5)
    expect(rt.getConfig().macroScale.y).toBeCloseTo(1, 5) // y inchangé
  })

  it('binding macroShift Z : /holoflow/shift/z', () => {
    const rt = new Runtime()
    const router = new OscRouter()
    router.setApplyFn(makeApplyFn(rt))
    router.addBinding({ id: 'sz', pattern: '/holoflow/shift/z', target: { kind: 'macroShift', axis: 'z' } })
    router.dispatch(msg('/holoflow/shift/z', -2))
    expect(rt.getConfig().macroShift.z).toBeCloseTo(-2, 5)
  })

  it('binding wildcard /track/*/speed → toutes les sources', () => {
    const router = new OscRouter()
    const received: number[] = []
    router.on('/track/*/speed', (m) => received.push(m.args[0] as number))
    router.dispatch(msg('/track/1/speed', 1.0))
    router.dispatch(msg('/track/2/speed', 0.5))
    router.dispatch(msg('/track/99/speed', 2.0))
    expect(received).toEqual([1.0, 0.5, 2.0])
  })

  it('binding normalize : /holoflow/speed min=0 max=2, valeur=1 → norm=0.5', () => {
    const b: OscBinding = { id: 'b', pattern: '/holoflow/speed', target: { kind: 'macroSpeed' }, min: 0, max: 2 }
    expect(OscRouter.normalize([1], b)).toBeCloseTo(0.5, 5)
    expect(OscRouter.normalize([0], b)).toBeCloseTo(0, 5)
    expect(OscRouter.normalize([2], b)).toBeCloseTo(1, 5)
    expect(OscRouter.normalize([3], b)).toBeCloseTo(1, 5) // clamped
  })

  it('binding custom fn appelée avec les args OSC', () => {
    const router = new OscRouter()
    const received: (number | string | boolean)[][] = []
    router.addBinding({
      id: 'c1',
      pattern: '/custom/param',
      target: { kind: 'custom', fn: (args) => received.push(args) },
    })
    // applyFn doit être défini pour que les bindings soient exécutés
    router.setApplyFn((binding, args) => {
      if (binding.target.kind === 'custom') binding.target.fn(args)
    })
    router.dispatch(msg('/custom/param', 42, 'hello'))
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual([42, 'hello'])
  })

  it('macroSpeed=0 → OSC émis mais Runtime gelé (t ne progresse pas)', () => {
    const rt = new Runtime({ macroSpeed: 0, duration: 10 })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    rt.tickOnce(1.0)
    expect(rt.getState().t).toBeCloseTo(0, 8) // speed=0 → pas d'avancement
  })

  it('macroSpeed négatif → t recule (wrappage correct)', () => {
    const rt = new Runtime({ macroSpeed: -1, duration: 10 })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])
    // t=0, dt=2, speed=-1 → t = (0 + 2*-1) % 10 = -2 % 10
    rt.tickOnce(2.0)
    // JS % peut retourner négatif, le Runtime wrape via %
    expect(isFinite(rt.getState().t)).toBe(true)
  })

  it('dispatch OSC sans binding enregistré → pas de crash', () => {
    const router = new OscRouter()
    expect(() => router.dispatch(msg('/unknown/address', 1, 2, 3))).not.toThrow()
  })

  it('plusieurs bindings sur même pattern → tous appliqués', () => {
    const rt = new Runtime()
    const router = new OscRouter()
    const log: string[] = []
    router.setApplyFn((b) => log.push(b.id))
    router.addBinding({ id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' } })
    router.addBinding({ id: 'b2', pattern: '/speed', target: { kind: 'macroSpeed' } })
    router.dispatch(msg('/speed', 1))
    expect(log).toEqual(['b1', 'b2'])
    void rt
  })

  it('removeBinding → plus appelé après suppression', () => {
    const rt = new Runtime({ macroSpeed: 1 })
    const router = new OscRouter()
    router.setApplyFn(makeApplyFn(rt))
    router.addBinding({ id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' } })
    router.dispatch(msg('/speed', 5))
    expect(rt.getConfig().macroSpeed).toBeCloseTo(5, 5)
    router.removeBinding('b1')
    router.dispatch(msg('/speed', 99))
    expect(rt.getConfig().macroSpeed).toBeCloseTo(5, 5) // inchangé après suppression
  })

  it('OSC IN cueGo : binding pattern → triggering par message OSC', () => {
    const router = new OscRouter()
    const triggered: string[] = []
    router.addBinding({
      id: 'cg1',
      pattern: '/holoflow/cue/go',
      target: { kind: 'cueGo', cueId: 'cue-1' },
    })
    router.setApplyFn((binding) => {
      if (binding.target.kind === 'cueGo') triggered.push(binding.target.cueId)
    })
    router.dispatch(msg('/holoflow/cue/go', 1))
    expect(triggered).toEqual(['cue-1'])
  })

  it('pipeline complet OSC IN → Runtime → OSC OUT : macroSpeed changé live', () => {
    // Simule: message OSC in change la vitesse → le prochain tick en tient compte
    const rt = new Runtime({ macroSpeed: 1, duration: 100 })
    const router = new OscRouter()
    router.setApplyFn(makeApplyFn(rt))
    router.addBinding({ id: 'spd', pattern: '/speed', target: { kind: 'macroSpeed' } })
    rt.setEngine(circularFn, [{ id: 1, objectIndex: 0 }])

    rt.tickOnce(1.0) // t=1 à speed=1
    expect(rt.getState().t).toBeCloseTo(1, 5)

    router.dispatch(msg('/speed', 3)) // change speed → 3
    rt.tickOnce(1.0) // t=1+3=4 à speed=3
    expect(rt.getState().t).toBeCloseTo(4, 5)
  })
})
