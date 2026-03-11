// ── NodeCard — generic ReactFlow node component ───────────────────────────────
// Driven entirely by the nodeRegistry descriptors. No per-type bespoke files.

import { Handle, Position, NodeProps } from 'reactflow'
import { PORT_COLORS } from './portTypes'
import { getNodeDescriptor } from './nodeRegistry'
import DrawSplineCard from './DrawSplineCard'

const HDR_H = 28
const ROW_H = 22
const PAD_V = 6

// ── Inline handle dot ─────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: color, flexShrink: 0, display: 'inline-block',
    }} />
  )
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

export default function NodeCard({ id, type, data, selected }: NodeProps) {
  // ── DrawSpline gets its own bespoke card with embedded canvas ──────────────
  if (type === 'drawSpline') {
    const desc = getNodeDescriptor('drawSpline')!
    return <DrawSplineCard id={id} data={data} selected={selected} color={desc.color} />
  }

  const desc = getNodeDescriptor(type ?? '')
  if (!desc) {
    return (
      <div style={{
        background: '#2a1a1a', border: '1px solid #7f1d1d', borderRadius: 6,
        padding: '6px 10px', fontSize: 10, color: '#f87171', fontFamily: 'monospace',
        minWidth: 120,
      }}>
        Unknown type: {type}
      </div>
    )
  }

  const { label, icon, color, badge, schema } = desc
  const nRows = Math.max(schema.inputs.length, schema.outputs.length, 1)
  const bodyH = PAD_V * 2 + nRows * ROW_H

  return (
    <div style={{
      background: '#1d1d1d',
      border: `1px solid ${selected ? color : '#3a3a3a'}`,
      borderRadius: 6, minWidth: 160,
      boxShadow: selected ? `0 0 0 1px ${color}44` : '0 2px 8px #00000066',
      fontFamily: 'system-ui,sans-serif',
      position: 'relative',
    }}>
      {/* ── Header ── */}
      <div className="node-drag-handle" style={{
        background: color, borderRadius: '5px 5px 0 0',
        height: HDR_H, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        cursor: 'grab',
      }}>
        <span style={{ fontSize: 12 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', letterSpacing: '0.03em', flex: 1 }}>
          {label}
        </span>
        {badge && (
          <span style={{ fontSize: 8, opacity: 0.55, textTransform: 'uppercase', color: '#fff', letterSpacing: '0.05em' }}>
            {badge}
          </span>
        )}
      </div>

      {/* ── Port rows ── */}
      <div className="nodrag" style={{ padding: `${PAD_V}px 0`, position: 'relative', height: bodyH }}>

        {/* Inputs (left column) */}
        {schema.inputs.map((port, i) => {
          const c = PORT_COLORS[port.type]
          return (
            <div key={port.id} style={{
              position: 'absolute', left: 0, right: 0,
              top: i * ROW_H,
              height: ROW_H, display: 'flex', alignItems: 'center',
              paddingLeft: 14, fontSize: 10, color: '#aaa', gap: 5,
            }}>
              <Dot color={c} />
              {port.label}
              {/* Inline display for source nodes */}
              {type === 'objects' && port.type === 'objects' && (
                <span style={{ color: '#555', marginLeft: 4, fontFamily: 'monospace' }}>
                  ×<span style={{ color }}>{(data.count as number) ?? 4}</span>
                </span>
              )}
              {type === 'duration' && port.type === 'duration' && (
                <span style={{ color, fontFamily: 'monospace', marginLeft: 4 }}>
                  {(data.seconds as number) ?? 10}s
                </span>
              )}
              {type === 'mix' && port.label === 'A' && (
                <span style={{ color: '#555', marginLeft: 'auto', paddingRight: 4, fontSize: 9 }}>
                  {(100 - Math.round(((data.blend as number) ?? 0.5) * 100))}%
                </span>
              )}
              {type === 'mix' && port.label === 'B' && (
                <span style={{ color: '#555', marginLeft: 'auto', paddingRight: 4, fontSize: 9 }}>
                  {Math.round(((data.blend as number) ?? 0.5) * 100)}%
                </span>
              )}
              <Handle
                type="target" position={Position.Left} id={port.id}
                style={{
                  left: -5, top: '50%', transform: 'translateY(-50%)',
                  width: 10, height: 10,
                  background: c, border: '2px solid #1d1d1d',
                }}
              />
            </div>
          )
        })}

        {/* Outputs (right column) */}
        {schema.outputs.map((port, i) => {
          const c = PORT_COLORS[port.type]
          return (
            <div key={port.id} style={{
              position: 'absolute', left: 0, right: 0,
              top: i * ROW_H,
              height: ROW_H, display: 'flex', alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 14, fontSize: 10, color: '#aaa', gap: 5,
            }}>
              {port.label}
              <Dot color={c} />
              <Handle
                type="source" position={Position.Right} id={port.id}
                style={{
                  right: -5, top: '50%', transform: 'translateY(-50%)',
                  width: 10, height: 10,
                  background: c, border: '2px solid #1d1d1d',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
