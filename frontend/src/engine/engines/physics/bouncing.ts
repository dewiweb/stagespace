import type { EngineDescriptor } from '../../types'

// Bouncing uses a precomputed lookup table per config
// Position and velocity are integrated at build time

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number }

interface BounceCache {
  frames: Float32Array  // n_objects * n_frames * 3 (x,y,z)
  nObjects: number
  nFrames: number
}

const cache = new Map<string, BounceCache>()

function buildBounce(
  n: number, duration: number, fps: number,
  container: number, shape: number, restitution: number, speed: number
): BounceCache {
  const nFrames = Math.ceil(duration * fps)
  const frames = new Float32Array(n * nFrames * 3)
  const particles: Particle[] = []
  const rand = (seed: number) => { const x = Math.sin(seed) * 43758.5453; return x - Math.floor(x) }

  for (let i = 0; i < n; i++) {
    particles.push({
      x: (rand(i * 3 + 0) * 2 - 1) * container * 0.5,
      y: (rand(i * 3 + 1) * 2 - 1) * container * 0.5,
      z: (rand(i * 3 + 2) * 2 - 1) * container * 0.5,
      vx: (rand(i * 7 + 0) * 2 - 1) * speed,
      vy: (rand(i * 7 + 1) * 2 - 1) * speed,
      vz: (rand(i * 7 + 2) * 2 - 1) * speed,
    })
  }

  const dt = 1 / fps
  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < n; i++) {
      const p = particles[i]
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      const r = container
      if (shape === 0) {
        // box
        if (p.x >  r) { p.x =  r; p.vx = -Math.abs(p.vx) * restitution }
        if (p.x < -r) { p.x = -r; p.vx =  Math.abs(p.vx) * restitution }
        if (p.y >  r) { p.y =  r; p.vy = -Math.abs(p.vy) * restitution }
        if (p.y < -r) { p.y = -r; p.vy =  Math.abs(p.vy) * restitution }
        if (p.z >  r) { p.z =  r; p.vz = -Math.abs(p.vz) * restitution }
        if (p.z < -r) { p.z = -r; p.vz =  Math.abs(p.vz) * restitution }
      } else {
        // sphere
        const dist = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z)
        if (dist > r) {
          const nx = p.x/dist, ny = p.y/dist, nz = p.z/dist
          const dot = p.vx*nx + p.vy*ny + p.vz*nz
          p.vx = (p.vx - 2*dot*nx) * restitution
          p.vy = (p.vy - 2*dot*ny) * restitution
          p.vz = (p.vz - 2*dot*nz) * restitution
          p.x = nx*r; p.y = ny*r; p.z = nz*r
        }
      }
      frames[(f * n + i) * 3 + 0] = p.x
      frames[(f * n + i) * 3 + 1] = p.y
      frames[(f * n + i) * 3 + 2] = p.z
    }
  }
  return { frames, nObjects: n, nFrames }
}

export const bouncing: EngineDescriptor = {
  id: 'bouncing',
  label: 'Bouncing',
  defaultParams: { container: 2, shape: 0, restitution: 0.85, speed: 2 },
  paramMeta: {
    container:   { min: 0.1, max: 20,  step: 0.1,  label: 'Container Size' },
    shape:       { min: 0,   max: 1,   step: 1,    label: 'Shape (0=box 1=sphere)' },
    restitution: { min: 0.1, max: 1,   step: 0.01, label: 'Restitution' },
    speed:       { min: 0.1, max: 20,  step: 0.1,  label: 'Speed' },
  },
  fn(ctx, p) {
    const FPS = 30
    const key = `${ctx.objectCount}_${ctx.duration.toFixed(1)}_${p.container.toFixed(2)}_${p.shape}_${p.restitution.toFixed(2)}_${p.speed.toFixed(2)}`
    let bc = cache.get(key)
    if (!bc) {
      bc = buildBounce(ctx.objectCount, ctx.duration, FPS, p.container, Math.round(p.shape), p.restitution, p.speed)
      cache.set(key, bc)
    }
    const frame = Math.min(Math.floor(ctx.phase * bc.nFrames), bc.nFrames - 1)
    const base = (frame * bc.nObjects + ctx.objectIndex) * 3
    return { x: bc.frames[base], y: bc.frames[base + 1], z: bc.frames[base + 2] }
  },
}
