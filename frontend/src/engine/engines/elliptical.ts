import type { EngineDescriptor } from '../types'

export const elliptical: EngineDescriptor = {
  id: 'elliptical',
  label: 'Elliptical',
  defaultParams: { radiusX: 1.5, radiusY: 0.8, radiusZ: 0, speed: 1, centerX: 0, centerY: 0, centerZ: 0 },
  paramMeta: {
    radiusX: { min: 0.01, max: 20, step: 0.01, label: 'Radius X' },
    radiusY: { min: 0.01, max: 20, step: 0.01, label: 'Radius Y' },
    radiusZ: { min: 0,    max: 20, step: 0.01, label: 'Radius Z' },
    speed:   { min: -10,  max: 10, step: 0.01, label: 'Speed' },
    centerX: { min: -10,  max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10, step: 0.01, label: 'Center Y' },
    centerZ: { min: -10,  max: 10, step: 0.01, label: 'Center Z' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI * 2
    const angle = ctx.phase * Math.PI * 2 * p.speed + phaseOffset
    return {
      x: Math.cos(angle) * p.radiusX + p.centerX,
      y: Math.sin(angle) * p.radiusY + p.centerY,
      z: Math.sin(angle * 0.5) * p.radiusZ + p.centerZ,
    }
  },
}
