import type { EngineDescriptor } from '../../types'

interface SwarmCache {
  frames: Float32Array
  nObjects: number
  nFrames: number
}

const cache = new Map<string, SwarmCache>()

function buildSwarm(
  n: number, duration: number, fps: number,
  cohesion: number, separation: number, alignment: number,
  maxSpeed: number, perceptionRadius: number
): SwarmCache {
  const nFrames = Math.ceil(duration * fps)
  const frames = new Float32Array(n * nFrames * 3)
  const rand = (seed: number) => { const x = Math.sin(seed) * 43758.5453; return x - Math.floor(x) }
  const dt = 1 / fps

  const pos = Array.from({ length: n }, (_, i) => ({
    x: (rand(i * 7 + 0) * 2 - 1) * 3,
    y: (rand(i * 7 + 1) * 2 - 1) * 3,
    z: (rand(i * 7 + 2) * 2 - 1) * 3,
    vx: (rand(i * 7 + 3) * 2 - 1) * maxSpeed * 0.5,
    vy: (rand(i * 7 + 4) * 2 - 1) * maxSpeed * 0.5,
    vz: (rand(i * 7 + 5) * 2 - 1) * maxSpeed * 0.5,
  }))

  for (let f = 0; f < nFrames; f++) {
    // Compute boids forces
    for (let i = 0; i < n; i++) {
      const p = pos[i]
      let cx = 0, cy = 0, cz = 0  // cohesion center
      let sx = 0, sy = 0, sz = 0  // separation
      let ax = 0, ay = 0, az = 0  // alignment (avg velocity)
      let count = 0

      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const q = pos[j]
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
        if (dist < perceptionRadius && dist > 0) {
          cx += q.x; cy += q.y; cz += q.z
          sx -= dx / (dist * dist); sy -= dy / (dist * dist); sz -= dz / (dist * dist)
          ax += q.vx; ay += q.vy; az += q.vz
          count++
        }
      }

      if (count > 0) {
        cx /= count; cy /= count; cz /= count
        ax /= count; ay /= count; az /= count
        p.vx += (cx - p.x) * cohesion * dt + sx * separation * dt + (ax - p.vx) * alignment * dt
        p.vy += (cy - p.y) * cohesion * dt + sy * separation * dt + (ay - p.vy) * alignment * dt
        p.vz += (cz - p.z) * cohesion * dt + sz * separation * dt + (az - p.vz) * alignment * dt
      }

      // Clamp speed
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

export const swarm: EngineDescriptor = {
  id: 'swarm',
  label: 'Swarm (Boids)',
  defaultParams: { cohesion: 1, separation: 1.5, alignment: 0.5, maxSpeed: 2, perceptionRadius: 2 },
  paramMeta: {
    cohesion:          { min: 0, max: 10, step: 0.1,  label: 'Cohesion' },
    separation:        { min: 0, max: 10, step: 0.1,  label: 'Separation' },
    alignment:         { min: 0, max: 5,  step: 0.1,  label: 'Alignment' },
    maxSpeed:          { min: 0.1, max: 20, step: 0.1, label: 'Max Speed' },
    perceptionRadius:  { min: 0.1, max: 20, step: 0.1, label: 'Perception Radius' },
  },
  fn(ctx, p) {
    const FPS = 30
    const key = `${ctx.objectCount}_${ctx.duration.toFixed(1)}_${p.cohesion.toFixed(2)}_${p.separation.toFixed(2)}_${p.alignment.toFixed(2)}_${p.maxSpeed.toFixed(2)}_${p.perceptionRadius.toFixed(2)}`
    let sc = cache.get(key)
    if (!sc) {
      sc = buildSwarm(ctx.objectCount, ctx.duration, FPS, p.cohesion, p.separation, p.alignment, p.maxSpeed, p.perceptionRadius)
      cache.set(key, sc)
    }
    const frame = Math.min(Math.floor(ctx.phase * sc.nFrames), sc.nFrames - 1)
    const base = (frame * sc.nObjects + ctx.objectIndex) * 3
    return { x: sc.frames[base], y: sc.frames[base + 1], z: sc.frames[base + 2] }
  },
}
