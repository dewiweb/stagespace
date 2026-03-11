// ── NodeCard — generic ReactFlow node component ───────────────────────────────
// Driven entirely by the nodeRegistry descriptors. No per-type bespoke files.

import { Handle, Position, NodeProps } from 'reactflow'
import { PORT_COLORS } from './portTypes'
import { getNodeDescriptor } from './nodeRegistry'
import DrawSplineCard from './DrawSplineCard'
import { useGraphStore } from '../../store/graphStore'

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

// ── Key param to show inline on the node body (first meaningful param)
const INLINE_PARAM: Record<string, string> = {
  circular: 'radius', elliptical: 'radiusX', spiral: 'radiusEnd',
  lissajous: 'freqX', figure8: 'radius', linear: 'x1',
  oscillation: 'ampX', perlinNoise: 'scale', formation: 'radius',
  converge: 'speed', roseCurve: 'k', helix: 'radius',
  pendulum: 'pendulumLength', bouncing: 'container', avoidance: 'repulsion',
  spring: 'stiffness', follow: 'delay', swarm: 'cohesion',
  scale: 'x', rotate: 'angleZ', offset: 'x', phaseShift: 'shift',
  barycentricGroup: 'centerX', mix: 'blend',
  bpm: 'bpm', audioAmplitude: 'gain', audioSpectrum: 'band', oscInput: 'max',
  evaluateSpline: 'speed', trimSpline: 'start', offsetSpline: 'x',
}

export default function NodeCard({ id, type, data, selected }: NodeProps) {
  const deleteNode = useGraphStore((s) => s.deleteNode)
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
        height: HDR_H, padding: '0 6px 0 10px',
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
        {/* Delete button — only shown when selected or on hover */}
        {selected && (
          <div
            className="nodrag"
            title="Delete node"
            onClick={(e) => { e.stopPropagation(); deleteNode(id) }}
            style={{
              width: 16, height: 16, borderRadius: '50%',
              background: '#00000033', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 10, color: '#fff', flexShrink: 0, lineHeight: 1,
              userSelect: 'none',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#cc333388')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#00000033')}
          >×</div>
        )}
      </div>

      {/* ── Inline key param ── */}
      {INLINE_PARAM[type ?? ''] && (() => {
        const key = INLINE_PARAM[type ?? '']
        const val = data[key] as number | undefined
        if (val === undefined) return null
        return (
          <div style={{
            padding: '2px 10px 3px', background: '#161616',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid #2a2a2a', fontSize: 9,
          }}>
            <span style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{key}</span>
            <span style={{ color, fontFamily: 'monospace' }}>
              {Number.isInteger(val) ? val : (val as number).toFixed(2)}
            </span>
          </div>
        )
      })()}

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
