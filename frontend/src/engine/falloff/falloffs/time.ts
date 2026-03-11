import type { FalloffDescriptor } from '../types'

export const linearTimeFalloff: FalloffDescriptor = {
  id: 'time.linear',
  label: 'Linear Time',
  category: 'time',
  defaultParams: { invert: 0 },
  paramMeta: {
    invert: { min: 0, max: 1, step: 1, label: 'Invert' },
  },
  fn: (ctx, p) => {
    const v = ctx.phase
    return p.invert ? 1 - v : v
  },
}

export const sineTimeFalloff: FalloffDescriptor = {
  id: 'time.sine',
  label: 'Sine Time',
  category: 'time',
  defaultParams: { frequency: 1, phase: 0, invert: 0 },
  paramMeta: {
    frequency: { min: 0.1, max: 20, step: 0.1, label: 'Frequency' },
    phase:     { min: 0,   max: 1,  step: 0.01, label: 'Phase offset' },
    invert:    { min: 0,   max: 1,  step: 1,    label: 'Invert' },
  },
  fn: (ctx, p) => {
    const angle = (ctx.phase * p.frequency + p.phase) * Math.PI * 2
    const v = (Math.sin(angle) + 1) / 2
    return p.invert ? 1 - v : v
  },
}

export const pulseTimeFalloff: FalloffDescriptor = {
  id: 'time.pulse',
  label: 'Pulse Time',
  category: 'time',
  defaultParams: { frequency: 2, width: 0.5, smoothness: 0.05 },
  paramMeta: {
    frequency:  { min: 0.1, max: 20,  step: 0.1,  label: 'Frequency' },
    width:      { min: 0,   max: 1,   step: 0.01, label: 'Duty cycle' },
    smoothness: { min: 0,   max: 0.5, step: 0.01, label: 'Smoothness' },
  },
  fn: (ctx, p) => {
    const t = ((ctx.phase * p.frequency) % 1 + 1) % 1
    const w = p.width
    const s = Math.max(p.smoothness, 1e-4)
    // Smoothstep pulse
    if (t < s)         return t / s
    if (t < w - s)     return 1
    if (t < w)         return 1 - (t - (w - s)) / s
    if (t < 1 - s)     return 0
    return (t - (1 - s)) / s  // rising edge at end of period
  },
}

export const rampTimeFalloff: FalloffDescriptor = {
  id: 'time.ramp',
  label: 'Ramp Time',
  category: 'time',
  defaultParams: { start: 0, end: 1, clamp: 1 },
  paramMeta: {
    start: { min: 0, max: 1, step: 0.01, label: 'Start (phase)' },
    end:   { min: 0, max: 1, step: 0.01, label: 'End (phase)' },
    clamp: { min: 0, max: 1, step: 1,    label: 'Clamp' },
  },
  fn: (ctx, p) => {
    const { start, end } = p
    if (Math.abs(end - start) < 1e-6) return 0
    const v = (ctx.phase - start) / (end - start)
    return p.clamp ? Math.max(0, Math.min(1, v)) : v
  },
}

export const staggerTimeFalloff: FalloffDescriptor = {
  id: 'time.stagger',
  label: 'Stagger Time',
  category: 'time',
  defaultParams: { offset: 0.1, invert: 0 },
  paramMeta: {
    offset: { min: 0, max: 1, step: 0.01, label: 'Per-object offset' },
    invert: { min: 0, max: 1, step: 1,    label: 'Invert' },
  },
  fn: (ctx, p) => {
    const n = Math.max(ctx.objectCount, 1)
    const perObj = (ctx.objectIndex / n) * p.offset
    const v = ((ctx.phase + perObj) % 1 + 1) % 1
    return p.invert ? 1 - v : v
  },
}
