import type { EngineDescriptor } from '../../types'

interface SpringCache {
  frames: Float32Array
  nObjects: number
  nFrames: number
}

const cache = new Map<string, SpringCache>()

function buildSpring(n: number, duration: number, fps: number, stiffness: number, damping: number, targetX: number, targetY: number, targetZ: number): SpringCache {
  const nFrames = Math.ceil(duration * fps)
  const frames = new Float32Array(n * nFrames * 3)
  const rand = (seed: number) => { const x = Math.sin(seed) * 43758.5453; return x - Math.floor(x) }
  const dt = 1 / fps

  const pos = Array.from({ length: n }, (_, i) => ({
    x: (rand(i * 5 + 0) * 2 - 1) * 3,
    y: (rand(i * 5 + 1) * 2 - 1) * 3,
    z: (rand(i * 5 + 2) * 2 - 1) * 3,
    vx: 0, vy: 0, vz: 0,
  }))

  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < n; i++) {
      const p = pos[i]
      const ax = (targetX - p.x) * stiffness - p.vx * damping
      const ay = (targetY - p.y) * stiffness - p.vy * damping
      const az = (targetZ - p.z) * stiffness - p.vz * damping
      p.vx += ax * dt; p.vy += ay * dt; p.vz += az * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      frames[(f * n + i) * 3 + 0] = p.x
      frames[(f * n + i) * 3 + 1] = p.y
      frames[(f * n + i) * 3 + 2] = p.z
    }
  }
  return { frames, nObjects: n, nFrames }
}

export const spring: EngineDescriptor = {
  id: 'spring',
  label: 'Spring',
  defaultParams: { stiffness: 4, damping: 0.8, targetX: 0, targetY: 0, targetZ: 0 },
  paramMeta: {
    stiffness: { min: 0.1, max: 50,  step: 0.1,  label: 'Stiffness' },
    damping:   { min: 0,   max: 5,   step: 0.01, label: 'Damping' },
    targetX:   { min: -10, max: 10,  step: 0.01, label: 'Target X' },
    targetY:   { min: -10, max: 10,  step: 0.01, label: 'Target Y' },
    targetZ:   { min: -10, max: 10,  step: 0.01, label: 'Target Z' },
  },
  fn(ctx, p) {
    const FPS = 30
    const key = `${ctx.objectCount}_${ctx.duration.toFixed(1)}_${p.stiffness.toFixed(2)}_${p.damping.toFixed(2)}_${p.targetX.toFixed(2)}_${p.targetY.toFixed(2)}_${p.targetZ.toFixed(2)}`
    let sc = cache.get(key)
    if (!sc) {
      sc = buildSpring(ctx.objectCount, ctx.duration, FPS, p.stiffness, p.damping, p.targetX, p.targetY, p.targetZ)
      cache.set(key, sc)
    }
    const frame = Math.min(Math.floor(ctx.phase * sc.nFrames), sc.nFrames - 1)
    const base = (frame * sc.nObjects + ctx.objectIndex) * 3
    return { x: sc.frames[base], y: sc.frames[base + 1], z: sc.frames[base + 2] }
  },
}
