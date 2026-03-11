import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { MOTION_PORT_SCHEMA, PORT_COLORS } from './portTypes'


export interface ParamDef {
  key:     string
  label:   string
  type:    'float' | 'int' | 'select' | 'bool'
  min?:    number
  max?:    number
  step?:   number
  options?: { value: string; label: string }[]
  default: number | string | boolean
}

export interface EngineConfig {
  label:    string
  icon:     string
  category: 'math' | 'physics'
  params:   ParamDef[]
}

export const ENGINES_CONFIG: Record<string, EngineConfig> = {
  // ── Math ──────────────────────────────────────────────────────────────────
  circular: {
    label: 'Circular', icon: '○', category: 'math',
    params: [
      { key: 'radius',    label: 'Radius',    type: 'float', min: 0.1, max: 5,   step: 0.05, default: 1.0 },
      { key: 'speed',     label: 'Speed',     type: 'float', min: 0.1, max: 10,  step: 0.1,  default: 1.0 },
      { key: 'elevation', label: 'Elevation', type: 'float', min: 0,   max: 2,   step: 0.05, default: 0.0 },
    ],
  },
  spiral: {
    label: 'Spiral', icon: '🌀', category: 'math',
    params: [
      { key: 'radius_start', label: 'R Start', type: 'float', min: 0.1, max: 3, step: 0.05, default: 0.2 },
      { key: 'radius_end',   label: 'R End',   type: 'float', min: 0.1, max: 5, step: 0.05, default: 1.5 },
      { key: 'turns',        label: 'Turns',   type: 'float', min: 0.5, max: 20, step: 0.5,  default: 3.0 },
      { key: 'speed',        label: 'Speed',   type: 'float', min: 0.1, max: 5,  step: 0.1,  default: 1.0 },
    ],
  },
  lissajous: {
    label: 'Lissajous', icon: '∞', category: 'math',
    params: [
      { key: 'freq_x', label: 'Freq X', type: 'int',   min: 1, max: 10, default: 3 },
      { key: 'freq_y', label: 'Freq Y', type: 'int',   min: 1, max: 10, default: 2 },
      { key: 'freq_z', label: 'Freq Z', type: 'int',   min: 0, max: 10, default: 1 },
      { key: 'scale',  label: 'Scale',  type: 'float', min: 0.1, max: 3, step: 0.05, default: 1.0 },
    ],
  },
  figure8: {
    label: 'Figure 8', icon: '8', category: 'math',
    params: [
      { key: 'scale', label: 'Scale', type: 'float', min: 0.2, max: 3, step: 0.05, default: 1.0 },
      { key: 'speed', label: 'Speed', type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
    ],
  },
  linear: {
    label: 'Linear', icon: '→', category: 'math',
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
      { key: 'frequency', label: 'Freq',      type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
    ],
  },
  oscillation: {
    label: 'Oscillation', icon: '〜', category: 'math',
    params: [
      { key: 'amplitude', label: 'Amplitude', type: 'float', min: 0.1, max: 3, step: 0.05, default: 1.0 },
      { key: 'frequency', label: 'Freq',      type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
      { key: 'damping',   label: 'Damping',   type: 'float', min: 0,   max: 1, step: 0.01, default: 0.0 },
    ],
  },
  perlin_noise: {
    label: 'Perlin', icon: '~', category: 'math',
    params: [
      { key: 'scale',   label: 'Scale',   type: 'float', min: 0.1, max: 5,   step: 0.1, default: 1.0 },
      { key: 'octaves', label: 'Octaves', type: 'int',   min: 1,   max: 6,   default: 3 },
      { key: 'speed',   label: 'Speed',   type: 'float', min: 0.1, max: 3,   step: 0.1, default: 0.5 },
      { key: 'seed',    label: 'Seed',    type: 'int',   min: 0,   max: 999, default: 42 },
    ],
  },
  formation: {
    label: 'Formation', icon: '⬡', category: 'math',
    params: [
      { key: 'formation_type', label: 'Shape', type: 'select', default: 'circle',
        options: [
          { value: 'circle',   label: 'Circle' },
          { value: 'line',     label: 'Line' },
          { value: 'grid',     label: 'Grid' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'star',     label: 'Star' },
        ]},
      { key: 'radius',  label: 'Radius',  type: 'float', min: 0.2, max: 3, step: 0.05, default: 1.0 },
      { key: 'animate', label: 'Animate', type: 'bool',  default: true },
      { key: 'speed',   label: 'Speed',   type: 'float', min: 0, max: 5, step: 0.1, default: 0.5 },
    ],
  },
  converge: {
    label: 'Converge', icon: '⊙', category: 'math',
    params: [
      { key: 'target_x', label: 'Target X', type: 'float', min: -2, max: 2, step: 0.05, default: 0.0 },
      { key: 'target_y', label: 'Target Y', type: 'float', min: -2, max: 2, step: 0.05, default: 0.0 },
      { key: 'target_z', label: 'Target Z', type: 'float', min: -2, max: 2, step: 0.05, default: 0.0 },
      { key: 'speed',    label: 'Speed',    type: 'float', min: 0.1, max: 5, step: 0.1, default: 1.0 },
    ],
  },
  pendulum: {
    label: 'Pendulum', icon: '⊿', category: 'math',
    params: [
      { key: 'length',  label: 'Length',  type: 'float', min: 0.2, max: 3,  step: 0.05, default: 1.0 },
      { key: 'gravity', label: 'Gravity', type: 'float', min: 1,   max: 20, step: 0.5,  default: 9.8 },
      { key: 'damping', label: 'Damping', type: 'float', min: 0,   max: 1,  step: 0.01, default: 0.05 },
      { key: 'angle0',  label: 'Angle₀',  type: 'float', min: 5,   max: 89, step: 1,    default: 45.0 },
    ],
  },

  // ── Physics ───────────────────────────────────────────────────────────────
  bouncing: {
    label: 'Bouncing', icon: '⊙', category: 'physics',
    params: [
      { key: 'gravity',     label: 'Gravity',     type: 'float', min: 0,  max: 30, step: 0.5,  default: 9.8 },
      { key: 'restitution', label: 'Restitution', type: 'float', min: 0,  max: 1,  step: 0.05, default: 0.7 },
      { key: 'floor_y',     label: 'Floor',       type: 'float', min: -2, max: 0,  step: 0.1,  default: -0.9 },
      { key: 'seed',        label: 'Seed',        type: 'int',   min: 0,  max: 999, default: 42 },
    ],
  },
  avoidance: {
    label: 'Avoidance', icon: '↔', category: 'physics',
    params: [
      { key: 'repulsion', label: 'Repulsion', type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
      { key: 'radius',    label: 'Radius',    type: 'float', min: 0.1, max: 2, step: 0.05, default: 0.5 },
      { key: 'speed',     label: 'Speed',     type: 'float', min: 0.1, max: 3, step: 0.1,  default: 0.5 },
      { key: 'seed',      label: 'Seed',      type: 'int',   min: 0,   max: 999, default: 42 },
    ],
  },
  spring: {
    label: 'Spring', icon: '⤡', category: 'physics',
    params: [
      { key: 'stiffness',  label: 'Stiffness', type: 'float', min: 1,   max: 50, step: 0.5,  default: 10.0 },
      { key: 'damping',    label: 'Damping',   type: 'float', min: 0,   max: 5,  step: 0.1,  default: 0.5 },
      { key: 'rest_length',label: 'Rest L',    type: 'float', min: 0.1, max: 3,  step: 0.05, default: 0.5 },
      { key: 'seed',       label: 'Seed',      type: 'int',   min: 0,   max: 999, default: 42 },
    ],
  },
  follow: {
    label: 'Follow', icon: '→', category: 'physics',
    params: [
      { key: 'speed',     label: 'Speed',     type: 'float', min: 0.1, max: 5, step: 0.1,  default: 1.0 },
      { key: 'delay',     label: 'Delay',     type: 'float', min: 0,   max: 2, step: 0.05, default: 0.3 },
      { key: 'stiffness', label: 'Stiffness', type: 'float', min: 0.1, max: 3, step: 0.1,  default: 0.5 },
    ],
  },
  swarm: {
    label: 'Swarm', icon: '✦', category: 'physics',
    params: [
      { key: 'cohesion',       label: 'Cohesion',   type: 'float', min: 0,   max: 2, step: 0.05, default: 0.5 },
      { key: 'separation',     label: 'Separation', type: 'float', min: 0,   max: 5, step: 0.1,  default: 1.5 },
      { key: 'alignment',      label: 'Alignment',  type: 'float', min: 0,   max: 2, step: 0.05, default: 0.3 },
      { key: 'speed',          label: 'Speed',      type: 'float', min: 0.1, max: 3, step: 0.1,  default: 0.3 },
      { key: 'container_size', label: 'Container',  type: 'float', min: 0.3, max: 2, step: 0.05, default: 0.85 },
      { key: 'seed',           label: 'Seed',       type: 'int',   min: 0,   max: 999, default: 42 },
    ],
  },
}

// ─── Node body (minimal — only port rows) ─────────────────────────────────────

const ROW_H   = 22   // px per port row
const HDR_H   = 28   // px header
const PAD_V   = 4    // vertical padding inside body

interface MotionNodeProps {
  id: string
  selected?: boolean
  data: Record<string, unknown> & {
    engineType: string
    onChange: (id: string, patch: Record<string, unknown>) => void
  }
}

function MotionNode({ id: _id, selected, data }: MotionNodeProps) {
  const cfg = ENGINES_CONFIG[data.engineType]
  if (!cfg) return null

  const hdr    = cfg.category === 'math' ? '#4b7fbf' : '#c16a28'
  const schema = MOTION_PORT_SCHEMA
  const bodyH  = PAD_V * 2 + Math.max(schema.inputs.length, schema.outputs.length) * ROW_H
  const totalH = HDR_H + bodyH

  return (
    <div style={{
      background: '#1d1d1d',
      border: `1px solid ${selected ? hdr : '#3a3a3a'}`,
      borderRadius: 6, minWidth: 170,
      boxShadow: selected ? `0 0 0 1px ${hdr}44` : '0 2px 8px #00000066',
      fontFamily: 'system-ui,sans-serif',
      position: 'relative',
      height: totalH,
    }}>
      {/* Header */}
      <div style={{
        background: hdr, borderRadius: '5px 5px 0 0',
        height: HDR_H, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 12 }}>{cfg.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', letterSpacing: '0.03em' }}>{cfg.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 8, opacity: 0.5, textTransform: 'uppercase', color: '#fff' }}>{cfg.category}</span>
      </div>

      {/* Port rows */}
      <div style={{ padding: `${PAD_V}px 0`, position: 'relative' }}>
        {/* Inputs (left) */}
        {schema.inputs.map((port, i) => (
          <div key={port.id} style={{
            height: ROW_H, display: 'flex', alignItems: 'center',
            paddingLeft: 16, fontSize: 10, color: '#aaa', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: PORT_COLORS[port.type], flexShrink: 0 }} />
            {port.label}
            <Handle
              type="target" position={Position.Left} id={port.id}
              style={{
                left: -5, top: PAD_V + i * ROW_H + ROW_H / 2,
                width: 10, height: 10,
                background: PORT_COLORS[port.type],
                border: '2px solid #1d1d1d',
              }}
            />
          </div>
        ))}

        {/* Outputs (right) */}
        {schema.outputs.map((port, i) => (
          <div key={port.id} style={{
            position: 'absolute',
            top: PAD_V + i * ROW_H,
            right: 0, left: 0,
            height: ROW_H, display: 'flex', alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 16, fontSize: 10, color: '#aaa', gap: 6,
          }}>
            {port.label}
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: PORT_COLORS[port.type], flexShrink: 0 }} />
            <Handle
              type="source" position={Position.Right} id={port.id}
              style={{
                right: -5, top: PAD_V + i * ROW_H + ROW_H / 2,
                width: 10, height: 10,
                background: PORT_COLORS[port.type],
                border: '2px solid #1d1d1d',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(MotionNode)
