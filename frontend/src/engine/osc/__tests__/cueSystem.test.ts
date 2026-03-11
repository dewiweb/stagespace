import { describe, it, expect, vi } from 'vitest'
import { CueSystem } from '../CueSystem'

describe('CueSystem — record', () => {
  it('records a cue and returns it', () => {
    const cs = new CueSystem()
    const cue = cs.record([{ nodeId: 'n1', data: { radius: 1 } }])
    expect(cue.id).toBe('cue-1')
    expect(cue.snapshots).toHaveLength(1)
    expect(cue.snapshots[0].nodeId).toBe('n1')
  })

  it('auto-increments ids', () => {
    const cs = new CueSystem()
    const c1 = cs.record([])
    const c2 = cs.record([])
    expect(c1.id).toBe('cue-1')
    expect(c2.id).toBe('cue-2')
  })

  it('uses provided name', () => {
    const cs = new CueSystem()
    const c = cs.record([], 'Intro')
    expect(c.name).toBe('Intro')
  })

  it('generates default name when none given', () => {
    const cs = new CueSystem()
    const c = cs.record([])
    expect(c.name).toMatch(/Cue \d+/)
  })

  it('assigns a color', () => {
    const cs = new CueSystem()
    const c = cs.record([])
    expect(c.color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('CueSystem — getAll / get', () => {
  it('getAll returns cues in creation order', () => {
    const cs = new CueSystem()
    cs.record([], 'A')
    cs.record([], 'B')
    cs.record([], 'C')
    const all = cs.getAll()
    expect(all.map(c => c.name)).toEqual(['A', 'B', 'C'])
  })

  it('get returns cue by id', () => {
    const cs = new CueSystem()
    const c = cs.record([])
    expect(cs.get(c.id)?.id).toBe(c.id)
  })

  it('get returns undefined for unknown id', () => {
    const cs = new CueSystem()
    expect(cs.get('nonexistent')).toBeUndefined()
  })
})

describe('CueSystem — update', () => {
  it('updates name', () => {
    const cs = new CueSystem()
    const c = cs.record([], 'Old')
    const ok = cs.update(c.id, { name: 'New' })
    expect(ok).toBe(true)
    expect(cs.get(c.id)?.name).toBe('New')
  })

  it('returns false for unknown id', () => {
    const cs = new CueSystem()
    expect(cs.update('bad-id', { name: 'X' })).toBe(false)
  })
})

describe('CueSystem — delete', () => {
  it('deletes existing cue', () => {
    const cs = new CueSystem()
    const c = cs.record([])
    expect(cs.delete(c.id)).toBe(true)
    expect(cs.get(c.id)).toBeUndefined()
    expect(cs.getAll()).toHaveLength(0)
  })

  it('returns false for unknown id', () => {
    const cs = new CueSystem()
    expect(cs.delete('bad-id')).toBe(false)
  })
})

describe('CueSystem — go', () => {
  it('triggers onGo callback', () => {
    const cs = new CueSystem()
    const fn = vi.fn()
    cs.setOnGo(fn)
    const c = cs.record([{ nodeId: 'n1', data: { speed: 2 } }], 'Test')
    const ok = cs.go(c.id)
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledOnce()
    expect(fn.mock.calls[0][0].id).toBe(c.id)
  })

  it('returns false for unknown cue', () => {
    const cs = new CueSystem()
    expect(cs.go('nonexistent')).toBe(false)
  })

  it('goByIndex triggers correct cue', () => {
    const cs = new CueSystem()
    const fn = vi.fn()
    cs.setOnGo(fn)
    const c0 = cs.record([], 'A')
    cs.record([], 'B')
    const ok = cs.goByIndex(0)
    expect(ok).toBe(true)
    expect(fn.mock.calls[0][0].id).toBe(c0.id)
  })

  it('goByIndex out of bounds returns false', () => {
    const cs = new CueSystem()
    cs.record([])
    expect(cs.goByIndex(99)).toBe(false)
    expect(cs.goByIndex(-1)).toBe(false)
  })

  it('go without onGo set returns true (no crash)', () => {
    const cs = new CueSystem()
    const c = cs.record([])
    expect(() => cs.go(c.id)).not.toThrow()
  })
})

describe('CueSystem — clear', () => {
  it('removes all cues and resets counter', () => {
    const cs = new CueSystem()
    cs.record([])
    cs.record([])
    cs.clear()
    expect(cs.getAll()).toHaveLength(0)
    const c = cs.record([])
    expect(c.id).toBe('cue-1')   // counter reset
  })
})

describe('CueSystem — serialization', () => {
  it('toJSON / fromJSON round-trips cues', () => {
    const cs = new CueSystem()
    cs.record([{ nodeId: 'n1', data: { x: 42 } }], 'Alpha')
    cs.record([{ nodeId: 'n2', data: { y: 7  } }], 'Beta')
    const json = cs.toJSON()

    const cs2 = new CueSystem()
    cs2.fromJSON(json)
    const all = cs2.getAll()
    expect(all).toHaveLength(2)
    expect(all[0].name).toBe('Alpha')
    expect(all[1].name).toBe('Beta')
    expect(all[0].snapshots[0].data).toEqual({ x: 42 })
  })

  it('fromJSON restores counter so new cue gets correct id', () => {
    const cs = new CueSystem()
    cs.record([], 'A')  // cue-1
    cs.record([], 'B')  // cue-2
    const json = cs.toJSON()

    const cs2 = new CueSystem()
    cs2.fromJSON(json)
    const newCue = cs2.record([])
    expect(newCue.id).toBe('cue-3')
  })
})
