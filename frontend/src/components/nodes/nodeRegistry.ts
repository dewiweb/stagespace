// ── Node registry ─────────────────────────────────────────────────────────────
// Single source of truth for every node type: its schema, color, label, icon,
// and parameter definitions.  The NodeCard component renders any node from this
// registry without bespoke per-node files.

import type { NodePortSchema } from './portTypes'
import {
  OBJECTS_PORT_SCHEMA,
  DURATION_PORT_SCHEMA,
  OUTPUT_PORT_SCHEMA,
  MIX_PORT_SCHEMA,
  GROUP_PORT_SCHEMA,
  SEQUENCE_PORT_SCHEMA,
  TRANSFORM_PORT_SCHEMA,
  TRACK_MAP_PORT_SCHEMA,
  PLAYER_PORT_SCHEMA,
  MOTION_PORT_SCHEMA,
} from './portTypes'

// ── Parameter definition ──────────────────────────────────────────────────────

export interface ParamDef {
  key:      string
  label:    string
  type:     'float' | 'int' | 'select' | 'bool'
  min?:     number
  max?:     number
  step?:    number
  options?: { value: string; label: string }[]
  default:  number | string | boolean
}

// ── Node descriptor ───────────────────────────────────────────────────────────

export interface NodeDescriptor {
  type:     string
  label:    string
  icon:     string
  color:    string         // header accent color
  badge?:   string         // small right-side label in header (SOURCE / SINK / MATH…)
  schema:   NodePortSchema
  params:   ParamDef[]
  category: 'source' | 'sink' | 'math' | 'physics' | 'control' | 'modifier' | 'spline' | 'falloff'
}

// ── Source nodes ──────────────────────────────────────────────────────────────

const objects: NodeDescriptor = {
  type: 'objects', label: 'Objects', icon: '◉', color: '#6b6b6b',
  badge: 'source', category: 'source', schema: OBJECTS_PORT_SCHEMA,
  params: [
    { key: 'count', label: 'Count', type: 'int', min: 1, max: 64, default: 4 },
    { key: 'useHolPositions', label: 'Start from .hol positions', type: 'bool', default: false },
  ],
}

const duration: NodeDescriptor = {
  type: 'duration', label: 'Duration', icon: '⏱', color: '#d4a017',
  badge: 'source', category: 'source', schema: DURATION_PORT_SCHEMA,
  params: [
    { key: 'seconds', label: 'Seconds', type: 'float', min: 0.5, max: 120, step: 0.5, default: 10 },
  ],
}

// ── Sink nodes ────────────────────────────────────────────────────────────────

const output: NodeDescriptor = {
  type: 'output', label: 'Output', icon: '⊳', color: '#22c55e',
  badge: 'sink', category: 'sink', schema: OUTPUT_PORT_SCHEMA,
  params: [],
}

const trackMap: NodeDescriptor = {
  type: 'trackMap', label: 'Track Map', icon: '⇥', color: '#f59e0b',
  badge: 'remap', category: 'sink', schema: TRACK_MAP_PORT_SCHEMA,
  params: [
    { key: 'trackIds', label: 'Track IDs (comma-separated)', type: 'select', default: '',
      options: [] },
  ],
}

const player: NodeDescriptor = {
  type: 'player', label: 'Player', icon: '▶', color: '#3b82f6',
  badge: 'control', category: 'control', schema: PLAYER_PORT_SCHEMA,
  params: [],
}

// ── Control nodes ─────────────────────────────────────────────────────────────

const mix: NodeDescriptor = {
  type: 'mix', label: 'Mix', icon: '⇌', color: '#e879f9',
  badge: 'blend', category: 'control', schema: MIX_PORT_SCHEMA,
  params: [
    { key: 'blend', label: 'Blend (0=A, 1=B)', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
}

const group: NodeDescriptor = {
  type: 'group', label: 'Group', icon: '⊕', color: '#7c3aed',
  badge: 'combine', category: 'control', schema: GROUP_PORT_SCHEMA,
  params: [],
}

const sequence: NodeDescriptor = {
  type: 'sequence', label: 'Sequence', icon: '▶▶', color: '#0ea5e9',
  badge: 'chain', category: 'control', schema: SEQUENCE_PORT_SCHEMA,
  params: [],
}

// ── Modifier nodes ────────────────────────────────────────────────────────────

const scale: NodeDescriptor = {
  type: 'scale', label: 'Scale', icon: '⤢', color: '#fb923c',
  badge: 'modifier', category: 'modifier', schema: TRANSFORM_PORT_SCHEMA,
  params: [
    { key: 'x', label: 'Scale X', type: 'float', min: 0.01, max: 10, step: 0.05, default: 1 },
    { key: 'y', label: 'Scale Y', type: 'float', min: 0.01, max: 10, step: 0.05, default: 1 },
    { key: 'z', label: 'Scale Z', type: 'float', min: 0.01, max: 10, step: 0.05, default: 1 },
  ],
}

const rotate: NodeDescriptor = {
  type: 'rotate', label: 'Rotate', icon: '↻', color: '#fb923c',
  badge: 'modifier', category: 'modifier', schema: TRANSFORM_PORT_SCHEMA,
  params: [
    { key: 'angleX', label: 'Angle X (rad)', type: 'float', min: -3.14, max: 3.14, step: 0.01, default: 0 },
    { key: 'angleY', label: 'Angle Y (rad)', type: 'float', min: -3.14, max: 3.14, step: 0.01, default: 0 },
    { key: 'angleZ', label: 'Angle Z (rad)', type: 'float', min: -3.14, max: 3.14, step: 0.01, default: 0 },
  ],
}

const offset: NodeDescriptor = {
  type: 'offset', label: 'Offset', icon: '⤻', color: '#fb923c',
  badge: 'modifier', category: 'modifier', schema: TRANSFORM_PORT_SCHEMA,
  params: [
    { key: 'x', label: 'Δ X', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    { key: 'y', label: 'Δ Y', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    { key: 'z', label: 'Δ Z', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    { key: 'useHolPosition', label: 'Use .hol position', type: 'int', min: 0, max: 1, step: 1, default: 0 },
  ],
}

const phaseShift: NodeDescriptor = {
  type: 'phaseShift', label: 'Phase Shift', icon: '⊿', color: '#fb923c',
  badge: 'modifier', category: 'modifier', schema: TRANSFORM_PORT_SCHEMA,
  params: [
    { key: 'shift', label: 'Per-object shift × duration (s)', type: 'float', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
}

const barycentricGroup: NodeDescriptor = {
  type: 'barycentricGroup', label: 'Barycentric', icon: '⦿', color: '#fb923c',
  badge: 'modifier', category: 'modifier', schema: TRANSFORM_PORT_SCHEMA,
  params: [
    { key: 'centerX', label: 'Center X', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    { key: 'centerY', label: 'Center Y', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    { key: 'centerZ', label: 'Center Z', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
  ],
}

// ── Math engines — paramMeta aligned exactly with engine/registry.ts ──────────

export const ENGINES_CONFIG: Record<string, NodeDescriptor> = {
  circular: {
    type: 'circular', label: 'Circular', icon: '○', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'radius',  label: 'Radius',   type: 'float', min: 0.01, max: 20,       step: 0.01, default: 1 },
      { key: 'speed',   label: 'Speed',    type: 'float', min: -10,  max: 10,       step: 0.01, default: 1 },
      { key: 'centerX', label: 'Center X', type: 'float', min: -10,  max: 10,       step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y', type: 'float', min: -10,  max: 10,       step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z', type: 'float', min: -10,  max: 10,       step: 0.01, default: 0 },
      { key: 'tiltX',   label: 'Tilt X',   type: 'float', min: -3.14, max: 3.14,   step: 0.01, default: 0 },
      { key: 'tiltZ',   label: 'Tilt Z',   type: 'float', min: -3.14, max: 3.14,   step: 0.01, default: 0 },
    ],
  },
  elliptical: {
    type: 'elliptical', label: 'Elliptical', icon: '⬭', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'radiusX', label: 'Radius X', type: 'float', min: 0.01, max: 20, step: 0.01, default: 1.5 },
      { key: 'radiusY', label: 'Radius Y', type: 'float', min: 0.01, max: 20, step: 0.01, default: 0.8 },
      { key: 'radiusZ', label: 'Radius Z', type: 'float', min: 0,    max: 20, step: 0.01, default: 0 },
      { key: 'speed',   label: 'Speed',    type: 'float', min: -10,  max: 10, step: 0.01, default: 1 },
      { key: 'centerX', label: 'Center X', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
    ],
  },
  spiral: {
    type: 'spiral', label: 'Spiral', icon: '🌀', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'radiusStart', label: 'Radius Start', type: 'float', min: 0,   max: 20, step: 0.01, default: 0.1 },
      { key: 'radiusEnd',   label: 'Radius End',   type: 'float', min: 0,   max: 20, step: 0.01, default: 2 },
      { key: 'turns',       label: 'Turns',        type: 'float', min: 0.5, max: 20, step: 0.5,  default: 3 },
      { key: 'speed',       label: 'Speed',        type: 'float', min: -5,  max: 5,  step: 0.01, default: 1 },
      { key: 'zStart',      label: 'Z Start',      type: 'float', min: -10, max: 10, step: 0.01, default: -1 },
      { key: 'zEnd',        label: 'Z End',        type: 'float', min: -10, max: 10, step: 0.01, default: 1 },
      { key: 'centerX',     label: 'Center X',     type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'centerY',     label: 'Center Y',     type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    ],
  },
  lissajous: {
    type: 'lissajous', label: 'Lissajous', icon: '∿', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'freqX',   label: 'Freq X',   type: 'float', min: 0.5, max: 12,        step: 0.5,  default: 3 },
      { key: 'freqY',   label: 'Freq Y',   type: 'float', min: 0.5, max: 12,        step: 0.5,  default: 2 },
      { key: 'freqZ',   label: 'Freq Z',   type: 'float', min: 0,   max: 12,        step: 0.5,  default: 1 },
      { key: 'phaseX',  label: 'Phase X',  type: 'float', min: 0,   max: 6.28,      step: 0.01, default: 0 },
      { key: 'phaseY',  label: 'Phase Y',  type: 'float', min: 0,   max: 6.28,      step: 0.01, default: 1.5708 },
      { key: 'phaseZ',  label: 'Phase Z',  type: 'float', min: 0,   max: 6.28,      step: 0.01, default: 0 },
      { key: 'radiusX', label: 'Radius X', type: 'float', min: 0.01, max: 10,       step: 0.01, default: 1 },
      { key: 'radiusY', label: 'Radius Y', type: 'float', min: 0.01, max: 10,       step: 0.01, default: 1 },
      { key: 'radiusZ', label: 'Radius Z', type: 'float', min: 0,    max: 10,       step: 0.01, default: 0.5 },
      { key: 'speed',   label: 'Speed',    type: 'float', min: -5,  max: 5,         step: 0.01, default: 1 },
    ],
  },
  figure8: {
    type: 'figure8', label: 'Figure 8', icon: '∞', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'radius',  label: 'Radius',       type: 'float', min: 0.01, max: 20,     step: 0.01, default: 1 },
      { key: 'speed',   label: 'Speed',        type: 'float', min: -5,   max: 5,      step: 0.01, default: 1 },
      { key: 'tilt',    label: 'Tilt (Z→Y)',   type: 'float', min: -3.14, max: 3.14,  step: 0.01, default: 0 },
      { key: 'centerX', label: 'Center X',     type: 'float', min: -10,  max: 10,     step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y',     type: 'float', min: -10,  max: 10,     step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z',     type: 'float', min: -10,  max: 10,     step: 0.01, default: 0 },
    ],
  },
  linear: {
    type: 'linear', label: 'Linear', icon: '→', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'x0',       label: 'Start X',   type: 'float', min: -10, max: 10, step: 0.01, default: -1 },
      { key: 'y0',       label: 'Start Y',   type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'z0',       label: 'Start Z',   type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'x1',       label: 'End X',     type: 'float', min: -10, max: 10, step: 0.01, default: 1 },
      { key: 'y1',       label: 'End Y',     type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'z1',       label: 'End Z',     type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'pingpong', label: 'Ping-Pong', type: 'int',   min: 0,   max: 1,  step: 1,    default: 0 },
    ],
  },
  oscillation: {
    type: 'oscillation', label: 'Oscillation', icon: '〜', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'ampX',    label: 'Amplitude X', type: 'float', min: 0,   max: 10, step: 0.01, default: 1 },
      { key: 'ampY',    label: 'Amplitude Y', type: 'float', min: 0,   max: 10, step: 0.01, default: 0 },
      { key: 'ampZ',    label: 'Amplitude Z', type: 'float', min: 0,   max: 10, step: 0.01, default: 0 },
      { key: 'freqX',   label: 'Freq X',      type: 'float', min: 0.1, max: 10, step: 0.1,  default: 1 },
      { key: 'freqY',   label: 'Freq Y',      type: 'float', min: 0.1, max: 10, step: 0.1,  default: 1 },
      { key: 'freqZ',   label: 'Freq Z',      type: 'float', min: 0.1, max: 10, step: 0.1,  default: 1 },
      { key: 'damping', label: 'Damping',     type: 'float', min: 0,   max: 5,  step: 0.01, default: 0 },
      { key: 'centerX', label: 'Center X',    type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y',    type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z',    type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    ],
  },
  perlinNoise: {
    type: 'perlinNoise', label: 'Perlin Noise', icon: '≋', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'scale',   label: 'Scale',   type: 'float', min: 0.01, max: 10,  step: 0.01, default: 1 },
      { key: 'speed',   label: 'Speed',   type: 'float', min: 0,    max: 5,   step: 0.01, default: 0.5 },
      { key: 'octaves', label: 'Octaves', type: 'int',   min: 1,    max: 6,   step: 1,    default: 3 },
      { key: 'seedX',   label: 'Seed X',  type: 'float', min: 0,    max: 100, step: 0.1,  default: 0 },
      { key: 'seedY',   label: 'Seed Y',  type: 'float', min: 0,    max: 100, step: 0.1,  default: 31.7 },
      { key: 'seedZ',   label: 'Seed Z',  type: 'float', min: 0,    max: 100, step: 0.1,  default: 67.1 },
    ],
  },
  formation: {
    type: 'formation', label: 'Formation', icon: '⬡', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'shape',   label: 'Shape (0=circle 1=grid 2=sphere)', type: 'int',   min: 0,    max: 2,  step: 1,    default: 0 },
      { key: 'radius',  label: 'Radius',   type: 'float', min: 0.01, max: 20, step: 0.01, default: 1 },
      { key: 'speed',   label: 'Rotation Speed', type: 'float', min: -5, max: 5, step: 0.01, default: 0 },
      { key: 'layers',  label: 'Layers',   type: 'int',   min: 1,    max: 8,  step: 1,    default: 1 },
      { key: 'centerX', label: 'Center X', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
    ],
  },
  converge: {
    type: 'converge', label: 'Converge', icon: '⟶', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'targetX',      label: 'Target X',      type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'targetY',      label: 'Target Y',      type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'targetZ',      label: 'Target Z',      type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'spreadRadius', label: 'Spread Radius', type: 'float', min: 0.01, max: 20, step: 0.01, default: 2 },
      { key: 'speed',        label: 'Speed',         type: 'float', min: 0.1,  max: 10, step: 0.01, default: 1 },
      { key: 'pingpong',     label: 'Ping-Pong',     type: 'int',   min: 0,    max: 1,  step: 1,    default: 1 },
    ],
  },
  roseCurve: {
    type: 'roseCurve', label: 'Rose Curve', icon: '✿', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'k',       label: 'Petals (k)', type: 'int',   min: 1,    max: 12, step: 1,    default: 3 },
      { key: 'radius',  label: 'Radius',     type: 'float', min: 0.01, max: 20, step: 0.01, default: 1 },
      { key: 'speed',   label: 'Speed',      type: 'float', min: -5,   max: 5,  step: 0.01, default: 1 },
      { key: 'centerX', label: 'Center X',   type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y',   type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerZ', label: 'Center Z',   type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'tilt',    label: 'Tilt',       type: 'float', min: -3.14, max: 3.14, step: 0.01, default: 0 },
    ],
  },
  helix: {
    type: 'helix', label: 'Helix', icon: '⤷', color: '#4b7fbf',
    badge: 'math', category: 'math', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'radius',  label: 'Radius',   type: 'float', min: 0.01, max: 20, step: 0.01, default: 1 },
      { key: 'turns',   label: 'Turns',    type: 'float', min: 0.5,  max: 20, step: 0.5,  default: 3 },
      { key: 'zStart',  label: 'Z Start',  type: 'float', min: -10,  max: 10, step: 0.01, default: -1 },
      { key: 'zEnd',    label: 'Z End',    type: 'float', min: -10,  max: 10, step: 0.01, default: 1 },
      { key: 'speed',   label: 'Speed',    type: 'float', min: -5,   max: 5,  step: 0.01, default: 1 },
      { key: 'centerX', label: 'Center X', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
      { key: 'centerY', label: 'Center Y', type: 'float', min: -10,  max: 10, step: 0.01, default: 0 },
    ],
  },

  // ── Physics engines ──────────────────────────────────────────────────────────
  pendulum: {
    type: 'pendulum', label: 'Pendulum', icon: '⌛', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'pendulumLength', label: 'Pendulum Length', type: 'float', min: 0.1, max: 10, step: 0.01, default: 2 },
      { key: 'gravity',        label: 'Gravity',         type: 'float', min: 0.1, max: 20, step: 0.1,  default: 9.8 },
      { key: 'damping',        label: 'Damping',         type: 'float', min: 0,   max: 2,  step: 0.01, default: 0.1 },
      { key: 'angle0',         label: 'Angle₀ (rad)',    type: 'float', min: 0.1, max: 3.14, step: 0.01, default: 1.2 },
      { key: 'pivotX',         label: 'Pivot X',         type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'pivotY',         label: 'Pivot Y',         type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'pivotZ',         label: 'Pivot Z',         type: 'float', min: -10, max: 10, step: 0.01, default: 1 },
    ],
  },
  bouncing: {
    type: 'bouncing', label: 'Bouncing', icon: '⭕', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'container',   label: 'Container Size', type: 'float', min: 0.1, max: 20,  step: 0.1,  default: 2 },
      { key: 'shape',       label: 'Shape (0=box 1=sphere)', type: 'int', min: 0, max: 1, step: 1, default: 0 },
      { key: 'restitution', label: 'Restitution',    type: 'float', min: 0.1, max: 1,   step: 0.01, default: 0.85 },
      { key: 'speed',       label: 'Speed',          type: 'float', min: 0.1, max: 10,  step: 0.1,  default: 2 },
    ],
  },
  avoidance: {
    type: 'avoidance', label: 'Avoidance', icon: '↯', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'repulsion', label: 'Repulsion Force',    type: 'float', min: 0.1, max: 20, step: 0.1, default: 2 },
      { key: 'radius',    label: 'Perception Radius',  type: 'float', min: 0.1, max: 10, step: 0.1, default: 1.5 },
      { key: 'maxSpeed',  label: 'Max Speed',          type: 'float', min: 0.1, max: 20, step: 0.1, default: 3 },
    ],
  },
  spring: {
    type: 'spring', label: 'Spring', icon: '⤡', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'stiffness', label: 'Stiffness', type: 'float', min: 0.1, max: 50,  step: 0.1,  default: 4 },
      { key: 'damping',   label: 'Damping',   type: 'float', min: 0,   max: 5,   step: 0.01, default: 0.8 },
      { key: 'targetX',   label: 'Target X',  type: 'float', min: -10, max: 10,  step: 0.01, default: 0 },
      { key: 'targetY',   label: 'Target Y',  type: 'float', min: -10, max: 10,  step: 0.01, default: 0 },
      { key: 'targetZ',   label: 'Target Z',  type: 'float', min: -10, max: 10,  step: 0.01, default: 0 },
    ],
  },
  follow: {
    type: 'follow', label: 'Follow', icon: '⤳', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'delay',        label: 'Delay (s)',     type: 'float', min: 0.05, max: 5,  step: 0.05, default: 0.3 },
      { key: 'leaderRadius', label: 'Leader Radius', type: 'float', min: 0.1,  max: 20, step: 0.1,  default: 1.5 },
      { key: 'leaderSpeed',  label: 'Leader Speed',  type: 'float', min: -5,   max: 5,  step: 0.1,  default: 0.5 },
    ],
  },
  swarm: {
    type: 'swarm', label: 'Swarm (Boids)', icon: '✦', color: '#c16a28',
    badge: 'physics', category: 'physics', schema: MOTION_PORT_SCHEMA,
    params: [
      { key: 'cohesion',         label: 'Cohesion',          type: 'float', min: 0, max: 10, step: 0.1,  default: 1 },
      { key: 'separation',       label: 'Separation',        type: 'float', min: 0, max: 10, step: 0.1,  default: 1.5 },
      { key: 'alignment',        label: 'Alignment',         type: 'float', min: 0, max: 5,  step: 0.1,  default: 0.5 },
      { key: 'maxSpeed',         label: 'Max Speed',         type: 'float', min: 0.1, max: 20, step: 0.1, default: 2 },
      { key: 'perceptionRadius', label: 'Perception Radius', type: 'float', min: 0.1, max: 20, step: 0.1, default: 2 },
    ],
  },
}

// ── Signal source nodes (BPM, Audio, OSC) ───────────────────────────────────
// These output a typed 'signal' port (scalar 0–1).
// They connect only to other 'signal' inputs (falloff chain, future param binding).

const SIGNAL_PORT_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [{ id: 'out-signal', type: 'signal', label: 'Signal' }],
}

const bpm: NodeDescriptor = {
  type: 'bpm', label: 'BPM', icon: '♩', color: '#10b981',
  badge: 'signal', category: 'source', schema: SIGNAL_PORT_SCHEMA,
  params: [
    { key: 'min', label: 'BPM min', type: 'float', min: 20,  max: 300, step: 1, default: 60 },
    { key: 'max', label: 'BPM max', type: 'float', min: 20,  max: 300, step: 1, default: 180 },
  ],
}

const audioAmplitude: NodeDescriptor = {
  type: 'audioAmplitude', label: 'Audio Amp', icon: '🔊', color: '#10b981',
  badge: 'signal', category: 'source', schema: SIGNAL_PORT_SCHEMA,
  params: [
    { key: 'gain',    label: 'Gain',    type: 'float', min: 0,   max: 10, step: 0.01, default: 1 },
    { key: 'smooth',  label: 'Smooth',  type: 'float', min: 0,   max: 1,  step: 0.01, default: 0.1 },
  ],
}

const audioSpectrum: NodeDescriptor = {
  type: 'audioSpectrum', label: 'Audio Spectrum', icon: '📊', color: '#10b981',
  badge: 'signal', category: 'source', schema: SIGNAL_PORT_SCHEMA,
  params: [
    { key: 'band',   label: 'Band (Hz)',  type: 'float', min: 20,  max: 20000, step: 10,   default: 200 },
    { key: 'width',  label: 'Width (Hz)', type: 'float', min: 10,  max: 5000,  step: 10,   default: 100 },
    { key: 'gain',   label: 'Gain',       type: 'float', min: 0,   max: 10,    step: 0.01, default: 1 },
    { key: 'smooth', label: 'Smooth',     type: 'float', min: 0,   max: 1,     step: 0.01, default: 0.1 },
  ],
}

const oscInput: NodeDescriptor = {
  type: 'oscInput', label: 'OSC Input', icon: '📡', color: '#10b981',
  badge: 'signal', category: 'source', schema: SIGNAL_PORT_SCHEMA,
  params: [
    { key: 'min',     label: 'Map Min',   type: 'float', min: -100, max: 100, step: 0.01, default: 0 },
    { key: 'max',     label: 'Map Max',   type: 'float', min: -100, max: 100, step: 0.01, default: 1 },
    { key: 'smooth',  label: 'Smooth',    type: 'float', min: 0,    max: 1,   step: 0.01, default: 0 },
  ],
}

// ── Spline nodes ──────────────────────────────────────────────────────────────

// drawSpline: outputs a 'spline' port (not a trajectory yet)
const DRAW_SPLINE_PORT_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [{ id: 'out-spline', type: 'spline', label: 'Spline' }],
}

// evaluateSpline: consumes a spline + objects + duration, produces a trajectory
const EVAL_SPLINE_PORT_SCHEMA: NodePortSchema = {
  inputs:  [
    { id: 'in-spline',   type: 'spline',   label: 'Spline' },
    { id: 'in-objects',  type: 'objects',  label: 'Objects' },
    { id: 'in-duration', type: 'duration', label: 'Duration' },
  ],
  outputs: [{ id: 'out-trajectory', type: 'trajectory', label: 'Trajectory' }],
}

const SPLINE_MODIFIER_PORT_SCHEMA: NodePortSchema = {
  inputs:  [{ id: 'in-trajectory', type: 'trajectory', label: 'Trajectory' }],
  outputs: [{ id: 'out-trajectory', type: 'trajectory', label: 'Trajectory' }],
}

export const SPLINES_CONFIG: Record<string, NodeDescriptor> = {
  drawSpline: {
    type: 'drawSpline', label: 'Draw Spline', icon: '✏', color: '#0ea5e9',
    badge: 'spline', category: 'spline', schema: DRAW_SPLINE_PORT_SCHEMA,
    params: [
      { key: 'tension', label: 'Tension', type: 'float', min: 0,  max: 1,  step: 0.01, default: 0.5 },
      { key: 'closed',  label: 'Closed',  type: 'int',   min: 0,  max: 1,  step: 1,    default: 0 },
    ],
  },
  evaluateSpline: {
    type: 'evaluateSpline', label: 'Evaluate Spline', icon: '▶', color: '#0ea5e9',
    badge: 'spline', category: 'spline', schema: EVAL_SPLINE_PORT_SCHEMA,
    params: [
      { key: 'speed',  label: 'Speed',           type: 'float', min: -5, max: 5,  step: 0.01, default: 1 },
      { key: 'offset', label: 'Per-obj offset',   type: 'float', min: 0,  max: 1,  step: 0.01, default: 0.25 },
      { key: 'mode',   label: 'Mode (0=travel 1=spread)', type: 'int', min: 0, max: 1, step: 1, default: 0 },
    ],
  },
  trimSpline: {
    type: 'trimSpline', label: 'Trim Spline', icon: '✂', color: '#0ea5e9',
    badge: 'spline', category: 'spline', schema: SPLINE_MODIFIER_PORT_SCHEMA,
    params: [
      { key: 'start', label: 'Start (0–1)', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'end',   label: 'End (0–1)',   type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  offsetSpline: {
    type: 'offsetSpline', label: 'Offset Spline', icon: '⤺', color: '#0ea5e9',
    badge: 'spline', category: 'spline', schema: SPLINE_MODIFIER_PORT_SCHEMA,
    params: [
      { key: 'x', label: 'Δ X', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'y', label: 'Δ Y', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
      { key: 'z', label: 'Δ Z', type: 'float', min: -10, max: 10, step: 0.01, default: 0 },
    ],
  },
}

// ── Falloff nodes ─────────────────────────────────────────────────────────────
// Falloffs output a scalar 0–1 that modulates engine parameters.
// Input: trajectory (to read position) + optional signal. Output: scalar signal.

// Time falloffs: no spatial input needed
const FALLOFF_TIME_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [{ id: 'out-signal', type: 'signal', label: 'Signal (0–1)' }],
}

// Spatial falloffs: need trajectory to read object positions
const FALLOFF_SPATIAL_SCHEMA: NodePortSchema = {
  inputs:  [{ id: 'in-trajectory', type: 'trajectory', label: 'Trajectory' }],
  outputs: [{ id: 'out-signal', type: 'signal', label: 'Signal (0–1)' }],
}

// Math falloffs: no inputs (pure math transform)
const FALLOFF_MATH_SCHEMA: NodePortSchema = {
  inputs:  [],
  outputs: [{ id: 'out-signal', type: 'signal', label: 'Signal (0–1)' }],
}

export const FALLOFFS_CONFIG: Record<string, NodeDescriptor> = {
  // ── Time falloffs ────────────────────────────────────────────────────────────
  'time.linear': {
    type: 'time.linear', label: 'Linear Time', icon: '╱', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_TIME_SCHEMA,
    params: [
      { key: 'invert', label: 'Invert', type: 'int', min: 0, max: 1, step: 1, default: 0 },
    ],
  },
  'time.sine': {
    type: 'time.sine', label: 'Sine Time', icon: '∿', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_TIME_SCHEMA,
    params: [
      { key: 'frequency', label: 'Frequency',    type: 'float', min: 0.1, max: 20, step: 0.1,  default: 1 },
      { key: 'phase',     label: 'Phase offset', type: 'float', min: 0,   max: 1,  step: 0.01, default: 0 },
      { key: 'invert',    label: 'Invert',       type: 'int',   min: 0,   max: 1,  step: 1,    default: 0 },
    ],
  },
  'time.pulse': {
    type: 'time.pulse', label: 'Pulse Time', icon: '⊓', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_TIME_SCHEMA,
    params: [
      { key: 'frequency',  label: 'Frequency',  type: 'float', min: 0.1, max: 20,  step: 0.1,  default: 2 },
      { key: 'width',      label: 'Duty cycle', type: 'float', min: 0,   max: 1,   step: 0.01, default: 0.5 },
      { key: 'smoothness', label: 'Smoothness', type: 'float', min: 0,   max: 0.5, step: 0.01, default: 0.05 },
    ],
  },
  'time.ramp': {
    type: 'time.ramp', label: 'Ramp Time', icon: '⟋', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_TIME_SCHEMA,
    params: [
      { key: 'start', label: 'Start (phase)', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'end',   label: 'End (phase)',   type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'clamp', label: 'Clamp',         type: 'int',   min: 0, max: 1, step: 1,    default: 1 },
    ],
  },
  'time.stagger': {
    type: 'time.stagger', label: 'Stagger', icon: '⣿', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_TIME_SCHEMA,
    params: [
      { key: 'offset', label: 'Per-object offset', type: 'float', min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'invert', label: 'Invert',             type: 'int',   min: 0, max: 1, step: 1,    default: 0 },
    ],
  },

  // ── Spatial falloffs ─────────────────────────────────────────────────────────
  'spatial.pointDistance': {
    type: 'spatial.pointDistance', label: 'Point Distance', icon: '◎', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_SPATIAL_SCHEMA,
    params: [
      { key: 'cx',       label: 'Center X', type: 'float', min: -5, max: 5,   step: 0.05, default: 0 },
      { key: 'cy',       label: 'Center Y', type: 'float', min: -5, max: 5,   step: 0.05, default: 0 },
      { key: 'cz',       label: 'Center Z', type: 'float', min: -5, max: 5,   step: 0.05, default: 0 },
      { key: 'radius',   label: 'Radius',   type: 'float', min: 0.01, max: 10, step: 0.05, default: 1 },
      { key: 'invert',   label: 'Invert',   type: 'int',   min: 0,  max: 1,   step: 1,    default: 0 },
      { key: 'exponent', label: 'Exponent', type: 'float', min: 0.1, max: 5,  step: 0.1,  default: 1 },
    ],
  },
  'spatial.axisDistance': {
    type: 'spatial.axisDistance', label: 'Axis Distance', icon: '⊸', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_SPATIAL_SCHEMA,
    params: [
      { key: 'axis',   label: 'Axis (0=X 1=Y 2=Z)', type: 'int',   min: 0,    max: 2,  step: 1,    default: 0 },
      { key: 'center', label: 'Center',              type: 'float', min: -5,   max: 5,  step: 0.05, default: 0 },
      { key: 'radius', label: 'Radius',              type: 'float', min: 0.01, max: 10, step: 0.05, default: 1 },
      { key: 'invert', label: 'Invert',              type: 'int',   min: 0,    max: 1,  step: 1,    default: 0 },
    ],
  },
  'spatial.objectIndex': {
    type: 'spatial.objectIndex', label: 'Object Index', icon: '⑆', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_SPATIAL_SCHEMA,
    params: [
      { key: 'invert',   label: 'Invert',   type: 'int',   min: 0,   max: 1, step: 1,   default: 0 },
      { key: 'exponent', label: 'Exponent', type: 'float', min: 0.1, max: 5, step: 0.1, default: 1 },
    ],
  },
  'spatial.randomPerObject': {
    type: 'spatial.randomPerObject', label: 'Random / Object', icon: '⁂', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_SPATIAL_SCHEMA,
    params: [
      { key: 'seed', label: 'Seed', type: 'float', min: 0, max: 9999, step: 1,    default: 42 },
      { key: 'min',  label: 'Min',  type: 'float', min: 0, max: 1,    step: 0.01, default: 0 },
      { key: 'max',  label: 'Max',  type: 'float', min: 0, max: 1,    step: 0.01, default: 1 },
    ],
  },

  // ── Math falloffs ─────────────────────────────────────────────────────────────
  'math.constant': {
    type: 'math.constant', label: 'Constant', icon: '═', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'value', label: 'Value', type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  'math.smoothstep': {
    type: 'math.smoothstep', label: 'Smoothstep', icon: '⌇', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'invert', label: 'Invert', type: 'int', min: 0, max: 1, step: 1, default: 0 },
    ],
  },
  'math.remap': {
    type: 'math.remap', label: 'Remap', icon: '⇄', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'inMin',  label: 'In min',  type: 'float', min: -5, max: 5, step: 0.01, default: 0 },
      { key: 'inMax',  label: 'In max',  type: 'float', min: -5, max: 5, step: 0.01, default: 1 },
      { key: 'outMin', label: 'Out min', type: 'float', min: -5, max: 5, step: 0.01, default: 0 },
      { key: 'outMax', label: 'Out max', type: 'float', min: -5, max: 5, step: 0.01, default: 1 },
      { key: 'clamp',  label: 'Clamp',   type: 'int',   min: 0,  max: 1, step: 1,    default: 1 },
    ],
  },
  'math.mix': {
    type: 'math.mix', label: 'Mix (lerp)', icon: '⇌', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'a', label: 'A',       type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'b', label: 'B',       type: 'float', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 't', label: 'Mix (t)', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  'math.multiply': {
    type: 'math.multiply', label: 'Multiply', icon: '×', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'factor', label: 'Factor', type: 'float', min: -5, max: 5, step: 0.01, default: 1 },
    ],
  },
  'math.power': {
    type: 'math.power', label: 'Power', icon: 'xⁿ', color: '#8b5cf6',
    badge: 'falloff', category: 'falloff', schema: FALLOFF_MATH_SCHEMA,
    params: [
      { key: 'exponent', label: 'Exponent', type: 'float', min: 0.1, max: 10, step: 0.1, default: 2 },
      { key: 'invert',   label: 'Invert',   type: 'int',   min: 0,   max: 1,  step: 1,   default: 0 },
    ],
  },
}

// ── Static node registry ──────────────────────────────────────────────────────

export const STATIC_NODES: Record<string, NodeDescriptor> = {
  objects, duration, output, trackMap, player, mix, group, sequence,
  scale, rotate, offset, phaseShift, barycentricGroup,
  bpm, audioAmplitude, audioSpectrum, oscInput,
}

export const ALL_NODES: Record<string, NodeDescriptor> = {
  ...STATIC_NODES,
  ...SPLINES_CONFIG,
  ...ENGINES_CONFIG,
  ...FALLOFFS_CONFIG,
}

export function getNodeDescriptor(type: string): NodeDescriptor | undefined {
  return ALL_NODES[type]
}
