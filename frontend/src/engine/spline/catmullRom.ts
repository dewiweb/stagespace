import type { SplinePoint, Spline } from './types'
import type { Vector3 } from '../types'

// ── Catmull-Rom interpolation ─────────────────────────────────────────────────

function catmullRomSegment(
  p0: SplinePoint, p1: SplinePoint, p2: SplinePoint, p3: SplinePoint,
  t: number, tension: number,
): Vector3 {
  const a = tension
  const t2 = t * t
  const t3 = t2 * t

  // Catmull-Rom matrix coefficients
  const c0 =  -a * t3 + 2 * a * t2 - a * t
  const c1 =  (2 - a) * t3 + (a - 3) * t2 + 1
  const c2 =  (a - 2) * t3 + (3 - 2 * a) * t2 + a * t
  const c3 =  a * t3 - a * t2

  return {
    x: c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x,
    y: c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y,
    z: c0 * p0.z + c1 * p1.z + c2 * p2.z + c3 * p3.z,
  }
}

// ── Arc-length parameterization ───────────────────────────────────────────────
// Pre-computes a lookup table mapping uniform t ∈ [0,1] → position on spline

const LUT_STEPS = 200

interface SplineLUT {
  positions: Vector3[]      // sampled positions
  arcLengths: number[]      // cumulative arc length at each sample
  totalLength: number
}

function buildLUT(spline: Spline): SplineLUT {
  const pts = spline.points
  const n = pts.length
  if (n < 2) {
    const p = n === 1 ? pts[0] : { x: 0, y: 0, z: 0 }
    return { positions: [p], arcLengths: [0], totalLength: 0 }
  }

  const positions: Vector3[] = []
  const arcLengths: number[] = []
  let total = 0

  const numSegments = spline.closed ? n : n - 1

  for (let step = 0; step <= LUT_STEPS; step++) {
    const u = step / LUT_STEPS
    const pos = evaluateRaw(spline, u, numSegments)
    positions.push(pos)

    if (step === 0) {
      arcLengths.push(0)
    } else {
      const prev = positions[step - 1]
      const dx = pos.x - prev.x
      const dy = pos.y - prev.y
      const dz = pos.z - prev.z
      total += Math.sqrt(dx * dx + dy * dy + dz * dz)
      arcLengths.push(total)
    }
  }

  return { positions, arcLengths, totalLength: total }
}

// Evaluate raw Catmull-Rom at parameter u ∈ [0,1] (non arc-length)
function evaluateRaw(spline: Spline, u: number, numSegments: number): Vector3 {
  const pts = spline.points
  const n = pts.length
  const tension = spline.tension

  const segF = u * numSegments
  let seg = Math.floor(segF)
  let localT = segF - seg

  if (seg >= numSegments) { seg = numSegments - 1; localT = 1 }

  const getP = (i: number): SplinePoint => {
    if (spline.closed) {
      return pts[((i % n) + n) % n]
    }
    return pts[Math.max(0, Math.min(n - 1, i))]
  }

  return catmullRomSegment(
    getP(seg - 1), getP(seg), getP(seg + 1), getP(seg + 2),
    localT, tension,
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildSplineLUT(spline: Spline): SplineLUT {
  return buildLUT(spline)
}

/** Evaluate spline at arc-length-uniform t ∈ [0,1] */
export function evaluateSpline(lut: SplineLUT, t: number): Vector3 {
  if (lut.positions.length === 1) return lut.positions[0]

  const target = t * lut.totalLength
  // Binary search for the segment
  let lo = 0, hi = lut.arcLengths.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (lut.arcLengths[mid] < target) lo = mid
    else hi = mid
  }

  const lenLo = lut.arcLengths[lo]
  const lenHi = lut.arcLengths[hi]
  const span = lenHi - lenLo
  const blend = span < 1e-10 ? 0 : (target - lenLo) / span

  const a = lut.positions[lo]
  const b = lut.positions[hi]
  return {
    x: a.x + (b.x - a.x) * blend,
    y: a.y + (b.y - a.y) * blend,
    z: a.z + (b.z - a.z) * blend,
  }
}

/** Compute total arc length of a spline */
export function splineLength(lut: SplineLUT): number {
  return lut.totalLength
}
