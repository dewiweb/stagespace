import type { EngineDescriptor } from '../types'

export const lissajous: EngineDescriptor = {
  id: 'lissajous',
  label: 'Lissajous',
  defaultParams: { freqX: 3, freqY: 2, freqZ: 1, phaseX: 0, phaseY: 1.5708, phaseZ: 0, radiusX: 1, radiusY: 1, radiusZ: 0.5, speed: 1 },
  paramMeta: {
    freqX:   { min: 0.5, max: 12, step: 0.5,  label: 'Freq X' },
    freqY:   { min: 0.5, max: 12, step: 0.5,  label: 'Freq Y' },
    freqZ:   { min: 0,   max: 12, step: 0.5,  label: 'Freq Z' },
    phaseX:  { min: 0,   max: Math.PI * 2, step: 0.01, label: 'Phase X' },
    phaseY:  { min: 0,   max: Math.PI * 2, step: 0.01, label: 'Phase Y' },
    phaseZ:  { min: 0,   max: Math.PI * 2, step: 0.01, label: 'Phase Z' },
    radiusX: { min: 0.01, max: 10, step: 0.01, label: 'Radius X' },
    radiusY: { min: 0.01, max: 10, step: 0.01, label: 'Radius Y' },
    radiusZ: { min: 0,    max: 10, step: 0.01, label: 'Radius Z' },
    speed:   { min: -5,   max: 5,  step: 0.01, label: 'Speed' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI * 0.5
    const t = ctx.phase * Math.PI * 2 * p.speed + phaseOffset
    return {
      x: Math.sin(p.freqX * t + p.phaseX) * p.radiusX,
      y: Math.sin(p.freqY * t + p.phaseY) * p.radiusY,
      z: Math.sin(p.freqZ * t + p.phaseZ) * p.radiusZ,
    }
  },
}
