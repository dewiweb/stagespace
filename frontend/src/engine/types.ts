export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface EngineContext {
  t: number          // temps en secondes depuis le début
  duration: number   // durée totale du cycle en secondes
  objectIndex: number
  objectCount: number
  phase: number      // t / duration normalisé [0,1]
  initialPosition?: Vector3  // position importée du .hol pour cet objet (XYZ cartésien)
}

export type EngineFunction = (ctx: EngineContext, params: Record<string, number>) => Vector3

export interface EngineDescriptor {
  id: string
  label: string
  fn: EngineFunction
  defaultParams: Record<string, number>
  paramMeta: Record<string, { min: number; max: number; step: number; label: string }>
}
