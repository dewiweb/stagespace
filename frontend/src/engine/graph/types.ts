import type { EngineCompiledFn } from '../runtime/types'

// ── Graph definition ─────────────────────────────────────────────────────────

export type NodeType =
  | 'objects'
  | 'duration'
  | 'output'
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

export interface CompileResult {
  success: boolean
  fn?: EngineCompiledFn
  objectCount: number
  duration: number
  issues: CompileIssue[]
  compileMs: number
}
