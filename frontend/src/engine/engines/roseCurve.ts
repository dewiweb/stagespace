import type { EngineDescriptor } from '../types'

export const roseCurve: EngineDescriptor = {
  id: 'roseCurve',
  label: 'Rose Curve',
  defaultParams: { k: 3, radius: 1, speed: 1, centerX: 0, centerY: 0, centerZ: 0, tilt: 0 },
  paramMeta: {
    k:       { min: 1,    max: 12, step: 1,    label: 'Petals (k)' },
    radius:  { min: 0.01, max: 20, step: 0.01, label: 'Radius' },
    speed:   { min: -5,   max: 5,  step: 0.01, label: 'Speed' },
    centerX: { min: -10,  max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10, step: 0.01, label: 'Center Y' },
    centerZ: { min: -10,  max: 10, step: 0.01, label: 'Center Z' },
    tilt:    { min: -Math.PI, max: Math.PI, step: 0.01, label: 'Tilt' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI * 2
    const theta = ctx.phase * Math.PI * 2 * p.speed + phaseOffset
    const r = Math.cos(p.k * theta) * p.radius
    const x = r * Math.cos(theta)
    const y = r * Math.sin(theta)
    const cos = Math.cos(p.tilt), sin = Math.sin(p.tilt)
    return {
      x: x + p.centerX,
      y: y * cos + p.centerY,
      z: y * sin + p.centerZ,
    }
  },
}
