import { useCallback, useEffect, useRef, useState } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  BackgroundVariant,
  ReactFlowInstance,
  Panel,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Loader2, Radio } from 'lucide-react'
import { useTrajectoryStore } from '../store/trajectoryStore'
import ObjectsNode from './nodes/ObjectsNode'
import DurationNode from './nodes/DurationNode'
import OutputNode from './nodes/OutputNode'
import GroupNode from './nodes/GroupNode'
import SequenceNode from './nodes/SequenceNode'
import MixNode from './nodes/MixNode'
import MotionNode, { ENGINES_CONFIG } from './nodes/MotionNode'
import NodeProperties from './NodeProperties'
import { portsCompatible } from './nodes/portTypes'

// ─── Node types ───────────────────────────────────────────────────────────────

const makeMotionNode = (engineType: string) =>
  (props: { id: string; selected?: boolean; data: Record<string, unknown> & { onChange: (id: string, d: Record<string, unknown>) => void } }) =>
    <MotionNode {...props} data={{ ...props.data, engineType }} />

const nodeTypes: Record<string, React.FC<any>> = {
  objects:  ObjectsNode,
  duration: DurationNode,
  output:   OutputNode,
  group:    GroupNode,
  sequence: SequenceNode,
  mix:      MixNode,
  ...Object.fromEntries(Object.keys(ENGINES_CONFIG).map((k) => [k, makeMotionNode(k)])),
}

// ─── Palette config ───────────────────────────────────────────────────────────

const MATH_COLOR    = '#4b7fbf'
const PHYSICS_COLOR = '#c16a28'
const NODE_COLOR    = '#6b6b6b'

const PALETTE_GROUPS = [
  {
    label: 'Node',
    color: NODE_COLOR,
    items: [
      { type: 'objects',  icon: '◉', label: 'Objects',  defaults: { count: 4 } },
      { type: 'duration', icon: '⏱', label: 'Duration', defaults: { seconds: 10 } },
      { type: 'output',   icon: '⊳', label: 'Output',   defaults: {} },
      { type: 'mix',      icon: '⇌', label: 'Mix',      defaults: { blend: 0.5 } },
      { type: 'group',    icon: '⊕', label: 'Group',    defaults: {} },
      { type: 'sequence', icon: '▶▶', label: 'Sequence', defaults: {} },
    ],
  },
  {
    label: 'Math',
    color: MATH_COLOR,
    items: Object.entries(ENGINES_CONFIG)
      .filter(([, c]) => c.category === 'math')
      .map(([t, c]) => ({ type: t, icon: c.icon, label: c.label, defaults: {} })),
  },
  {
    label: 'Physics',
    color: PHYSICS_COLOR,
    items: Object.entries(ENGINES_CONFIG)
      .filter(([, c]) => c.category === 'physics')
      .map(([t, c]) => ({ type: t, icon: c.icon, label: c.label, defaults: {} })),
  },
]

// ─── Default graph ────────────────────────────────────────────────────────────

const buildInitialNodes = (onChange: (id: string, d: Record<string, unknown>) => void): Node[] => [
  { id: 'n-obj', type: 'objects',  position: { x: 60,  y: 180 }, data: { count: 4, onChange } },
  { id: 'n-dur', type: 'duration', position: { x: 60,  y: 290 }, data: { seconds: 10, onChange } },
  { id: 'n-mov', type: 'circular', position: { x: 310, y: 160 }, data: { onChange } },
  { id: 'n-out', type: 'output',   position: { x: 560, y: 200 }, data: { onChange } },
]

const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'n-obj', sourceHandle: 'out-objects',    target: 'n-mov', targetHandle: 'in-objects',    style: { stroke: '#9b5cf6', strokeWidth: 1.5 } },
  { id: 'e2', source: 'n-dur', sourceHandle: 'out-duration',   target: 'n-mov', targetHandle: 'in-duration',   style: { stroke: '#d4a017', strokeWidth: 1.5 } },
  { id: 'e3', source: 'n-mov', sourceHandle: 'out-trajectory', target: 'n-out', targetHandle: 'in-trajectory', style: { stroke: '#22c55e', strokeWidth: 1.5 } },
]

let nodeIdCounter = 100

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      id:   n.id,
      type: n.type ?? 'default',
      data: Object.fromEntries(
        Object.entries(n.data).filter(([k]) => k !== 'onChange' && k !== 'onGenerate')
      ),
    })),
    edges: edges.map((e) => ({
      source:       e.source,
      target:       e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface NodeEditorStatus {
  status: 'idle' | 'compiling' | 'ok' | 'error'
  info:   string
  error:  string
}

type StatusCallback = (s: NodeEditorStatus) => void

export default function NodeEditor({ onStatus }: { onStatus?: StatusCallback }) {
  const [status, setStatus] = useState<'idle' | 'compiling' | 'ok' | 'error'>('idle')
  const [info, setInfo]     = useState('')
  const [error, setError]   = useState('')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const setNodesRef   = useRef<((fn: (nds: Node[]) => Node[]) => void) | null>(null)
  const isFirstRender = useRef(true)

  const setTrajectory = useTrajectoryStore((s) => s.setTrajectory)

  const onNodeDataChange = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodesRef.current?.((nds) =>
      nds.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)
    )
  }, [])

  const [nodes, setNodes, onNodesChange] = useNodesState(buildInitialNodes(onNodeDataChange))
  setNodesRef.current = setNodes
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES)

  // ── Live compile ─────────────────────────────────────────────────────────────
  const compile = useCallback(async (ns: Node[], es: Edge[]) => {
    setStatus('compiling')
    setError('')
    onStatus?.({ status: 'compiling', info: '', error: '' })
    try {
      const res = await fetch('/api/compile-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeGraph(ns, es)),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setTrajectory(data.trajectory)
      const ms   = ((data.latency ?? 0) * 1000).toFixed(0)
      const msg  = `${data.engine}  ${ms}ms  ${data.trajectory?.objects?.length ?? 0} obj`
      setInfo(msg)
      setStatus('ok')
      onStatus?.({ status: 'ok', info: msg, error: '' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error'
      setError(msg)
      setStatus('error')
      onStatus?.({ status: 'error', info: '', error: msg })
    }
  }, [setTrajectory, onStatus])

  // Signature: ignore node positions, only data + edges
  const graphSignature = JSON.stringify([
    nodes.map((n) => ({ id: n.id, type: n.type, data: Object.fromEntries(Object.entries(n.data).filter(([k]) => k !== 'onChange')) })),
    edges.map((e) => ({ s: e.source, t: e.target })),
  ])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      // Initial compile after mount
      compile(nodes, edges)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => compile(nodes, edges), 420)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature])

  // ── Selection ──────────────────────────────────────────────────────────────────
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedNode(sel.length === 1 ? sel[0] : null)
    // Keep selected node data in sync
  }, [])

  // Keep selectedNode data in sync with the latest node state
  const syncedSelected: Node | null = selectedNode
    ? (nodes.find((n) => n.id === selectedNode.id) ?? null)
    : null

  // ── Interactions ──────────────────────────────────────────────────────────────
  const onConnect = useCallback(
    (p: Connection) => {
      // Color edge by port type
      const portType = p.sourceHandle?.split('-')[1] ?? ''
      const colors: Record<string, string> = {
        objects: '#9b5cf6', duration: '#d4a017', trajectory: '#22c55e',
      }
      const stroke = colors[portType] ?? '#555'
      setEdges((eds) => addEdge({ ...p, style: { stroke, strokeWidth: 1.5 } }, eds))
    },
    [setEdges]
  )

  const isValidConnection = useCallback(
    (conn: Connection) => portsCompatible(conn.sourceHandle, conn.targetHandle),
    []
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type     = e.dataTransfer.getData('application/reactflow-type')
    const defaults = JSON.parse(e.dataTransfer.getData('application/reactflow-defaults') || '{}')
    if (!type || !rfInstanceRef.current) return
    const position = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = `n-${type}-${nodeIdCounter++}`
    setNodes((nds) => [...nds, { id, type, position, data: { ...defaults, onChange: onNodeDataChange } }])
  }, [onNodeDataChange, setNodes])

  return (
    <div style={{ height: '100%', display: 'flex', background: '#161616' }}>

      {/* ── Palette (left) ── */}
      <div style={{
        width: 140, background: '#1d1d1d', borderRight: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column', overflowY: 'auto', userSelect: 'none', flexShrink: 0,
      }}>
        {PALETTE_GROUPS.map((group) => (
          <div key={group.label}>
            <div style={{
              padding: '8px 10px 4px',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: group.color, textTransform: 'uppercase',
            }}>
              {group.label}
            </div>
            {group.items.map((item) => (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-type', item.type)
                  e.dataTransfer.setData('application/reactflow-defaults', JSON.stringify(item.defaults))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                style={{
                  margin: '1px 6px',
                  padding: '5px 8px',
                  background: '#252525',
                  borderLeft: `2px solid ${group.color}`,
                  borderRadius: 3,
                  fontSize: 10,
                  color: '#ccc',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2e2e2e')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#252525')}
              >
                <span style={{ fontSize: 11, color: group.color }}>{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Canvas (center) ── */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          isValidConnection={isValidConnection}
          onInit={(inst) => { rfInstanceRef.current = inst }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode="Delete"
          style={{ background: '#161616' }}
          connectionLineStyle={{ stroke: '#888', strokeWidth: 1.5, strokeDasharray: '4 2' }}
          defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Controls style={{ background: '#1d1d1d', border: '1px solid #333', borderRadius: 4 }} />
          <MiniMap
            style={{ background: '#1a1a1a', border: '1px solid #333' }}
            nodeColor={(n) => {
              if (n.type && ENGINES_CONFIG[n.type])
                return ENGINES_CONFIG[n.type].category === 'math' ? MATH_COLOR : PHYSICS_COLOR
              if (n.type === 'output') return '#22c55e'
              return '#555'
            }}
            maskColor="#16161688"
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={0.8} color="#252525" />

          {/* Status pill */}
          <Panel position="bottom-center">
            <div style={{
              background: '#1d1d1d', border: '1px solid #333', borderRadius: 4,
              padding: '3px 12px', marginBottom: 4,
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 10, color: '#666', fontFamily: 'monospace',
            }}>
              {status === 'compiling' && <><Loader2 className="animate-spin" style={{ width: 10, height: 10, color: '#aaa' }} /><span style={{ color: '#aaa' }}>compiling…</span></>}
              {status === 'ok'        && <><Radio style={{ width: 10, height: 10, color: '#5a9' }} /><span style={{ color: '#5a9' }}>{info}</span></>}
              {status === 'error'     && <span style={{ color: '#e55' }}>{error}</span>}
              {status === 'idle'      && <span>—</span>}
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* ── Node Properties (right) ── */}
      <div style={{
        width: 220, background: '#1a1a1a', borderLeft: '1px solid #2a2a2a',
        flexShrink: 0, overflowY: 'auto',
      }}>
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid #2a2a2a',
          fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', userSelect: 'none',
        }}>Node Properties</div>
        <NodeProperties node={syncedSelected} onChange={onNodeDataChange} />
      </div>
    </div>
  )
}
