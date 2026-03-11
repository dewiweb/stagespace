import type { Vector3 } from '../types'

export type CoordSystem = 'xyz' | 'aed'

export interface TrackConfig {
  id: number          // Holophonix track index (1-based)
  objectIndex: number // index within the engine (0-based)
}

export interface OSCProfile {
  name: string
  xyzAddress: (trackId: number) => string
  aedAddress: (trackId: number) => string
}

export interface RuntimeConfig {
  fps: number                    // target tick rate (default 60)
  duration: number               // cycle duration in seconds
  coordSystem: CoordSystem
  oscHost: string
  oscPort: number
  batchSize: number              // max OSC messages per tick before flush (0 = all)
  macroSpeed: number             // multiplier on time (default 1)
  macroScale: { x: number; y: number; z: number }  // position scale
  macroShift: { x: number; y: number; z: number }  // position offset
  profile: OSCProfile
}

export interface RuntimeState {
  running: boolean
  t: number           // current elapsed time in seconds (affected by macroSpeed)
  ticks: number       // total tick count
  lastTickMs: number  // timestamp of last tick (performance.now())
}

export interface PositionFrame {
  trackId: number
  position: Vector3
}

export type EngineCompiledFn = (t: number, objectIndex: number, objectCount: number, duration: number) => Vector3
