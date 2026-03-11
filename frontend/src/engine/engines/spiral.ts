import type { EngineDescriptor } from '../types'

export const spiral: EngineDescriptor = {
  id: 'spiral',
  label: 'Spiral',
  defaultParams: { radiusStart: 0.1, radiusEnd: 2, turns: 3, speed: 1, zStart: -1, zEnd: 1, centerX: 0, centerY: 0 },
  paramMeta: {
    radiusStart: { min: 0,   max: 20, step: 0.01, label: 'Radius Start' },
    radiusEnd:   { min: 0,   max: 20, step: 0.01, label: 'Radius End' },
    turns:       { min: 0.5, max: 20, step: 0.5,  label: 'Turns' },
    speed:       { min: -5,  max: 5,  step: 0.01, label: 'Speed' },
    zStart:      { min: -10, max: 10, step: 0.01, label: 'Z Start' },
    zEnd:        { min: -10, max: 10, step: 0.01, label: 'Z End' },
    centerX:     { min: -10, max: 10, step: 0.01, label: 'Center X' },
    centerY:     { min: -10, max: 10, step: 0.01, label: 'Center Y' },
  },
  fn(ctx, p) {
    const phaseOffset = ctx.objectIndex / ctx.objectCount
    const ph = ((ctx.phase * p.speed) + phaseOffset) % 1
    const angle = ph * Math.PI * 2 * p.turns
    const r = p.radiusStart + (p.radiusEnd - p.radiusStart) * ph
    return {
      x: Math.cos(angle) * r + p.centerX,
      y: Math.sin(angle) * r + p.centerY,
      z: p.zStart + (p.zEnd - p.zStart) * ph,
    }
  },
}
