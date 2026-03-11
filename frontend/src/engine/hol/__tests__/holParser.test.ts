import { describe, it, expect } from 'vitest'
import { parseHolFile } from '../HolParser'

const MINIMAL_HOL = JSON.stringify({
  hol: {
    '/layer/sources/ids': ['track1', 'track2', 'track3'],
    '/preset/name': ['TESTPROJECT'],
    '/station/version': ['1.6.2'],
    '/track/1/name': ['Kick'],
    '/track/1/color': [1.0, 0.0, 0.0, 1.0],
    '/track/1/visible': [true],
    '/track/2/name': ['Snare'],
    '/track/2/color': [0.0, 1.0, 0.0, 1.0],
    '/track/2/visible': [true],
    '/track/3/name': ['Bass'],
    '/track/3/color': [0.0, 0.0, 1.0, 1.0],
    '/track/3/visible': [false],
  }
})

const MULTI_LAYER_HOL = JSON.stringify({
  hol: {
    '/layer/sources/ids': ['track1', 'track2'],
    '/layer/abc123/ids': ['track3', 'track4'],
    '/layer/abc123/name': ['Hidden Layer'],
    '/track/1/name': ['A'],
    '/track/2/name': ['B'],
    '/track/3/name': ['C'],
    '/track/4/name': ['D'],
    '/preset/name': ['MULTI'],
    '/station/version': ['2.0.0'],
  }
})

describe('HolParser — basic', () => {
  it('parses a minimal .hol file', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.success).toBe(true)
    expect(r.project).toBeDefined()
  })

  it('extracts preset name', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.presetName).toBe('TESTPROJECT')
  })

  it('extracts station version', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.version).toBe('1.6.2')
  })

  it('extracts 3 tracks in order', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.tracks).toHaveLength(3)
    expect(r.project!.tracks[0].id).toBe(1)
    expect(r.project!.tracks[1].id).toBe(2)
    expect(r.project!.tracks[2].id).toBe(3)
  })

  it('extracts track names', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.tracks[0].name).toBe('Kick')
    expect(r.project!.tracks[1].name).toBe('Snare')
    expect(r.project!.tracks[2].name).toBe('Bass')
  })

  it('extracts track colors as RGBA', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.tracks[0].color).toEqual([1.0, 0.0, 0.0, 1.0])
    expect(r.project!.tracks[1].color).toEqual([0.0, 1.0, 0.0, 1.0])
  })

  it('extracts track visibility', () => {
    const r = parseHolFile(MINIMAL_HOL)
    expect(r.project!.tracks[0].visible).toBe(true)
    expect(r.project!.tracks[2].visible).toBe(false)
  })
})

describe('HolParser — multi-layer', () => {
  it('collects tracks from all layers', () => {
    const r = parseHolFile(MULTI_LAYER_HOL)
    expect(r.success).toBe(true)
    expect(r.project!.tracks).toHaveLength(4)
  })

  it('all track ids present', () => {
    const r = parseHolFile(MULTI_LAYER_HOL)
    const ids = r.project!.tracks.map(t => t.id).sort((a,b) => a-b)
    expect(ids).toEqual([1, 2, 3, 4])
  })
})

describe('HolParser — defaults', () => {
  it('uses fallback name when /track/N/name absent', () => {
    const hol = JSON.stringify({
      hol: {
        '/layer/sources/ids': ['track5'],
        '/preset/name': ['X'],
      }
    })
    const r = parseHolFile(hol)
    expect(r.project!.tracks[0].name).toBe('track5')
  })

  it('uses default color [0.5,0.5,0.5,1] when absent', () => {
    const hol = JSON.stringify({
      hol: {
        '/layer/sources/ids': ['track7'],
        '/preset/name': ['X'],
      }
    })
    const r = parseHolFile(hol)
    expect(r.project!.tracks[0].color).toEqual([0.5, 0.5, 0.5, 1])
  })

  it('defaults visible=true when absent', () => {
    const hol = JSON.stringify({
      hol: {
        '/layer/sources/ids': ['track2'],
        '/preset/name': ['X'],
      }
    })
    const r = parseHolFile(hol)
    expect(r.project!.tracks[0].visible).toBe(true)
  })
})

describe('HolParser — error handling', () => {
  it('fails on invalid JSON', () => {
    const r = parseHolFile('not json {{{')
    expect(r.success).toBe(false)
    expect(r.error).toContain('JSON parse error')
  })

  it('fails when hol key missing', () => {
    const r = parseHolFile(JSON.stringify({ foo: {} }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('"hol"')
  })

  it('fails when hol is not object', () => {
    const r = parseHolFile(JSON.stringify({ hol: 42 }))
    expect(r.success).toBe(false)
  })

  it('handles empty sources ids gracefully', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/layer/sources/ids': [], '/preset/name': ['EMPTY'] }
    }))
    expect(r.success).toBe(true)
    expect(r.project!.tracks).toHaveLength(0)
  })

  it('ignores non-track ids in sources', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/layer/sources/ids': ['track1', 'speaker2', 'bus3'], '/preset/name': ['X'] }
    }))
    expect(r.success).toBe(true)
    expect(r.project!.tracks).toHaveLength(1)
  })
})
