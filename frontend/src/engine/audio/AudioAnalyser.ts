import type { AudioFrame, AudioConfig } from './types'
import { DEFAULT_AUDIO_CONFIG } from './types'

// ── BPM detector (onset/beat tracker) ────────────────────────────────────────
// Uses spectral flux on the low-frequency band to detect onsets, then
// estimates BPM from the inter-onset interval histogram.

class BpmDetector {
  private readonly windowMs: number
  private readonly threshold: number
  private prevEnergy = 0
  private beatTimes: number[] = []
  private lastBeatMs = 0
  private _currentBpm = 0
  private _beat = false

  constructor(windowSeconds: number, threshold: number) {
    this.windowMs   = windowSeconds * 1000
    this.threshold  = threshold
  }

  /** Call on every audio frame with the current low-freq RMS and timestamp */
  update(energy: number, nowMs: number): void {
    this._beat = false

    const delta = energy - this.prevEnergy
    this.prevEnergy = energy

    // Onset detection — positive spectral flux above threshold
    if (delta > 0 && energy > this.threshold * 0.05) {
      const gap = nowMs - this.lastBeatMs
      if (gap > 200) {   // min 300 BPM hard cap
        this.lastBeatMs = nowMs
        this.beatTimes.push(nowMs)
        this._beat = true

        // Prune old beats outside the analysis window
        const cutoff = nowMs - this.windowMs
        while (this.beatTimes.length > 1 && this.beatTimes[0] < cutoff) {
          this.beatTimes.shift()
        }

        // Estimate BPM from average inter-beat interval
        if (this.beatTimes.length >= 2) {
          const first = this.beatTimes[0]
          const last  = this.beatTimes[this.beatTimes.length - 1]
          const avgInterval = (last - first) / (this.beatTimes.length - 1)
          const raw = 60000 / avgInterval
          // Snap to musical range 60–200 BPM (octave-fold)
          let bpm = raw
          while (bpm > 200) bpm /= 2
          while (bpm < 60 && bpm > 0) bpm *= 2
          this._currentBpm = Math.round(bpm)
        }
      }
    }
  }

  get bpm(): number { return this._currentBpm }
  get beat(): boolean { return this._beat }

  reset(): void {
    this.prevEnergy = 0
    this.beatTimes  = []
    this.lastBeatMs = 0
    this._currentBpm = 0
    this._beat = false
  }
}

// ── AudioAnalyser ─────────────────────────────────────────────────────────────

export class AudioAnalyser {
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null

  private timeDomainBuf: Float32Array<ArrayBuffer> = new Float32Array(0) as Float32Array<ArrayBuffer>
  private freqBuf: Float32Array<ArrayBuffer> = new Float32Array(0) as Float32Array<ArrayBuffer>

  private bpmDetector: BpmDetector
  private _lastFrame: AudioFrame
  private _running = false
  private config: AudioConfig

  private rafId = 0

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...DEFAULT_AUDIO_CONFIG, ...config }
    this.bpmDetector = new BpmDetector(
      this.config.bpmWindowSeconds,
      this.config.beatThreshold,
    )
    this._lastFrame = {
      amplitude: 0, peak: 0, bpm: 0, beat: false,
      spectrum: new Float32Array(this.config.fftSize / 2),
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get isRunning(): boolean { return this._running }
  get lastFrame(): AudioFrame { return this._lastFrame }

  async start(deviceId?: string): Promise<void> {
    if (this._running) return

    this.ctx = new AudioContext()
    const audioConstraints: boolean | MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : true
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false })
    this.source = this.ctx.createMediaStreamSource(this.stream)

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = this.config.fftSize
    this.analyser.smoothingTimeConstant = this.config.smoothingTimeConstant
    this.source.connect(this.analyser)

    const fftHalf = this.config.fftSize / 2
    this.timeDomainBuf = new Float32Array(this.config.fftSize) as Float32Array<ArrayBuffer>
    this.freqBuf       = new Float32Array(fftHalf) as Float32Array<ArrayBuffer>
    this._lastFrame    = { ...this._lastFrame, spectrum: new Float32Array(fftHalf) }

    this._running = true
    this._loop()
  }

  stop(): void {
    this._running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.source?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close()
    this.ctx = null
    this.source = null
    this.analyser = null
    this.stream = null
    this.bpmDetector.reset()
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _loop = (): void => {
    if (!this._running) return
    this.rafId = requestAnimationFrame(this._loop)
    this._process()
  }

  _process(): void {
    if (!this.analyser) return
    this.analyser.getFloatTimeDomainData(this.timeDomainBuf)
    this.analyser.getFloatFrequencyData(this.freqBuf)

    // RMS amplitude
    let sumSq = 0
    let peak  = 0
    for (let i = 0; i < this.timeDomainBuf.length; i++) {
      const s = this.timeDomainBuf[i]
      sumSq += s * s
      if (Math.abs(s) > peak) peak = Math.abs(s)
    }
    const rms = Math.sqrt(sumSq / this.timeDomainBuf.length)

    // Low-band energy for BPM (bins 0–20: ~0–550 Hz at 44.1 kHz)
    const sampleRate = this.ctx?.sampleRate ?? 44100
    const binHz = sampleRate / this.config.fftSize
    const bassEnd = Math.min(Math.floor(300 / binHz), this.freqBuf.length - 1)
    let bassSum = 0
    for (let i = 0; i <= bassEnd; i++) {
      // freqBuf is in dB; convert back to linear
      const lin = Math.pow(10, this.freqBuf[i] / 20)
      bassSum += lin * lin
    }
    const bassEnergy = Math.sqrt(bassSum / (bassEnd + 1))

    this.bpmDetector.update(bassEnergy, performance.now())

    this._lastFrame = {
      amplitude: Math.min(1, rms * 3),    // scale up typical speech/music RMS
      peak:      Math.min(1, peak),
      bpm:       this.bpmDetector.bpm,
      beat:      this.bpmDetector.beat,
      spectrum:  new Float32Array(this.freqBuf),
    }
  }

  // ── Test helpers (exposed for unit tests) ───────────────────────────────────

  _injectAnalyser(a: AnalyserNode, ctx: AudioContext): void {
    this.analyser = a
    this.ctx = ctx
    this.timeDomainBuf = new Float32Array(a.fftSize) as Float32Array<ArrayBuffer>
    this.freqBuf = new Float32Array(a.fftSize / 2) as Float32Array<ArrayBuffer>
    this._lastFrame = { ...this._lastFrame, spectrum: new Float32Array(a.fftSize / 2) }
    this._running = true
  }
}
