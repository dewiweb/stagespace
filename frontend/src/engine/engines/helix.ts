import type { EngineDescriptor } from '../types'

export const helix: EngineDescriptor = {
  id: 'helix',
  label: 'Helix',
  defaultParams: { radius: 1, turns: 3, zStart: -1, zEnd: 1, speed: 1, centerX: 0, centerY: 0 },
  paramMeta: {
    radius:  { min: 0.01, max: 20, step: 0.01, label: 'Radius' },
    turns:   { min: 0.5,  max: 20, step: 0.5,  label: 'Turns' },
    zStart:  { min: -10,  max: 10, step: 0.01, label: 'Z Start' },
    zEnd:    { min: -10,  max: 10, step: 0.01, label: 'Z End' },
    speed:   { min: -5,   max: 5,  step: 0.01, label: 'Speed' },
    centerX: { min: -10,  max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10, step: 0.01, label: 'Center Y' },
  },
  fn(ctx, p) {
    const phaseOffset = ctx.objectIndex / ctx.objectCount
    const ph = (ctx.phase * p.speed + phaseOffset) % 1
    const angle = ph * Math.PI * 2 * p.turns
    return {
      x: Math.cos(angle) * p.radius + p.centerX,
      y: Math.sin(angle) * p.radius + p.centerY,
      z: p.zStart + (p.zEnd - p.zStart) * ph,
    }
  },
}
