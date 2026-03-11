import { describe, it, expect, vi } from 'vitest'
import { OscRouter } from '../OscRouter'
import type { OscMessage, OscBinding } from '../types'

function msg(address: string, ...args: (number | string)[]): OscMessage {
  return { address, args, receivedAt: 0 }
}

describe('OscRouter — pattern matching', () => {
  it('exact match dispatches handler', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/test/address', fn)
    r.dispatch(msg('/test/address', 1))
    expect(fn).toHaveBeenCalledOnce()
  })

  it('no match — handler not called', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/test/other', fn)
    r.dispatch(msg('/test/address'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('wildcard * matches single segment', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/track/*/gain', fn)
    r.dispatch(msg('/track/1/gain'))
    r.dispatch(msg('/track/99/gain'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('wildcard * does not match multiple segments', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/track/*/gain', fn)
    r.dispatch(msg('/track/1/2/gain'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('wildcard ** matches multiple segments', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/track/**', fn)
    r.dispatch(msg('/track/1/gain'))
    r.dispatch(msg('/track/2/sub/param'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('multiple handlers on same pattern all called', () => {
    const r = new OscRouter()
    const f1 = vi.fn(), f2 = vi.fn()
    r.on('/speed', f1)
    r.on('/speed', f2)
    r.dispatch(msg('/speed', 0.5))
    expect(f1).toHaveBeenCalledOnce()
    expect(f2).toHaveBeenCalledOnce()
  })

  it('off() removes handler', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/speed', fn)
    r.off('/speed', fn)
    r.dispatch(msg('/speed', 1))
    expect(fn).not.toHaveBeenCalled()
  })

  it('unsubscribe fn from on() removes handler', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    const unsub = r.on('/speed', fn)
    unsub()
    r.dispatch(msg('/speed', 1))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('OscRouter — message delivery', () => {
  it('handler receives full message', () => {
    const r = new OscRouter()
    let received: OscMessage | null = null
    r.on('/test', (m) => { received = m })
    const m = msg('/test', 42, 'hello')
    r.dispatch(m)
    expect(received).toEqual(m)
  })

  it('clear() removes all handlers', () => {
    const r = new OscRouter()
    const fn = vi.fn()
    r.on('/a', fn)
    r.on('/b', fn)
    r.clear()
    r.dispatch(msg('/a'))
    r.dispatch(msg('/b'))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('OscRouter — bindings', () => {
  it('addBinding / getBindings', () => {
    const r = new OscRouter()
    const b: OscBinding = { id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' } }
    r.addBinding(b)
    expect(r.getBindings()).toHaveLength(1)
    expect(r.getBindings()[0].id).toBe('b1')
  })

  it('removeBinding removes it', () => {
    const r = new OscRouter()
    r.addBinding({ id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' } })
    r.removeBinding('b1')
    expect(r.getBindings()).toHaveLength(0)
  })

  it('applyFn is called on matching binding', () => {
    const r = new OscRouter()
    const apply = vi.fn()
    r.setApplyFn(apply)
    r.addBinding({ id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' }, min: 0, max: 2 })
    r.dispatch(msg('/speed', 1.0))
    expect(apply).toHaveBeenCalledOnce()
    const [binding, args] = apply.mock.calls[0]
    expect(binding.id).toBe('b1')
    expect(args).toEqual([1.0])
  })

  it('applyFn not called if pattern does not match', () => {
    const r = new OscRouter()
    const apply = vi.fn()
    r.setApplyFn(apply)
    r.addBinding({ id: 'b1', pattern: '/speed', target: { kind: 'macroSpeed' } })
    r.dispatch(msg('/gain', 0.5))
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('OscRouter.normalize', () => {
  it('normalizes value within range', () => {
    const b: OscBinding = { id: 'b', pattern: '/', target: { kind: 'macroSpeed' }, min: 0, max: 100 }
    expect(OscRouter.normalize([50], b)).toBeCloseTo(0.5, 5)
  })

  it('clamps below min to 0', () => {
    const b: OscBinding = { id: 'b', pattern: '/', target: { kind: 'macroSpeed' }, min: 10, max: 20 }
    expect(OscRouter.normalize([5], b)).toBe(0)
  })

  it('clamps above max to 1', () => {
    const b: OscBinding = { id: 'b', pattern: '/', target: { kind: 'macroSpeed' }, min: 0, max: 10 }
    expect(OscRouter.normalize([20], b)).toBe(1)
  })

  it('defaults min=0 max=1 when not set', () => {
    const b: OscBinding = { id: 'b', pattern: '/', target: { kind: 'macroSpeed' } }
    expect(OscRouter.normalize([0.7], b)).toBeCloseTo(0.7, 5)
  })

  it('returns 0 for non-numeric first arg', () => {
    const b: OscBinding = { id: 'b', pattern: '/', target: { kind: 'macroSpeed' }, min: 0, max: 1 }
    expect(OscRouter.normalize(['hello'], b)).toBe(0)
  })
})
