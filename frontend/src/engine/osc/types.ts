// ── OSC IN types ──────────────────────────────────────────────────────────────

export type OscValue = number | string | boolean

export interface OscMessage {
  address: string
  args: OscValue[]
  receivedAt: number   // performance.now()
}

export type OscHandler = (msg: OscMessage) => void

export interface OscBinding {
  id: string
  pattern: string           // e.g. "/holoflow/speed" or "/track/*/gain"
  target: OscBindingTarget
  min?: number
  max?: number
}

export type OscBindingTarget =
  | { kind: 'macroSpeed' }
  | { kind: 'macroScale'; axis: 'x' | 'y' | 'z' }
  | { kind: 'macroShift'; axis: 'x' | 'y' | 'z' }
  | { kind: 'nodeParam'; nodeId: string; param: string }
  | { kind: 'cueGo'; cueId: string }
  | { kind: 'custom'; fn: (args: OscValue[]) => void }
