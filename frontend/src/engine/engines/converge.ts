import type { EngineDescriptor } from '../types'

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

export const converge: EngineDescriptor = {
  id: 'converge',
  label: 'Converge',
  defaultParams: {
    targetX: 0, targetY: 0, targetZ: 0,
    spreadRadius: 2, speed: 1, pingpong: 1,
  },
  paramMeta: {
    targetX:      { min: -10,  max: 10, step: 0.01, label: 'Target X' },
    targetY:      { min: -10,  max: 10, step: 0.01, label: 'Target Y' },
    targetZ:      { min: -10,  max: 10, step: 0.01, label: 'Target Z' },
    spreadRadius: { min: 0.01, max: 20, step: 0.01, label: 'Spread Radius' },
    speed:        { min: 0.1,  max: 10, step: 0.01, label: 'Speed' },
    pingpong:     { min: 0,    max: 1,  step: 1,    label: 'Ping-Pong' },
  },
  fn(ctx, p) {
    // Each object starts on a sphere and converges to target
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const theta = goldenAngle * ctx.objectIndex
    const phi = Math.acos(1 - (2 * (ctx.objectIndex + 0.5)) / ctx.objectCount)
    const ox = Math.sin(phi) * Math.cos(theta) * p.spreadRadius
    const oy = Math.sin(phi) * Math.sin(theta) * p.spreadRadius
    const oz = Math.cos(phi) * p.spreadRadius

    let ph = (ctx.phase * p.speed) % 1
    if (p.pingpong >= 0.5) {
      ph = ph < 0.5 ? ph * 2 : (1 - ph) * 2
    }
    const t = easeInOut(ph)

    return {
      x: ox + (p.targetX - ox) * t,
      y: oy + (p.targetY - oy) * t,
      z: oz + (p.targetZ - oz) * t,
    }
  },
}
