import type { FalloffDescriptor } from '../types'

export const constantFalloff: FalloffDescriptor = {
  id: 'math.constant',
  label: 'Constant',
  category: 'math',
  defaultParams: { value: 1 },
  paramMeta: {
    value: { min: 0, max: 1, step: 0.01, label: 'Value' },
  },
  fn: (_ctx, p) => p.value,
}

export const smoothstepFalloff: FalloffDescriptor = {
  id: 'math.smoothstep',
  label: 'Smoothstep',
  category: 'math',
  defaultParams: { input: 0.5, invert: 0 },
  paramMeta: {
    input:  { min: 0, max: 1, step: 0.01, label: 'Input (phase)' },
    invert: { min: 0, max: 1, step: 1,    label: 'Invert' },
  },
  fn: (ctx, p) => {
    const x = ctx.phase
    const v = x * x * (3 - 2 * x)
    return p.invert ? 1 - v : v
  },
}

export const remapFalloff: FalloffDescriptor = {
  id: 'math.remap',
  label: 'Remap',
  category: 'math',
  defaultParams: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: 1 },
  paramMeta: {
    inMin:  { min: -5, max: 5,  step: 0.01, label: 'In min' },
    inMax:  { min: -5, max: 5,  step: 0.01, label: 'In max' },
    outMin: { min: -5, max: 5,  step: 0.01, label: 'Out min' },
    outMax: { min: -5, max: 5,  step: 0.01, label: 'Out max' },
    clamp:  { min: 0,  max: 1,  step: 1,    label: 'Clamp' },
  },
  fn: (ctx, p) => {
    const inRange = p.inMax - p.inMin
    if (Math.abs(inRange) < 1e-9) return p.outMin
    const t = (ctx.phase - p.inMin) / inRange
    const tC = p.clamp ? Math.max(0, Math.min(1, t)) : t
    return p.outMin + tC * (p.outMax - p.outMin)
  },
}

export const mixFalloff: FalloffDescriptor = {
  id: 'math.mix',
  label: 'Mix (lerp)',
  category: 'math',
  defaultParams: { a: 0, b: 1, t: 0.5 },
  paramMeta: {
    a: { min: 0, max: 1, step: 0.01, label: 'A' },
    b: { min: 0, max: 1, step: 0.01, label: 'B' },
    t: { min: 0, max: 1, step: 0.01, label: 'Mix (t)' },
  },
  fn: (_ctx, p) => p.a + (p.b - p.a) * p.t,
}

export const multiplyFalloff: FalloffDescriptor = {
  id: 'math.multiply',
  label: 'Multiply',
  category: 'math',
  defaultParams: { factor: 1 },
  paramMeta: {
    factor: { min: -5, max: 5, step: 0.01, label: 'Factor' },
  },
  fn: (ctx, p) => ctx.phase * p.factor,
}

export const powerFalloff: FalloffDescriptor = {
  id: 'math.power',
  label: 'Power',
  category: 'math',
  defaultParams: { exponent: 2, invert: 0 },
  paramMeta: {
    exponent: { min: 0.1, max: 10, step: 0.1, label: 'Exponent' },
    invert:   { min: 0,   max: 1,  step: 1,   label: 'Invert' },
  },
  fn: (ctx, p) => {
    const v = Math.pow(Math.max(0, ctx.phase), p.exponent)
    return p.invert ? 1 - v : v
  },
}
