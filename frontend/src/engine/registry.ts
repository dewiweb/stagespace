import type { EngineDescriptor } from './types'

import { circular }    from './engines/circular'
import { elliptical }  from './engines/elliptical'
import { spiral }      from './engines/spiral'
import { lissajous }   from './engines/lissajous'
import { figure8 }     from './engines/figure8'
import { linear }      from './engines/linear'
import { oscillation } from './engines/oscillation'
import { perlinNoise } from './engines/perlinNoise'
import { formation }   from './engines/formation'
import { converge }    from './engines/converge'
import { pendulum }    from './engines/pendulum'
import { roseCurve }   from './engines/roseCurve'
import { helix }       from './engines/helix'
import { bouncing }    from './engines/physics/bouncing'
import { spring }      from './engines/physics/spring'
import { follow }      from './engines/physics/follow'
import { swarm }       from './engines/physics/swarm'
import { avoidance }   from './engines/physics/avoidance'

const ALL_ENGINES: EngineDescriptor[] = [
  circular, elliptical, spiral, lissajous, figure8,
  linear, oscillation, perlinNoise, formation, converge,
  pendulum, roseCurve, helix,
  bouncing, spring, follow, swarm, avoidance,
]

const REGISTRY = new Map<string, EngineDescriptor>(
  ALL_ENGINES.map(e => [e.id, e])
)

export function getEngine(id: string): EngineDescriptor | undefined {
  return REGISTRY.get(id)
}

export function getAllEngines(): EngineDescriptor[] {
  return ALL_ENGINES
}

export function getMathEngines(): EngineDescriptor[] {
  return [circular, elliptical, spiral, lissajous, figure8, linear, oscillation, perlinNoise, formation, converge, pendulum, roseCurve, helix]
}

export function getPhysicsEngines(): EngineDescriptor[] {
  return [bouncing, spring, follow, swarm, avoidance]
}
