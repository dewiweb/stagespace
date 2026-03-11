import { describe, it, expect } from 'vitest'
import { parseHolFile } from '../HolParser'

// ── Real format: ae array + mixerSoundElementOrder ────────────────────────────

const REAL_HOL = JSON.stringify({
  hol: {
    '/mixerSoundElementOrder': ['bus1', 'track1', 'track2', 'track3'],
    '/preset/name': ['TESTPROJECT'],
    '/station/version': ['1.6.2'],
  },
  ae: [
    '# comment line',
    '/track/1/name "Kick"',
    '/track/1/color 1.0 0.0 0.0 1.0',
    '/track/1/visible 1',
    '/track/1/azim 45.0',
    '/track/1/elev 10.0',
    '/track/1/dist 8.5',
    '/track/2/name "Snare"',
    '/track/2/color 0.0 1.0 0.0 1.0',
    '/track/2/visible 1',
    '/track/3/name "Bass"',
    '/track/3/color 0.0 0.0 1.0 1.0',
    '/track/3/visible 0',
  ],
})

// ── Old format: only hol object with array-wrapped values ─────────────────────

const OLD_HOL = JSON.stringify({
  hol: {
    '/mixerSoundElementOrder': ['track1', 'track2'],
    '/preset/name': ['OLDPROJECT'],
    '/station/version': ['1.2.0'],
    '/track/1/name': ['Violin'],
    '/track/1/color': [0.8, 0.2, 0.0, 1.0],
    '/track/1/visible': [true],
    '/track/2/name': ['Cello'],
    '/track/2/color': [0.0, 0.4, 0.8, 1.0],
    '/track/2/visible': [false],
  },
})

describe('HolParser — real format (ae array)', () => {
  it('parses successfully', () => {
    const r = parseHolFile(REAL_HOL)
    expect(r.success).toBe(true)
    expect(r.project).toBeDefined()
  })

  it('extracts preset name', () => {
    expect(parseHolFile(REAL_HOL).project!.presetName).toBe('TESTPROJECT')
  })

  it('extracts station version', () => {
    expect(parseHolFile(REAL_HOL).project!.version).toBe('1.6.2')
  })

  it('extracts 3 tracks in order', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks).toHaveLength(3)
    expect(tracks.map(t => t.id)).toEqual([1, 2, 3])
  })

  it('extracts track names from ae (strips quotes)', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks[0].name).toBe('Kick')
    expect(tracks[1].name).toBe('Snare')
    expect(tracks[2].name).toBe('Bass')
  })

  it('extracts track colors from ae', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks[0].color).toEqual([1.0, 0.0, 0.0, 1.0])
    expect(tracks[1].color).toEqual([0.0, 1.0, 0.0, 1.0])
  })

  it('extracts track visibility from ae', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks[0].visible).toBe(true)
    expect(tracks[2].visible).toBe(false)
  })

  it('extracts azim/elev/dist from ae', () => {
    const t = parseHolFile(REAL_HOL).project!.tracks[0]
    expect(t.azim).toBeCloseTo(45.0)
    expect(t.elev).toBeCloseTo(10.0)
    expect(t.dist).toBeCloseTo(8.5)
  })

  it('ignores comment lines in ae', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks).toHaveLength(3)
  })

  it('ignores non-track entries in mixerSoundElementOrder (bus1)', () => {
    const tracks = parseHolFile(REAL_HOL).project!.tracks
    expect(tracks.some(t => t.id === 0)).toBe(false)
  })
})

describe('HolParser — old format (hol object only)', () => {
  it('parses successfully without ae', () => {
    expect(parseHolFile(OLD_HOL).success).toBe(true)
  })

  it('extracts 2 tracks', () => {
    expect(parseHolFile(OLD_HOL).project!.tracks).toHaveLength(2)
  })

  it('extracts names from hol entries', () => {
    const tracks = parseHolFile(OLD_HOL).project!.tracks
    expect(tracks[0].name).toBe('Violin')
    expect(tracks[1].name).toBe('Cello')
  })

  it('extracts colors from hol entries', () => {
    const tracks = parseHolFile(OLD_HOL).project!.tracks
    expect(tracks[0].color[0]).toBeCloseTo(0.8)
  })

  it('extracts visibility from hol entries', () => {
    const tracks = parseHolFile(OLD_HOL).project!.tracks
    expect(tracks[0].visible).toBe(true)
    expect(tracks[1].visible).toBe(false)
  })
})

describe('HolParser — defaults', () => {
  it('uses fallback name track5 when absent', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/mixerSoundElementOrder': ['track5'], '/preset/name': ['X'] },
    }))
    expect(r.project!.tracks[0].name).toBe('track5')
  })

  it('uses default color [0.5,0.5,0.5,1] when absent', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/mixerSoundElementOrder': ['track7'], '/preset/name': ['X'] },
    }))
    expect(r.project!.tracks[0].color).toEqual([0.5, 0.5, 0.5, 1])
  })

  it('defaults visible=true when absent', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/mixerSoundElementOrder': ['track2'], '/preset/name': ['X'] },
    }))
    expect(r.project!.tracks[0].visible).toBe(true)
  })

  it('handles empty mixerSoundElementOrder gracefully', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/mixerSoundElementOrder': [], '/preset/name': ['EMPTY'] },
    }))
    expect(r.success).toBe(true)
    expect(r.project!.tracks).toHaveLength(0)
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

  it('ignores bus/speaker/stereo in mixerSoundElementOrder', () => {
    const r = parseHolFile(JSON.stringify({
      hol: { '/mixerSoundElementOrder': ['bus1', 'track1', 'speaker2', 'stereo1', 'multi1'] },
      ae: ['/track/1/name "Solo"'],
    }))
    expect(r.success).toBe(true)
    expect(r.project!.tracks).toHaveLength(1)
    expect(r.project!.tracks[0].name).toBe('Solo')
  })

  it('ae takes priority over hol for name/color', () => {
    const r = parseHolFile(JSON.stringify({
      hol: {
        '/mixerSoundElementOrder': ['track1'],
        '/track/1/name': ['HolName'],
        '/track/1/color': [0.1, 0.2, 0.3, 1.0],
      },
      ae: ['/track/1/name "AeName"', '/track/1/color 0.9 0.8 0.7 1.0'],
    }))
    expect(r.project!.tracks[0].name).toBe('AeName')
    expect(r.project!.tracks[0].color[0]).toBeCloseTo(0.9)
  })
})
