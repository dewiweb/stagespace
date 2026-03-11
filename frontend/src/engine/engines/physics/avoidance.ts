import type { EngineDescriptor } from '../../types'

interface AvoidCache {
  frames: Float32Array
  nObjects: number
  nFrames: number
}

const cache = new Map<string, AvoidCache>()

function buildAvoidance(
  n: number, duration: number, fps: number,
  repulsion: number, radius: number, maxSpeed: number
): AvoidCache {
  const nFrames = Math.ceil(duration * fps)
  const frames = new Float32Array(n * nFrames * 3)
  const rand = (seed: number) => { const x = Math.sin(seed) * 43758.5453; return x - Math.floor(x) }
  const dt = 1 / fps

  const pos = Array.from({ length: n }, (_, i) => ({
    x: (rand(i * 5 + 0) * 2 - 1) * 2,
    y: (rand(i * 5 + 1) * 2 - 1) * 2,
    z: (rand(i * 5 + 2) * 2 - 1) * 2,
    vx: (rand(i * 5 + 3) * 2 - 1) * maxSpeed * 0.3,
    vy: (rand(i * 5 + 4) * 2 - 1) * maxSpeed * 0.3,
    vz: 0,
  }))

  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < n; i++) {
      const p = pos[i]
      let fx = 0, fy = 0, fz = 0

      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const q = pos[j]
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
        if (dist < radius && dist > 0.001) {
          const force = repulsion / (dist * dist)
          fx += (dx / dist) * force
          fy += (dy / dist) * force
          fz += (dz / dist) * force
        }
      }

      p.vx += fx * dt; p.vy += fy * dt; p.vz += fz * dt
      const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy + p.vz*p.vz)
      if (speed > maxSpeed) {
        p.vx = (p.vx / speed) * maxSpeed
        p.vy = (p.vy / speed) * maxSpeed
        p.vz = (p.vz / speed) * maxSpeed
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt

      frames[(f * n + i) * 3 + 0] = p.x
      frames[(f * n + i) * 3 + 1] = p.y
      frames[(f * n + i) * 3 + 2] = p.z
    }
  }
  return { frames, nObjects: n, nFrames }
}

export const avoidance: EngineDescriptor = {
  id: 'avoidance',
  label: 'Avoidance',
  defaultParams: { repulsion: 2, radius: 1.5, maxSpeed: 3 },
  paramMeta: {
    repulsion: { min: 0.1, max: 20, step: 0.1, label: 'Repulsion Force' },
    radius:    { min: 0.1, max: 10, step: 0.1, label: 'Perception Radius' },
    maxSpeed:  { min: 0.1, max: 20, step: 0.1, label: 'Max Speed' },
  },
  fn(ctx, p) {
    const FPS = 30
    const key = `${ctx.objectCount}_${ctx.duration.toFixed(1)}_${p.repulsion.toFixed(2)}_${p.radius.toFixed(2)}_${p.maxSpeed.toFixed(2)}`
    let ac = cache.get(key)
    if (!ac) {
      ac = buildAvoidance(ctx.objectCount, ctx.duration, FPS, p.repulsion, p.radius, p.maxSpeed)
      cache.set(key, ac)
    }
    const frame = Math.min(Math.floor(ctx.phase * ac.nFrames), ac.nFrames - 1)
    const base = (frame * ac.nObjects + ctx.objectIndex) * 3
    return { x: ac.frames[base], y: ac.frames[base + 1], z: ac.frames[base + 2] }
  },
}
