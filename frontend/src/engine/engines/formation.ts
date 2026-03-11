import type { EngineDescriptor } from '../types'

export const formation: EngineDescriptor = {
  id: 'formation',
  label: 'Formation',
  defaultParams: { shape: 0, radius: 1, speed: 0, layers: 1, centerX: 0, centerY: 0, centerZ: 0 },
  paramMeta: {
    shape:   { min: 0, max: 2, step: 1,    label: 'Shape (0=circle 1=grid 2=sphere)' },
    radius:  { min: 0.01, max: 20, step: 0.01, label: 'Radius' },
    speed:   { min: -5,   max: 5,  step: 0.01, label: 'Rotation Speed' },
    layers:  { min: 1,    max: 8,  step: 1,    label: 'Layers' },
    centerX: { min: -10,  max: 10, step: 0.01, label: 'Center X' },
    centerY: { min: -10,  max: 10, step: 0.01, label: 'Center Y' },
    centerZ: { min: -10,  max: 10, step: 0.01, label: 'Center Z' },
  },
  fn(ctx, p) {
    const i = ctx.objectIndex
    const n = ctx.objectCount
    const spin = ctx.phase * Math.PI * 2 * p.speed
    const shape = Math.round(p.shape)

    if (shape === 0) {
      // circle
      const angle = (i / n) * Math.PI * 2 + spin
      return {
        x: Math.cos(angle) * p.radius + p.centerX,
        y: Math.sin(angle) * p.radius + p.centerY,
        z: p.centerZ,
      }
    } else if (shape === 1) {
      // grid
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      const col = i % cols
      const row = Math.floor(i / cols)
      const spacing = (p.radius * 2) / Math.max(cols - 1, 1)
      return {
        x: col * spacing - p.radius + p.centerX,
        y: row * spacing - (rows - 1) * spacing * 0.5 + p.centerY,
        z: p.centerZ,
      }
    } else {
      // sphere (fibonacci)
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const theta = goldenAngle * i + spin
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n)
      return {
        x: Math.sin(phi) * Math.cos(theta) * p.radius + p.centerX,
        y: Math.sin(phi) * Math.sin(theta) * p.radius + p.centerY,
        z: Math.cos(phi) * p.radius + p.centerZ,
      }
    }
  },
}
