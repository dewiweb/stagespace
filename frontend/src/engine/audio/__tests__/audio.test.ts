import { describe, it, expect, vi } from 'vitest'
import { AudioAnalyser } from '../AudioAnalyser'
import type { AudioConfig } from '../types'
import { DEFAULT_AUDIO_CONFIG } from '../types'

// ── Mock AnalyserNode ─────────────────────────────────────────────────────────

function makeAnalyserMock(
  timeDomain: Float32Array,
  frequency: Float32Array,
  fftSize = 32,
): AnalyserNode {
  return {
    fftSize,
    smoothingTimeConstant: 0.8,
    getFloatTimeDomainData: vi.fn((buf: Float32Array) => buf.set(timeDomain.slice(0, buf.length))),
    getFloatFrequencyData:  vi.fn((buf: Float32Array) => buf.set(frequency.slice(0, buf.length))),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AnalyserNode
}

function makeCtxMock(sampleRate = 44100): AudioContext {
  return { sampleRate, close: vi.fn() } as unknown as AudioContext
}

// ── Default config for tests ──────────────────────────────────────────────────

const TEST_CONFIG: AudioConfig = {
  ...DEFAULT_AUDIO_CONFIG,
  fftSize: 32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnalyser(timeDomain: number[], frequency: number[], cfg = TEST_CONFIG) {
  const analyser = new AudioAnalyser(cfg)
  const td  = new Float32Array(cfg.fftSize).fill(0)
  const frq = new Float32Array(cfg.fftSize / 2).fill(-100)
  timeDomain.forEach((v, i) => { td[i] = v })
  frequency.forEach((v, i)  => { frq[i] = v })
  analyser._injectAnalyser(makeAnalyserMock(td, frq, cfg.fftSize), makeCtxMock())
  return analyser
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AudioAnalyser — amplitude', () => {
  it('silent signal → amplitude ≈ 0', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    a._process()
    expect(a.lastFrame.amplitude).toBeCloseTo(0, 3)
    expect(a.lastFrame.peak).toBeCloseTo(0, 3)
  })

  it('full-scale signal → amplitude > 0', () => {
    const td = Array.from({ length: 32 }, (_, i) => Math.sin(i * 0.5))
    const a  = makeAnalyser(td, new Array(16).fill(-100))
    a._process()
    expect(a.lastFrame.amplitude).toBeGreaterThan(0)
    expect(a.lastFrame.peak).toBeGreaterThan(0)
  })

  it('amplitude is capped at 1', () => {
    const td = new Array(32).fill(1.0)
    const a  = makeAnalyser(td, new Array(16).fill(0))
    a._process()
    expect(a.lastFrame.amplitude).toBeLessThanOrEqual(1)
    expect(a.lastFrame.peak).toBeLessThanOrEqual(1)
  })

  it('louder signal → higher amplitude', () => {
    const quiet = makeAnalyser(new Array(32).fill(0.1), new Array(16).fill(-100))
    const loud  = makeAnalyser(new Array(32).fill(0.8), new Array(16).fill(-100))
    quiet._process()
    loud._process()
    expect(loud.lastFrame.amplitude).toBeGreaterThan(quiet.lastFrame.amplitude)
  })
})

describe('AudioAnalyser — spectrum', () => {
  it('spectrum has fftSize/2 bins', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    a._process()
    expect(a.lastFrame.spectrum.length).toBe(16)
  })

  it('spectrum values match injected frequency data', () => {
    const freq = Array.from({ length: 16 }, (_, i) => -80 + i * 3)
    const a = makeAnalyser(new Array(32).fill(0), freq)
    a._process()
    // Values should be close to what was injected
    expect(a.lastFrame.spectrum[0]).toBeCloseTo(freq[0], 1)
    expect(a.lastFrame.spectrum[15]).toBeCloseTo(freq[15], 1)
  })
})

describe('AudioAnalyser — BPM detection', () => {
  it('initial BPM is 0', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    expect(a.lastFrame.bpm).toBe(0)
  })

  it('no beat on silence', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    a._process()
    expect(a.lastFrame.beat).toBe(false)
  })

  it('isRunning is true after inject', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    expect(a.isRunning).toBe(true)
  })

  it('stop() sets isRunning to false', () => {
    const a = makeAnalyser(new Array(32).fill(0), new Array(16).fill(-100))
    // stop() would normally close AudioContext — mock it
    a.stop()
    expect(a.isRunning).toBe(false)
  })
})

describe('AudioAnalyser — defaults', () => {
  it('DEFAULT_AUDIO_CONFIG has expected values', () => {
    expect(DEFAULT_AUDIO_CONFIG.fftSize).toBe(2048)
    expect(DEFAULT_AUDIO_CONFIG.smoothingTimeConstant).toBe(0.8)
    expect(DEFAULT_AUDIO_CONFIG.bpmWindowSeconds).toBe(4)
    expect(DEFAULT_AUDIO_CONFIG.beatThreshold).toBe(1.3)
  })

  it('AudioAnalyser accepts partial config override', () => {
    const a = new AudioAnalyser({ fftSize: 512 })
    expect(a).toBeDefined()
  })
})
