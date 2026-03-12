import type { RuntimeConfig, RuntimeState, TrackConfig, EngineCompiledFn, PositionFrame, EngineSlot, SlotPlayerState } from './types'
import type { Vector3 } from '../types'
import { getProfile } from './oscProfiles'

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
  profile: getProfile('holophonix'),
}

export type OSCSendFn = (address: string, args: number[]) => void
export type FrameCallback = (frames: PositionFrame[], t: number) => void

export class Runtime {
  private config: RuntimeConfig
  private state: RuntimeState
  private slots: EngineSlot[] = []
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

  /** Set multiple independent engine slots (multi-output support) */
  setSlots(slots: EngineSlot[]): void {
    // Preserve localT and playerState for slots that already exist (same playerNodeId)
    const prev = new Map(this.slots.map(s => [s.playerNodeId ?? s.tracks.map(t=>t.id).join(','), s]))
    this.slots = slots.map(s => {
      const key = s.playerNodeId ?? s.tracks.map(t=>t.id).join(',')
      const existing = prev.get(key)
      return {
        ...s,
        localT: existing?.localT ?? s.localT ?? 0,
        playerState: existing?.playerState ?? s.playerState ?? 'playing',
      }
    })
  }

  /** Set player state for a specific slot by playerNodeId */
  setSlotPlayerState(playerNodeId: string, state: SlotPlayerState): void {
    const slot = this.slots.find(s => s.playerNodeId === playerNodeId)
    if (!slot) return
    if (state === 'stopped') slot.localT = 0
    slot.playerState = state
  }

  /** Reset localT for a slot to 0 (rewind) */
  resetSlot(playerNodeId: string): void {
    const slot = this.slots.find(s => s.playerNodeId === playerNodeId)
    if (slot) slot.localT = 0
  }

  /** Backward-compat: single engine/tracks → slot[0] */
  setEngine(fn: EngineCompiledFn, tracks: TrackConfig[]): void {
    this.slots = [{ fn, tracks, duration: this.config.duration, playerState: 'playing', localT: 0 }]
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

    // Advance global time (always — used as fallback for slots without player)
    this.state.t += dt * this.config.macroSpeed
    this.state.ticks++

    if (this.slots.length === 0) return

    const frames: PositionFrame[] = []
    const { coordSystem, macroScale, macroShift, profile } = this.config

    for (const slot of this.slots) {
      // Per-slot time: use localT if slot has a player, else global t
      const hasPlayer = !!slot.playerNodeId
      const state = slot.playerState ?? 'playing'
      if (hasPlayer && state === 'playing') {
        slot.localT = (slot.localT ?? 0) + dt * this.config.macroSpeed
      }
      const tBase = hasPlayer ? (slot.localT ?? 0) : this.state.t
      // stopped slots: skip OSC dispatch entirely
      if (hasPlayer && state === 'stopped') continue
      const tWrapped = tBase % slot.duration
      for (const track of slot.tracks) {
        const raw = slot.fn(tWrapped, track.objectIndex, slot.tracks.length, slot.duration)
        const pos: Vector3 = {
          x: raw.x * macroScale.x + macroShift.x,
          y: raw.y * macroScale.y + macroShift.y,
          z: raw.z * macroScale.z + macroShift.z,
        }
        frames.push({ trackId: track.id, position: pos })
        if (this.sendOSC) {
          if (coordSystem === 'xyz') {
            for (const m of profile.xyzMessages(track.id, pos.x, pos.y, pos.z))
              this.sendOSC(m.address, m.args)
          } else {
            const aed = xyzToAed(pos)
            for (const m of profile.aedMessages(track.id, aed.a, aed.e, aed.d))
              this.sendOSC(m.address, m.args)
          }
        }
      }
    }

    if (this.onFrame) {
      this.onFrame(frames, this.state.t)
    }
  }

  /** For testing — execute a single tick manually without the scheduler. */
  tickOnce(dtSeconds = 1 / 60): PositionFrame[] {
    if (this.slots.length === 0) return []
    const dt = dtSeconds * this.config.macroSpeed
    this.state.t += dt
    this.state.ticks++
    // Advance localT for player slots that are playing
    for (const slot of this.slots) {
      if (slot.playerNodeId && (slot.playerState ?? 'playing') === 'playing') {
        slot.localT = (slot.localT ?? 0) + dt
      }
    }
    return this._computeAndDispatch()
  }

  private _computeAndDispatch(): PositionFrame[] {
    if (this.slots.length === 0) return []

    const frames: PositionFrame[] = []
    const { coordSystem, macroScale, macroShift, profile } = this.config

    for (const slot of this.slots) {
      const hasPlayer = !!slot.playerNodeId
      const state = slot.playerState ?? 'playing'
      if (hasPlayer && state === 'stopped') continue
      const tBase = hasPlayer ? (slot.localT ?? 0) : this.state.t
      const tWrapped = tBase % slot.duration
      for (const track of slot.tracks) {
        const raw = slot.fn(tWrapped, track.objectIndex, slot.tracks.length, slot.duration)
        const pos: Vector3 = {
          x: raw.x * macroScale.x + macroShift.x,
          y: raw.y * macroScale.y + macroShift.y,
          z: raw.z * macroScale.z + macroShift.z,
        }
        frames.push({ trackId: track.id, position: pos })
        if (this.sendOSC) {
          if (coordSystem === 'xyz') {
            for (const m of profile.xyzMessages(track.id, pos.x, pos.y, pos.z))
              this.sendOSC(m.address, m.args)
          } else {
            const aed = xyzToAed(pos)
            for (const m of profile.aedMessages(track.id, aed.a, aed.e, aed.d))
              this.sendOSC(m.address, m.args)
          }
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
