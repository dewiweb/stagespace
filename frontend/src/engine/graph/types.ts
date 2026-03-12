import type { EngineCompiledFn } from '../runtime/types'

// ── Graph definition ─────────────────────────────────────────────────────────

export type NodeType =
  | 'objects'
  | 'duration'
  | 'output'
  | 'trackMap'
  | 'mix'
  | 'group'
  | 'sequence'
  | 'scale'
  | 'rotate'
  | 'offset'
  | 'phaseShift'
  | 'barycentricGroup'
  | string  // motion engine ids

export interface GraphNode {
  id: string
  type: NodeType
  data: Record<string, unknown>
}

export interface GraphEdge {
  id?: string
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ── Compilation result ───────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warning' | 'info'

export interface CompileIssue {
  level: IssueLevel
  code: string
  message: string
  nodeId?: string
}

export interface TrajSlot {
  fn: EngineCompiledFn
  objectCount: number
  duration: number
  outputNodeId: string
  trackIds?: number[]        // from trackMap node or Objects.trackIds (if set)
  initialPositions?: import('../types').Vector3[]  // from Objects.initialPositions (if useHolPositions)
  playerNodeId?: string      // ID du node player dans la chaîne (si présent)
}

export interface CompileResult {
  success: boolean
  fn?: EngineCompiledFn          // = slots[0].fn (backward compat)
  objectCount: number            // = slots[0].objectCount (backward compat)
  duration: number               // = slots[0].duration (backward compat)
  slots: TrajSlot[]              // all compiled output slots
  issues: CompileIssue[]
  compileMs: number
}
