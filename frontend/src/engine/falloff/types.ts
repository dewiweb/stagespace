import type { Vector3 } from '../types'

// ── Falloff context ───────────────────────────────────────────────────────────
// Provided at runtime to every falloff evaluation

export interface FalloffContext {
  t: number             // current time (seconds)
  duration: number      // cycle duration
  phase: number         // t / duration (0–1, wraps)
  objectIndex: number
  objectCount: number
  position: Vector3     // current object position (for spatial falloffs)
}

// ── Falloff function ──────────────────────────────────────────────────────────
// Returns a scalar 0–1 (can exceed range for some types)

export type FalloffFn = (ctx: FalloffContext, params: Record<string, number>) => number

export interface FalloffDescriptor {
  id: string
  label: string
  category: 'time' | 'spatial' | 'audio' | 'math'
  defaultParams: Record<string, number>
  paramMeta: Record<string, { min: number; max: number; step: number; label: string }>
  fn: FalloffFn
}
