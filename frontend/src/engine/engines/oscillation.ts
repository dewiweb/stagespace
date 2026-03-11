import type { EngineDescriptor } from '../types'

export const oscillation: EngineDescriptor = {
  id: 'oscillation',
  label: 'Oscillation',
  defaultParams: { ampX: 1, ampY: 0, ampZ: 0, freqX: 1, freqY: 1, freqZ: 1, damping: 0, centerX: 0, centerY: 0, centerZ: 0 },
  paramMeta: {
    ampX:    { min: 0,   max: 10, step: 0.01, label: 'Amplitude X' },
    ampY:    { min: 0,   max: 10, step: 0.01, label: 'Amplitude Y' },
    ampZ:    { min: 0,   max: 10, step: 0.01, label: 'Amplitude Z' },
    freqX:   { min: 0.1, max: 10, step: 0.1,  label: 'Freq X' },
    freqY:   { min: 0.1, max: 10, step: 0.1,  label: 'Freq Y' },
    freqZ:   { min: 0.1, max: 10, step: 0.1,  label: 'Freq Z' },
    damping: { min: 0,   max: 5,  step: 0.01, label: 'Damping' },
    centerX: { min: -10, max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10, max: 10, step: 0.01, label: 'Center Y' },
    centerZ: { min: -10, max: 10, step: 0.01, label: 'Center Z' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI
    const t = ctx.t + phaseOffset
    const env = Math.exp(-p.damping * ctx.phase)
    return {
      x: Math.sin(p.freqX * t * Math.PI * 2) * p.ampX * env + p.centerX,
      y: Math.sin(p.freqY * t * Math.PI * 2) * p.ampY * env + p.centerY,
      z: Math.sin(p.freqZ * t * Math.PI * 2) * p.ampZ * env + p.centerZ,
    }
  },
}
