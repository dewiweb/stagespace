import type { FalloffDescriptor } from './types'
import { linearTimeFalloff, sineTimeFalloff, pulseTimeFalloff, rampTimeFalloff, staggerTimeFalloff } from './falloffs/time'
import { pointDistanceFalloff, axisDistanceFalloff, objectIndexFalloff, randomPerObjectFalloff } from './falloffs/spatial'
import { constantFalloff, smoothstepFalloff, remapFalloff, mixFalloff, multiplyFalloff, powerFalloff } from './falloffs/math'

const ALL: FalloffDescriptor[] = [
  linearTimeFalloff, sineTimeFalloff, pulseTimeFalloff, rampTimeFalloff, staggerTimeFalloff,
  pointDistanceFalloff, axisDistanceFalloff, objectIndexFalloff, randomPerObjectFalloff,
  constantFalloff, smoothstepFalloff, remapFalloff, mixFalloff, multiplyFalloff, powerFalloff,
]

const BY_ID = new Map<string, FalloffDescriptor>(ALL.map(f => [f.id, f]))

export function getFalloff(id: string): FalloffDescriptor | undefined {
  return BY_ID.get(id)
}

export function getAllFalloffs(): FalloffDescriptor[] {
  return ALL
}

export function getFalloffsByCategory(cat: FalloffDescriptor['category']): FalloffDescriptor[] {
  return ALL.filter(f => f.category === cat)
}
