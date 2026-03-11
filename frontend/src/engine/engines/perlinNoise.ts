import type { EngineDescriptor } from '../types'

// Lightweight deterministic Perlin-like noise via harmonic superposition
function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453123
  return x - Math.floor(x)
}

function smoothNoise(t: number, seed: number): number {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  return hash(i + seed) * (1 - u) + hash(i + 1 + seed) * u
}

function fractalNoise(t: number, seed: number, octaves: number): number {
  let v = 0, amp = 1, freq = 1, total = 0
  for (let o = 0; o < octaves; o++) {
    v += smoothNoise(t * freq, seed + o * 17.3) * amp
    total += amp
    amp *= 0.5
    freq *= 2
  }
  return (v / total) * 2 - 1
}

export const perlinNoise: EngineDescriptor = {
  id: 'perlinNoise',
  label: 'Perlin Noise',
  defaultParams: { scale: 1, speed: 0.5, octaves: 3, seedX: 0, seedY: 31.7, seedZ: 67.1 },
  paramMeta: {
    scale:   { min: 0.01, max: 10, step: 0.01, label: 'Scale' },
    speed:   { min: 0,    max: 5,  step: 0.01, label: 'Speed' },
    octaves: { min: 1,    max: 6,  step: 1,    label: 'Octaves' },
    seedX:   { min: 0,    max: 100, step: 0.1, label: 'Seed X' },
    seedY:   { min: 0,    max: 100, step: 0.1, label: 'Seed Y' },
    seedZ:   { min: 0,    max: 100, step: 0.1, label: 'Seed Z' },
  },
  fn(ctx, p) {
    const objSeed = ctx.objectIndex * 137.508
    const tDriven = ctx.t * p.speed
    const oct = Math.max(1, Math.round(p.octaves))
    return {
      x: fractalNoise(tDriven + objSeed, p.seedX, oct) * p.scale,
      y: fractalNoise(tDriven + objSeed, p.seedY, oct) * p.scale,
      z: fractalNoise(tDriven + objSeed, p.seedZ, oct) * p.scale,
    }
  },
}
