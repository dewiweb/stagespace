import type { RuntimeConfig, RuntimeState, TrackConfig, EngineCompiledFn, PositionFrame } from './types'
import type { Vector3 } from '../types'

const DEFAULT_CONFIG: RuntimeConfig = {
  fps: 60,
  duration: 10,
  coordSystem: 'xyz',
  oscHost: '127.0.0.1',
  oscPort: 8000,
  batchSize: 0,
  macroSpeed: 1,
  macroScale: { x: 1, y: 1, z: 1 },
  macroShift: { x: 0, y: 0, z: 0 },
  profile: {
    name: 'Holophonix',
    xyzAddress: (id) => `/track/${id}/xyz`,
    aedAddress: (id) => `/track/${id}/aed`,
  },
}

export type OSCSendFn = (address: string, args: number[]) => void
export type FrameCallback = (frames: PositionFrame[], t: number) => void

export class Runtime {
  private config: RuntimeConfig
  private state: RuntimeState
  private tracks: TrackConfig[] = []
  private engineFn: EngineCompiledFn | null = null
  private sendOSC: OSCSendFn | null = null
  private onFrame: FrameCallback | null = null
  private rafId: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<RuntimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      running: false,
      t: 0,
      ticks: 0,
      lastTickMs: 0,
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setEngine(fn: EngineCompiledFn, tracks: TrackConfig[]): void {
    this.engineFn = fn
    this.tracks = tracks
  }

  setOSCSender(fn: OSCSendFn): void {
    this.sendOSC = fn
  }

  setFrameCallback(fn: FrameCallback): void {
    this.onFrame = fn
  }

  updateConfig(patch: Partial<RuntimeConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  start(): void {
    if (this.state.running) return
    this.state.running = true
    this.state.lastTickMs = performance.now()
    this._scheduleTick()
  }

  stop(): void {
    this.state.running = false
    if (this.rafId !== null) {
      clearInterval(this.rafId)
      this.rafId = null
    }
  }

  reset(): void {
    this.stop()
    this.state.t = 0
    this.state.ticks = 0
  }

  getState(): Readonly<RuntimeState> {
    return { ...this.state }
  }

  getConfig(): Readonly<RuntimeConfig> {
    return { ...this.config }
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  private _scheduleTick(): void {
    const intervalMs = 1000 / this.config.fps
    this.rafId = setInterval(() => {
      if (!this.state.running) return
      this._tick()
    }, intervalMs)
  }

  /** Compute one frame and dispatch OSC + callbacks. */
  private _tick(): void {
    const now = performance.now()
    const dt = (now - this.state.lastTickMs) / 1000
    this.state.lastTickMs = now

    // Advance time with macroSpeed, wrap within duration
    this.state.t = (this.state.t + dt * this.config.macroSpeed) % this.config.duration
    this.state.ticks++

    if (!this.engineFn || this.tracks.length === 0) return

    const frames: PositionFrame[] = []
    const n = this.tracks.length
    const { duration, coordSystem, macroScale, macroShift, profile } = this.config

    for (const track of this.tracks) {
      const raw = this.engineFn(this.state.t, track.objectIndex, n, duration)
      const pos: Vector3 = {
        x: raw.x * macroScale.x + macroShift.x,
        y: raw.y * macroScale.y + macroShift.y,
        z: raw.z * macroScale.z + macroShift.z,
      }
      frames.push({ trackId: track.id, position: pos })

      if (this.sendOSC) {
        if (coordSystem === 'xyz') {
          this.sendOSC(profile.xyzAddress(track.id), [pos.x, pos.y, pos.z])
        } else {
          const aed = xyzToAed(pos)
          this.sendOSC(profile.aedAddress(track.id), [aed.a, aed.e, aed.d])
        }
      }
    }

    if (this.onFrame) {
      this.onFrame(frames, this.state.t)
    }
  }

  /** For testing — execute a single tick manually without the scheduler. */
  tickOnce(dtSeconds = 1 / 60): PositionFrame[] {
    if (!this.engineFn || this.tracks.length === 0) return []
    this.state.t = (this.state.t + dtSeconds * this.config.macroSpeed) % this.config.duration
    this.state.ticks++
    return this._computeAndDispatch()
  }

  private _computeAndDispatch(): PositionFrame[] {
    if (!this.engineFn || this.tracks.length === 0) return []

    const frames: PositionFrame[] = []
    const n = this.tracks.length
    const { duration, coordSystem, macroScale, macroShift, profile } = this.config

    for (const track of this.tracks) {
      const raw = this.engineFn(this.state.t, track.objectIndex, n, duration)
      const pos: Vector3 = {
        x: raw.x * macroScale.x + macroShift.x,
        y: raw.y * macroScale.y + macroShift.y,
        z: raw.z * macroScale.z + macroShift.z,
      }
      frames.push({ trackId: track.id, position: pos })

      if (this.sendOSC) {
        if (coordSystem === 'xyz') {
          this.sendOSC(profile.xyzAddress(track.id), [pos.x, pos.y, pos.z])
        } else {
          const aed = xyzToAed(pos)
          this.sendOSC(profile.aedAddress(track.id), [aed.a, aed.e, aed.d])
        }
      }
    }

    if (this.onFrame) this.onFrame(frames, this.state.t)
    return frames
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function xyzToAed(pos: Vector3): { a: number; e: number; d: number } {
  const d = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z)
  if (d < 1e-9) return { a: 0, e: 0, d: 0 }
  const a = Math.atan2(pos.y, pos.x) * (180 / Math.PI)
  const e = Math.asin(pos.z / d) * (180 / Math.PI)
  return { a, e, d }
}

export function aedToXyz(a: number, e: number, d: number): Vector3 {
  const ar = a * (Math.PI / 180)
  const er = e * (Math.PI / 180)
  return {
    x: d * Math.cos(er) * Math.cos(ar),
    y: d * Math.cos(er) * Math.sin(ar),
    z: d * Math.sin(er),
  }
}
