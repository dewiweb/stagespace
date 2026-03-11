import type { EngineDescriptor } from '../types'

export const linear: EngineDescriptor = {
  id: 'linear',
  label: 'Linear',
  defaultParams: { x0: -1, y0: 0, z0: 0, x1: 1, y1: 0, z1: 0, pingpong: 0 },
  paramMeta: {
    x0:       { min: -10, max: 10, step: 0.01, label: 'Start X' },
    y0:       { min: -10, max: 10, step: 0.01, label: 'Start Y' },
    z0:       { min: -10, max: 10, step: 0.01, label: 'Start Z' },
    x1:       { min: -10, max: 10, step: 0.01, label: 'End X' },
    y1:       { min: -10, max: 10, step: 0.01, label: 'End Y' },
    z1:       { min: -10, max: 10, step: 0.01, label: 'End Z' },
    pingpong: { min: 0,   max: 1,  step: 1,    label: 'Ping-Pong' },
  },
  fn(ctx, p) {
    const phaseOffset = ctx.objectIndex / ctx.objectCount
    let ph = (ctx.phase + phaseOffset) % 1
    if (p.pingpong >= 0.5) {
      ph = ph < 0.5 ? ph * 2 : (1 - ph) * 2
    }
    return {
      x: p.x0 + (p.x1 - p.x0) * ph,
      y: p.y0 + (p.y1 - p.y0) * ph,
      z: p.z0 + (p.z1 - p.z0) * ph,
    }
  },
}
