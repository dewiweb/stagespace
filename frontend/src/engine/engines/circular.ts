import type { EngineDescriptor } from '../types'

export const circular: EngineDescriptor = {
  id: 'circular',
  label: 'Circular',
  defaultParams: { radius: 1, speed: 1, centerX: 0, centerY: 0, centerZ: 0, tiltX: 0, tiltZ: 0 },
  paramMeta: {
    radius:  { min: 0.01, max: 20,  step: 0.01, label: 'Radius' },
    speed:   { min: -10,  max: 10,  step: 0.01, label: 'Speed' },
    centerX: { min: -10,  max: 10,  step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10,  step: 0.01, label: 'Center Y' },
    centerZ: { min: -10,  max: 10,  step: 0.01, label: 'Center Z' },
    tiltX:   { min: -Math.PI, max: Math.PI, step: 0.01, label: 'Tilt X' },
    tiltZ:   { min: -Math.PI, max: Math.PI, step: 0.01, label: 'Tilt Z' },
  },
  fn(ctx, p) {
    const phaseOffset = (ctx.objectIndex / ctx.objectCount) * Math.PI * 2
    const angle = ctx.phase * Math.PI * 2 * p.speed + phaseOffset
    const x = Math.cos(angle) * p.radius
    const y = Math.sin(angle) * p.radius
    // tilt around X axis
    const cosX = Math.cos(p.tiltX), sinX = Math.sin(p.tiltX)
    const ty = y * cosX
    const tz = y * sinX
    // tilt around Z axis
    const cosZ = Math.cos(p.tiltZ), sinZ = Math.sin(p.tiltZ)
    return {
      x: x * cosZ - ty * sinZ + p.centerX,
      y: x * sinZ + ty * cosZ + p.centerY,
      z: tz + p.centerZ,
    }
  },
}
