// ── DrawSplineCard — freehand drawing inside a ReactFlow node ─────────────────
// Renders a mini SVG canvas where the user draws a curve with the mouse.
// On mouseup, the raw path is simplified (Ramer–Douglas–Peucker) and stored
// as data.points (array of {x,y,z}). z is always 0 — the user draws in XY.
// The curve is shown as a Catmull-Rom preview inside the node.

import { useCallback, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { PORT_COLORS } from './portTypes'
import { getNodeDescriptor } from './nodeRegistry'
import { useGraphStore } from '../../store/graphStore'

// ── Canvas dimensions (internal coordinate space) ────────────────────────────

const CW = 200   // canvas width  (px)
const CH = 120   // canvas height (px)

// ── Ramer–Douglas–Peucker simplification ─────────────────────────────────────

interface Pt2 { x: number; y: number }

function perpDist(pt: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(pt.x - a.x, pt.y - a.y)
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2))
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
}

function rdp(pts: Pt2[], eps: number): Pt2[] {
  if (pts.length < 3) return pts
  let maxD = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > eps) {
    return [...rdp(pts.slice(0, idx + 1), eps), ...rdp(pts.slice(idx), eps).slice(1)]
  }
  return [pts[0], pts[pts.length - 1]]
}

// ── Catmull-Rom path string (for SVG preview) ─────────────────────────────────

function catmullRomPath(pts: Pt2[], tension = 0.5): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`

  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) * tension / 3
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x},${p2.y}`
  }
  return d
}

// ── Normalise canvas points → [-1,1] world space ─────────────────────────────

function toWorldSpace(pts: Pt2[]): { x: number; y: number; z: number }[] {
  return pts.map(p => ({
    x: (p.x / CW) * 2 - 1,
    y: -((p.y / CH) * 2 - 1), // flip Y
    z: 0,
  }))
}

// ── DrawSplineCard ─────────────────────────────────────────────────────────────

interface Props {
  id: string
  data: Record<string, unknown>
  selected?: boolean
  color: string
}

export default function DrawSplineCard({ id, data, selected, color }: Props) {
  const updateNodeData = useGraphStore(s => s.updateNodeData)

  // Stored control points (canvas space)
  const storedPoints = (() => {
    const wp = data.points as { x: number; y: number; z: number }[] | undefined
    if (!wp || wp.length < 2) return null
    return wp.map(p => ({
      x: (p.x + 1) / 2 * CW,
      y: (1 - (p.y + 1) / 2) * CH,
    }))
  })()

  const [drawing, setDrawing] = useState(false)
  const [raw, setRaw] = useState<Pt2[]>([])
  const [expanded, setExpanded] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)

  const getPos = useCallback((e: React.MouseEvent<SVGSVGElement>): Pt2 => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CW,
      y: ((e.clientY - rect.top) / rect.height) * CH,
    }
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation()
    setDrawing(true)
    setRaw([getPos(e)])
  }, [getPos])

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawing) return
    e.stopPropagation()
    setRaw(prev => {
      const p = getPos(e)
      const last = prev[prev.length - 1]
      // throttle: only add if moved > 2px
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return prev
      return [...prev, p]
    })
  }, [drawing, getPos])

  const onMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation()
    if (!drawing || raw.length < 2) { setDrawing(false); return }
    setDrawing(false)
    // Simplify — epsilon ~3px to keep key inflections
    const simplified = rdp(raw, 3)
    if (simplified.length < 2) return
    const worldPts = toWorldSpace(simplified)
    updateNodeData(id, { points: worldPts })
    setRaw([])
  }, [drawing, raw, id, updateNodeData])

  const onMouseLeave = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drawing) onMouseUp(e)
  }, [drawing, onMouseUp])

  // Points to render: currently drawing → raw, else stored
  const previewPts: Pt2[] | null = drawing ? raw : storedPoints

  const hasPoints = !drawing && storedPoints && storedPoints.length >= 2
  const tension = (data.tension as number) ?? 0.5

  return (
    <div style={{
      background: '#1d1d1d',
      border: `1px solid ${selected ? color : '#3a3a3a'}`,
      borderRadius: 6, minWidth: 220,
      boxShadow: selected ? `0 0 0 1px ${color}44` : '0 2px 8px #00000066',
      fontFamily: 'system-ui,sans-serif',
      position: 'relative',
    }}>
      {/* ── Header (drag handle) ── */}
      <div className="node-drag-handle" style={{
        background: color, borderRadius: expanded ? '5px 5px 0 0' : 5,
        height: 28, padding: '0 6px 0 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        cursor: 'grab',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 12 }}>✏</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1 }}>Draw Spline</span>
        {hasPoints && (
          <span style={{ fontSize: 8, color: '#fff', opacity: 0.7, fontFamily: 'monospace' }}>
            {(data.points as unknown[]).length}pts
          </span>
        )}
        <span style={{ fontSize: 8, opacity: 0.55, textTransform: 'uppercase', color: '#fff', letterSpacing: '0.05em' }}>
          spline
        </span>
        {/* Collapse/expand button */}
        <button
          className="nodrag"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          style={{
            background: 'rgba(0,0,0,0.25)', border: 'none',
            borderRadius: 3, color: '#fff', fontSize: 11,
            cursor: 'pointer', padding: '1px 5px', lineHeight: 1.4,
            opacity: 0.8, flexShrink: 0,
          }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {/* ── Draw canvas (collapsible) ── */}
      {expanded && <div className="nodrag nowheel" style={{ position: 'relative', padding: '6px 14px 6px 14px' }}>
        <svg
          ref={svgRef}
          width="100%" viewBox={`0 0 ${CW} ${CH}`}
          style={{
            display: 'block',
            background: '#111',
            borderRadius: 4,
            cursor: drawing ? 'crosshair' : 'crosshair',
            border: `1px solid ${drawing ? color : '#2a2a2a'}`,
            transition: 'border-color 0.15s',
            touchAction: 'none',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          {/* Grid */}
          <line x1={CW/2} y1={0} x2={CW/2} y2={CH} stroke="#222" strokeWidth={1} />
          <line x1={0} y1={CH/2} x2={CW} y2={CH/2} stroke="#222" strokeWidth={1} />

          {/* Preview curve */}
          {previewPts && previewPts.length >= 2 && (
            <path
              d={catmullRomPath(previewPts, tension)}
              fill="none"
              stroke={drawing ? '#aaa' : color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={drawing ? 0.6 : 1}
            />
          )}

          {/* Control points dots (stored only) */}
          {!drawing && storedPoints && storedPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} opacity={0.7} />
          ))}

          {/* Hint when empty */}
          {!drawing && !storedPoints && (
            <text x={CW/2} y={CH/2} textAnchor="middle" dominantBaseline="middle"
              fill="#333" fontSize={10} fontFamily="system-ui,sans-serif"
            >
              draw here
            </text>
          )}
        </svg>

        {/* Clear button */}
        {hasPoints && !drawing && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); updateNodeData(id, { points: [] }) }}
            style={{
              position: 'absolute', top: 10, right: 18,
              background: '#1d1d1d', border: '1px solid #3a3a3a',
              borderRadius: 3, color: '#555', fontSize: 8, cursor: 'pointer',
              padding: '1px 5px', lineHeight: 1.4,
            }}
          >✕</button>
        )}
      </div>}

      {/* collapsed hint */}
      {!expanded && hasPoints && (
        <div className="nodrag" style={{
          padding: '3px 10px', fontSize: 9, color: '#666', fontFamily: 'monospace',
          borderTop: '1px solid #2a2a2a',
        }}>
          {(data.points as unknown[]).length} control points
        </div>
      )}

      {/* ── Ports — driven by registry schema ── */}
      {(() => {
        const schema = getNodeDescriptor('drawSpline')!.schema
        const nRows = Math.max(schema.inputs.length, schema.outputs.length, 1)
        const ROW_H = 22, PAD_V = 6
        return (
          <div className="nodrag" style={{ padding: `${PAD_V}px 0`, position: 'relative', height: PAD_V * 2 + nRows * ROW_H }}>
            {schema.inputs.map((port, i) => {
              const c = PORT_COLORS[port.type]
              return (
                <div key={port.id} style={{
                  position: 'absolute', left: 0, right: 0,
                  top: i * ROW_H, height: ROW_H,
                  display: 'flex', alignItems: 'center',
                  paddingLeft: 14, fontSize: 10, color: '#aaa', gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block' }} />
                  {port.label}
                  <Handle type="target" position={Position.Left} id={port.id}
                    style={{ left: -5, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, background: c, border: '2px solid #1d1d1d' }} />
                </div>
              )
            })}
            {schema.outputs.map((port, i) => {
              const c = PORT_COLORS[port.type]
              return (
                <div key={port.id} style={{
                  position: 'absolute', left: 0, right: 0,
                  top: i * ROW_H, height: ROW_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 14, fontSize: 10, color: '#aaa', gap: 5,
                }}>
                  {port.label}
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block' }} />
                  <Handle type="source" position={Position.Right} id={port.id}
                    style={{ right: -5, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, background: c, border: '2px solid #1d1d1d' }} />
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}
