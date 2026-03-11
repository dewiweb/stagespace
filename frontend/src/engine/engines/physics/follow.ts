import type { EngineDescriptor } from '../../types'

interface FollowCache {
  frames: Float32Array
  nObjects: number
  nFrames: number
}

const cache = new Map<string, FollowCache>()

function buildFollow(n: number, duration: number, fps: number, delay: number, leaderRadius: number, leaderSpeed: number): FollowCache {
  const nFrames = Math.ceil(duration * fps)
  const frames = new Float32Array(n * nFrames * 3)
  const delayFrames = Math.round(delay * fps)

  // Leader follows a circle
  const leaderX = new Float32Array(nFrames + delayFrames * n)
  const leaderY = new Float32Array(nFrames + delayFrames * n)
  const leaderZ = new Float32Array(nFrames + delayFrames * n)
  const total = nFrames + delayFrames * n
  for (let f = 0; f < total; f++) {
    const t = f / fps
    const angle = t * Math.PI * 2 * leaderSpeed
    leaderX[f] = Math.cos(angle) * leaderRadius
    leaderY[f] = Math.sin(angle) * leaderRadius
    leaderZ[f] = 0
  }

  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < n; i++) {
      const srcFrame = Math.max(0, f + delayFrames * (n - 1 - i))
      frames[(f * n + i) * 3 + 0] = leaderX[srcFrame]
      frames[(f * n + i) * 3 + 1] = leaderY[srcFrame]
      frames[(f * n + i) * 3 + 2] = leaderZ[srcFrame]
    }
  }
  return { frames, nObjects: n, nFrames }
}

export const follow: EngineDescriptor = {
  id: 'follow',
  label: 'Follow',
  defaultParams: { delay: 0.3, leaderRadius: 1.5, leaderSpeed: 0.5 },
  paramMeta: {
    delay:        { min: 0.05, max: 5,  step: 0.05, label: 'Delay (s)' },
    leaderRadius: { min: 0.1,  max: 20, step: 0.1,  label: 'Leader Radius' },
    leaderSpeed:  { min: -5,   max: 5,  step: 0.1,  label: 'Leader Speed' },
  },
  fn(ctx, p) {
    const FPS = 30
    const key = `${ctx.objectCount}_${ctx.duration.toFixed(1)}_${p.delay.toFixed(2)}_${p.leaderRadius.toFixed(2)}_${p.leaderSpeed.toFixed(2)}`
    let fc = cache.get(key)
    if (!fc) {
      fc = buildFollow(ctx.objectCount, ctx.duration, FPS, p.delay, p.leaderRadius, p.leaderSpeed)
      cache.set(key, fc)
    }
    const frame = Math.min(Math.floor(ctx.phase * fc.nFrames), fc.nFrames - 1)
    const base = (frame * fc.nObjects + ctx.objectIndex) * 3
    return { x: fc.frames[base], y: fc.frames[base + 1], z: fc.frames[base + 2] }
  },
}
