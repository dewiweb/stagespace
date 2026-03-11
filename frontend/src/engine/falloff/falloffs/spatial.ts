import type { FalloffDescriptor } from '../types'

export const pointDistanceFalloff: FalloffDescriptor = {
  id: 'spatial.pointDistance',
  label: 'Point Distance',
  category: 'spatial',
  defaultParams: { cx: 0, cy: 0, cz: 0, radius: 1, invert: 0, exponent: 1 },
  paramMeta: {
    cx:       { min: -5, max: 5,  step: 0.05, label: 'Center X' },
    cy:       { min: -5, max: 5,  step: 0.05, label: 'Center Y' },
    cz:       { min: -5, max: 5,  step: 0.05, label: 'Center Z' },
    radius:   { min: 0.01, max: 10, step: 0.05, label: 'Radius' },
    invert:   { min: 0, max: 1, step: 1, label: 'Invert' },
    exponent: { min: 0.1, max: 5, step: 0.1, label: 'Exponent' },
  },
  fn: (ctx, p) => {
    const dx = ctx.position.x - p.cx
    const dy = ctx.position.y - p.cy
    const dz = ctx.position.z - p.cz
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
    const r = Math.max(p.radius, 1e-6)
    const v = Math.pow(Math.max(0, 1 - dist / r), p.exponent)
    return p.invert ? 1 - v : v
  },
}

export const axisDistanceFalloff: FalloffDescriptor = {
  id: 'spatial.axisDistance',
  label: 'Axis Distance',
  category: 'spatial',
  defaultParams: { axis: 0, center: 0, radius: 1, invert: 0 },
  paramMeta: {
    axis:   { min: 0, max: 2, step: 1, label: 'Axis (0=X 1=Y 2=Z)' },
    center: { min: -5, max: 5, step: 0.05, label: 'Center' },
    radius: { min: 0.01, max: 10, step: 0.05, label: 'Radius' },
    invert: { min: 0, max: 1, step: 1, label: 'Invert' },
  },
  fn: (ctx, p) => {
    const axis = Math.round(p.axis) as 0 | 1 | 2
    const comp = [ctx.position.x, ctx.position.y, ctx.position.z][axis]
    const dist = Math.abs(comp - p.center)
    const r = Math.max(p.radius, 1e-6)
    const v = Math.max(0, 1 - dist / r)
    return p.invert ? 1 - v : v
  },
}

export const objectIndexFalloff: FalloffDescriptor = {
  id: 'spatial.objectIndex',
  label: 'Object Index',
  category: 'spatial',
  defaultParams: { invert: 0, exponent: 1 },
  paramMeta: {
    invert:   { min: 0, max: 1, step: 1, label: 'Invert' },
    exponent: { min: 0.1, max: 5, step: 0.1, label: 'Exponent' },
  },
  fn: (ctx, p) => {
    const n = Math.max(ctx.objectCount - 1, 1)
    const v = Math.pow(ctx.objectIndex / n, p.exponent)
    return p.invert ? 1 - v : v
  },
}

export const randomPerObjectFalloff: FalloffDescriptor = {
  id: 'spatial.randomPerObject',
  label: 'Random Per Object',
  category: 'spatial',
  defaultParams: { seed: 42, min: 0, max: 1 },
  paramMeta: {
    seed: { min: 0, max: 9999, step: 1, label: 'Seed' },
    min:  { min: 0, max: 1,    step: 0.01, label: 'Min' },
    max:  { min: 0, max: 1,    step: 0.01, label: 'Max' },
  },
  fn: (ctx, p) => {
    // Deterministic per-object hash
    const h = Math.sin(ctx.objectIndex * 127.1 + p.seed * 311.7) * 43758.5453123
    const v = h - Math.floor(h)
    return p.min + v * (p.max - p.min)
  },
}
