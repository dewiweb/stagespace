// ─── Port type system ─────────────────────────────────────────────────────────

export type PortType = 'objects' | 'duration' | 'trajectory' | 'params' | 'any'

export const PORT_COLORS: Record<PortType, string> = {
  objects:    '#9b5cf6',  // violet
  duration:   '#d4a017',  // gold
  trajectory: '#22c55e',  // green
  params:     '#4b7fbf',  // blue
  any:        '#888888',  // grey
}

export const PORT_LABELS: Record<PortType, string> = {
  objects:    'Objects',
  duration:   'Duration',
  trajectory: 'Trajectory',
  params:     'Params',
  any:        'Any',
}

// Port handle ID convention: "{in|out}-{type}[-{index}]"
// e.g. "in-objects", "out-trajectory", "in-trajectory-0", "in-trajectory-1"

export interface PortDef {
  id: string        // handle id
  type: PortType
  label: string
  multi?: boolean   // accepts multiple connections (target only)
}

// ─── Node port schemas ────────────────────────────────────────────────────────

export interface NodePortSchema {
  inputs:  PortDef[]
  outputs: PortDef[]
}

export const MOTION_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-objects',  type: 'objects',  label: 'Objects' },
    { id: 'in-duration', type: 'duration', label: 'Duration' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Trajectory' },
  ],
}

export const OBJECTS_PORT_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [
    { id: 'out-objects', type: 'objects', label: 'Objects' },
  ],
}

export const DURATION_PORT_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [
    { id: 'out-duration', type: 'duration', label: 'Duration' },
  ],
}

export const OUTPUT_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory', type: 'trajectory', label: 'Trajectory' },
  ],
  outputs: [],
}

export const MERGE_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory-0', type: 'trajectory', label: 'A' },
    { id: 'in-trajectory-1', type: 'trajectory', label: 'B' },
    { id: 'in-duration',     type: 'duration',   label: 'Duration' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Trajectory' },
  ],
}

export const MIX_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory-0', type: 'trajectory', label: 'A' },
    { id: 'in-trajectory-1', type: 'trajectory', label: 'B' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Mixed' },
  ],
}

export const GROUP_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory-0', type: 'trajectory', label: 'A' },
    { id: 'in-trajectory-1', type: 'trajectory', label: 'B' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Combined' },
  ],
}

export const SEQUENCE_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory-0', type: 'trajectory', label: 'First' },
    { id: 'in-trajectory-1', type: 'trajectory', label: 'Then' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Sequence' },
  ],
}

export const TRANSFORM_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-trajectory', type: 'trajectory', label: 'Trajectory' },
  ],
  outputs: [
    { id: 'out-trajectory', type: 'trajectory', label: 'Trajectory' },
  ],
}

// ─── Connection validation ─────────────────────────────────────────────────────

export function getPortType(handleId: string | null | undefined): PortType | null {
  if (!handleId) return null
  // handle id = "{in|out}-{type}" or "{in|out}-{type}-{index}"
  const parts = handleId.split('-')
  if (parts.length < 2) return null
  const t = parts[1] as PortType
  return PORT_COLORS[t] ? t : null
}

export function portsCompatible(
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): boolean {
  const st = getPortType(sourceHandle)
  const tt = getPortType(targetHandle)
  if (!st || !tt) return false
  if (st === 'any' || tt === 'any') return true
  return st === tt
}
