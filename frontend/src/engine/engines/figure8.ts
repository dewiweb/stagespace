import type { EngineDescriptor } from '../types'

export const figure8: EngineDescriptor = {
  id: 'figure8',
  label: 'Figure 8',
  defaultParams: { radius: 1, speed: 1, tilt: 0, centerX: 0, centerY: 0, centerZ: 0 },
  paramMeta: {
    radius:  { min: 0.01, max: 20, step: 0.01, label: 'Radius' },
    speed:   { min: -5,   max: 5,  step: 0.01, label: 'Speed' },
    tilt:    { min: -Math.PI, max: Math.PI, step: 0.01, label: 'Tilt (Z→Y)' },
    centerX: { min: -10,  max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10, step: 0.01, label: 'Center Y' },
    centerZ: { min: -10,  max: 10, step: 0.01, label: 'Center Z' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI * 2
    const t = ctx.phase * Math.PI * 2 * p.speed + phaseOffset
    const denom = 1 + Math.sin(t) * Math.sin(t)
    const x = (Math.sin(t) / denom) * p.radius
    const y = (Math.sin(t) * Math.cos(t) / denom) * p.radius
    const cos = Math.cos(p.tilt), sin = Math.sin(p.tilt)
    return {
      x: x + p.centerX,
      y: y * cos + p.centerY,
      z: y * sin + p.centerZ,
    }
  },
}
