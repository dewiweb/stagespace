import type { Vector3 } from '../types'

export interface SplinePoint {
  x: number
  y: number
  z: number
}

export interface Spline {
  points: SplinePoint[]
  closed:  boolean
  tension: number   // Catmull-Rom tension (0.5 = standard)
}

export type SplineFn = (t: number) => Vector3
