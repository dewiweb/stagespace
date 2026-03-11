import type { EngineDescriptor } from '../types'

// Pendulum via RK4 integration — precomputed lookup table per param hash
const cache = new Map<string, Float64Array>()

function buildLUT(length: number, gravity: number, damping: number, angle0: number, steps = 2048): Float64Array {
  const lut = new Float64Array(steps * 2) // [angle, vel] per step
  let a = angle0, v = 0
  const dt = length / steps
  for (let i = 0; i < steps; i++) {
    lut[i * 2]     = a
    lut[i * 2 + 1] = v
    // RK4
    const k1a = v
    const k1v = -(gravity / length) * Math.sin(a) - damping * v
    const k2a = v + 0.5 * dt * k1v
    const k2v = -(gravity / length) * Math.sin(a + 0.5 * dt * k1a) - damping * (v + 0.5 * dt * k1v)
    const k3a = v + 0.5 * dt * k2v
    const k3v = -(gravity / length) * Math.sin(a + 0.5 * dt * k2a) - damping * (v + 0.5 * dt * k2v)
    const k4a = v + dt * k3v
    const k4v = -(gravity / length) * Math.sin(a + dt * k3a) - damping * (v + dt * k3v)
    a += (dt / 6) * (k1a + 2 * k2a + 2 * k3a + k4a)
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
  }
  return lut
}

export const pendulum: EngineDescriptor = {
  id: 'pendulum',
  label: 'Pendulum',
  defaultParams: { pendulumLength: 2, gravity: 9.8, damping: 0.1, angle0: 1.2, pivotX: 0, pivotY: 0, pivotZ: 1 },
  paramMeta: {
    pendulumLength: { min: 0.1, max: 10,  step: 0.01, label: 'Pendulum Length' },
    gravity:        { min: 0.1, max: 20,  step: 0.1,  label: 'Gravity' },
    damping:        { min: 0,   max: 2,   step: 0.01, label: 'Damping' },
    angle0:         { min: -Math.PI, max: Math.PI, step: 0.01, label: 'Initial Angle' },
    pivotX:         { min: -10, max: 10,  step: 0.01, label: 'Pivot X' },
    pivotY:         { min: -10, max: 10,  step: 0.01, label: 'Pivot Y' },
    pivotZ:         { min: -10, max: 10,  step: 0.01, label: 'Pivot Z' },
  },
  fn(ctx, p) {
    const STEPS = 2048
    const key = `${p.pendulumLength.toFixed(3)}_${p.gravity.toFixed(3)}_${p.damping.toFixed(3)}_${p.angle0.toFixed(3)}`
    let lut = cache.get(key)
    if (!lut) {
      lut = buildLUT(ctx.duration, p.gravity, p.damping, p.angle0, STEPS)
      cache.set(key, lut)
    }
    // Per-object phase offset
    const phaseOffset = ctx.objectIndex / ctx.objectCount
    const tNorm = ((ctx.phase + phaseOffset) % 1)
    const idx = Math.min(Math.floor(tNorm * STEPS), STEPS - 1)
    const angle = lut[idx * 2]
    return {
      x: Math.sin(angle) * p.pendulumLength + p.pivotX,
      y: p.pivotY,
      z: -Math.cos(angle) * p.pendulumLength + p.pivotZ,
    }
  },
}
