import { useCallback, useEffect, useRef, useState } from 'react'
import ReactFlow, {
  Node,
  Controls,
  Background,
  MiniMap,
  Connection,
  BackgroundVariant,
  ReactFlowInstance,
  Panel,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Loader2, Radio } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import NodeCard from './nodes/NodeCard'
import NodeProperties from './NodeProperties'
import { portsCompatible } from './nodes/portTypes'
import { ALL_NODES, ENGINES_CONFIG, FALLOFFS_CONFIG, SPLINES_CONFIG } from './nodes/nodeRegistry'

// ─── Node types ───────────────────────────────────────────────────────────────
// Single NodeCard handles every type. All types come from the registry.

const nodeTypes: Record<string, React.FC<any>> = Object.fromEntries(
  Object.keys(ALL_NODES).map((t) => [t, NodeCard])
)

// ─── Palette config ───────────────────────────────────────────────────────────

const PALETTE_GROUPS = [
  {
    label: 'Node',
    color: '#6b6b6b',
    items: ['objects', 'duration', 'output', 'mix', 'group', 'sequence']
      .map((t) => ({ type: t, icon: ALL_NODES[t].icon, label: ALL_NODES[t].label, color: ALL_NODES[t].color,
        defaults: Object.fromEntries(ALL_NODES[t].params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Modifier',
    color: '#fb923c',
    items: ['scale', 'rotate', 'offset', 'phaseShift', 'barycentricGroup']
      .map((t) => ({ type: t, icon: ALL_NODES[t].icon, label: ALL_NODES[t].label, color: ALL_NODES[t].color,
        defaults: Object.fromEntries(ALL_NODES[t].params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Math',
    color: '#4b7fbf',
    items: Object.entries(ENGINES_CONFIG)
      .filter(([, c]) => c.category === 'math')
      .map(([t, c]) => ({ type: t, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Physics',
    color: '#c16a28',
    items: Object.entries(ENGINES_CONFIG)
      .filter(([, c]) => c.category === 'physics')
      .map(([t, c]) => ({ type: t, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Signal',
    color: '#10b981',
    items: ['bpm', 'audioAmplitude', 'audioSpectrum', 'oscInput']
      .map((t) => ({ type: t, icon: ALL_NODES[t].icon, label: ALL_NODES[t].label, color: ALL_NODES[t].color,
        defaults: Object.fromEntries(ALL_NODES[t].params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Spline',
    color: '#0ea5e9',
    items: Object.values(SPLINES_CONFIG)
      .map(c => ({ type: c.type, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Falloff · Time',
    color: '#8b5cf6',
    items: Object.values(FALLOFFS_CONFIG)
      .filter(c => c.type.startsWith('time.'))
      .map(c => ({ type: c.type, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Falloff · Spatial',
    color: '#8b5cf6',
    items: Object.values(FALLOFFS_CONFIG)
      .filter(c => c.type.startsWith('spatial.'))
      .map(c => ({ type: c.type, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
  {
    label: 'Falloff · Math',
    color: '#8b5cf6',
    items: Object.values(FALLOFFS_CONFIG)
      .filter(c => c.type.startsWith('math.'))
      .map(c => ({ type: c.type, icon: c.icon, label: c.label, color: c.color,
        defaults: Object.fromEntries(c.params.map(p => [p.key, p.default])) })),
  },
]

let nodeIdCounter = 100

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraphIssue {
  level:    'error' | 'warning' | 'info'
  code:     string
  message:  string
  node_id?: string
}

export interface NodeEditorStatus {
  status:   'idle' | 'compiling' | 'ok' | 'error'
  info:     string
  error:    string
  issues:   GraphIssue[]
}

type StatusCallback = (s: NodeEditorStatus) => void

// ─── Component ────────────────────────────────────────────────────────────────

export default function NodeEditor({ onStatus }: { onStatus?: StatusCallback }) {
  const [status, setStatus] = useState<'idle' | 'compiling' | 'ok' | 'error'>('idle')
  const [info, setInfo]     = useState('')
  const [error, setError]   = useState('')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  const rfInstanceRef  = useRef<ReactFlowInstance | null>(null)
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender  = useRef(true)

  // ── Store — single source of truth ──────────────────────────────────────────
  const nodes          = useGraphStore((s) => s.nodes)
  const edges          = useGraphStore((s) => s.edges)
  const onNodesChange  = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange  = useGraphStore((s) => s.onEdgesChange)
  const storeOnConnect = useGraphStore((s) => s.onConnect)
  const storeCompile   = useGraphStore((s) => s.compile)
  const compileResult  = useGraphStore((s) => s.compileResult)

  // ── Live compile — triggered by store graph changes ──────────────────────────
  const compile = useCallback(() => {
    setStatus('compiling')
    setError('')
    onStatus?.({ status: 'compiling', info: '', error: '', issues: [] })

    storeCompile()

    // Read result immediately after synchronous compile
    const result = useGraphStore.getState().compileResult
    if (!result) return

    const issues: GraphIssue[] = result.issues.map(i => ({
      level: i.level, code: i.code, message: i.message, node_id: i.nodeId,
    }))

    if (!result.success) {
      const errors = issues.filter((i) => i.level === 'error')
      const msg = errors.length > 0
        ? errors.map((i) => i.message).join(' · ')
        : 'Compilation failed'
      setError(msg)
      setStatus('error')
      onStatus?.({ status: 'error', info: '', error: msg, issues })
      return
    }

    const nObj = result.objectCount
    const ms   = result.compileMs.toFixed(1)
    const warns = issues.filter((i) => i.level === 'warning')
    const warnSuffix = warns.length > 0 ? `  ⚠ ${warns.length}` : ''
    const msg = `compiled  ${ms}ms  ${nObj} obj${warnSuffix}`
    setInfo(msg)
    setStatus('ok')
    onStatus?.({ status: 'ok', info: msg, error: '', issues })
  }, [storeCompile, onStatus])

  // Debounced recompile when graph topology/data changes
  const graphSignature = JSON.stringify([
    nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
    edges.map((e) => ({ s: e.source, t: e.target, sh: e.sourceHandle, th: e.targetHandle })),
  ])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      compile()
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(compile, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature])

  // Reflect external compile result changes (e.g. after importHol)
  useEffect(() => {
    if (!compileResult) return
    const issues: GraphIssue[] = compileResult.issues.map(i => ({
      level: i.level, code: i.code, message: i.message, node_id: i.nodeId,
    }))
    if (compileResult.success) {
      const warns = issues.filter(i => i.level === 'warning')
      const msg = `compiled  ${compileResult.compileMs.toFixed(1)}ms  ${compileResult.objectCount} obj${warns.length ? `  ⚠ ${warns.length}` : ''}`
      setInfo(msg)
      setStatus('ok')
      onStatus?.({ status: 'ok', info: msg, error: '', issues })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compileResult])

  // ── Selection ────────────────────────────────────────────────────────────────
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedNode(sel.length === 1 ? sel[0] : null)
  }, [])

  const syncedSelected: Node | null = selectedNode
    ? (nodes.find((n) => n.id === selectedNode.id) ?? null)
    : null

  // ── Node data change → store ─────────────────────────────────────────────────
  const onNodeDataChange = useCallback((id: string, patch: Record<string, unknown>) => {
    useGraphStore.getState().updateNodeData(id, patch)
  }, [])

  // ── Connections ───────────────────────────────────────────────────────────────
  const onConnect = useCallback((p: Connection) => {
    storeOnConnect(p)
  }, [storeOnConnect])

  const isValidConnection = useCallback(
    (conn: Connection) => portsCompatible(conn.sourceHandle, conn.targetHandle),
    []
  )

  // ── Drag & drop from palette ──────────────────────────────────────────────────
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
    useGraphStore.getState().addNode({ id, type, position, data: { ...defaults } })
  }, [])

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
          deleteKeyCode={['Delete', 'Backspace']}
          style={{ background: '#161616' }}
          connectionLineStyle={{ stroke: '#888', strokeWidth: 1.5, strokeDasharray: '4 2' }}
          defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Controls style={{ background: '#1d1d1d', border: '1px solid #333', borderRadius: 4 }} />
          <MiniMap
            style={{ background: '#1a1a1a', border: '1px solid #333' }}
            nodeColor={(n) => ALL_NODES[n.type ?? '']?.color ?? '#555'}
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
