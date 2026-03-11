import { create } from 'zustand'
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from 'reactflow'
import { GraphCompiler } from '../engine/graph/GraphCompiler'
import { Runtime } from '../engine/runtime/Runtime'
import { getProfile } from '../engine/runtime/oscProfiles'
import type { CompileResult } from '../engine/graph/types'
import type { PositionFrame } from '../engine/runtime/types'
import type { HolProject } from '../engine/hol/HolParser'
import { readHolFileFromInput } from '../engine/hol/HolParser'

const compiler = new GraphCompiler()

const runtime = new Runtime({
  fps: 60,
  duration: 10,
  coordSystem: 'xyz',
  oscHost: '127.0.0.1',
  oscPort: 8000,
  macroSpeed: 1,
  macroScale: { x: 1, y: 1, z: 1 },
  macroShift: { x: 0, y: 0, z: 0 },
  profile: getProfile('holophonix'),
})

export interface OSCConfig {
  host: string
  port: number
  profile: string
  coordSystem: 'xyz' | 'aed'
}

export interface MacroControls {
  speed: number
  scaleX: number
  scaleY: number
  scaleZ: number
  shiftX: number
  shiftY: number
  shiftZ: number
}

interface GraphState {
  nodes: Node[]
  edges: Edge[]
  compileResult: CompileResult | null
  isRunning: boolean
  currentT: number
  frames: PositionFrame[]
  oscConfig: OSCConfig
  macros: MacroControls

  // Actions
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: Node) => void
  deleteNode: (id: string) => void
  updateNodeData: (id: string, data: Record<string, unknown>) => void

  compile: () => void
  startRuntime: () => void
  stopRuntime: () => void
  toggleRuntime: () => void

  setOSCConfig: (config: Partial<OSCConfig>) => void
  setMacros: (macros: Partial<MacroControls>) => void

  holProject: HolProject | null
  importHol: (file: File) => Promise<{ success: boolean; error?: string }>
}

const DEFAULT_NODES: Node[] = [
  {
    id: 'n-obj',
    type: 'objects',
    position: { x: 80, y: 200 },
    data: { count: 4 },
  },
  {
    id: 'n-dur',
    type: 'duration',
    position: { x: 80, y: 340 },
    data: { seconds: 10 },
  },
  {
    id: 'n-mov',
    type: 'circular',
    position: { x: 340, y: 240 },
    data: {},
  },
  {
    id: 'n-out',
    type: 'output',
    position: { x: 620, y: 260 },
    data: {},
  },
]

const DEFAULT_EDGES: Edge[] = [
  { id: 'e1', source: 'n-obj', sourceHandle: 'out-objects',    target: 'n-mov', targetHandle: 'in-objects',    style: { stroke: '#9b5cf6', strokeWidth: 1.5 } },
  { id: 'e2', source: 'n-dur', sourceHandle: 'out-duration',   target: 'n-mov', targetHandle: 'in-duration',   style: { stroke: '#d4a017', strokeWidth: 1.5 } },
  { id: 'e3', source: 'n-mov', sourceHandle: 'out-trajectory', target: 'n-out', targetHandle: 'in-trajectory', style: { stroke: '#22c55e', strokeWidth: 1.5 } },
]

export const useGraphStore = create<GraphState>((set, get) => {
  // Frame callback → update current position frames
  runtime.setFrameCallback((frames, t) => {
    set({ frames, currentT: t })
  })

  return {
    nodes: DEFAULT_NODES,
    edges: DEFAULT_EDGES,
    compileResult: null,
    isRunning: false,
    currentT: 0,
    frames: [],
    oscConfig: { host: '127.0.0.1', port: 8000, profile: 'holophonix', coordSystem: 'xyz' },
    macros: { speed: 1, scaleX: 1, scaleY: 1, scaleZ: 1, shiftX: 0, shiftY: 0, shiftZ: 0 },

    onNodesChange: (changes) => {
      set(s => ({ nodes: applyNodeChanges(changes, s.nodes) }))
    },

    onEdgesChange: (changes) => {
      set(s => ({ edges: applyEdgeChanges(changes, s.edges) }))
    },

    onConnect: (connection) => {
      set(s => ({ edges: addEdge({ ...connection, animated: true }, s.edges) }))
      get().compile()
    },

    addNode: (node) => {
      set(s => ({ nodes: [...s.nodes, node] }))
    },

    deleteNode: (id) => {
      set(s => ({
        nodes: s.nodes.filter(n => n.id !== id),
        edges: s.edges.filter(e => e.source !== id && e.target !== id),
      }))
      get().compile()
    },

    updateNodeData: (id, data) => {
      set(s => ({
        nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n),
      }))
      get().compile()
    },

    compile: () => {
      const { nodes, edges } = get()
      const graph = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type ?? 'unknown',
          data: n.data,
        })),
        edges: edges.map(e => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle ?? 'out-trajectory',
          target: e.target,
          targetHandle: e.targetHandle ?? 'in-trajectory',
        })),
      }
      const result = compiler.compile(graph)
      set({ compileResult: result })

      if (result.success && result.fn) {
        const tracks = Array.from({ length: result.objectCount }, (_, i) => ({
          id: i + 1,
          objectIndex: i,
        }))
        runtime.updateConfig({ duration: result.duration })
        runtime.setEngine(result.fn, tracks)
      }
    },

    startRuntime: () => {
      const { compileResult } = get()
      if (!compileResult?.success) get().compile()
      runtime.start()
      set({ isRunning: true })
    },

    stopRuntime: () => {
      runtime.stop()
      set({ isRunning: false })
    },

    toggleRuntime: () => {
      get().isRunning ? get().stopRuntime() : get().startRuntime()
    },

    setOSCConfig: (config) => {
      set(s => {
        const next = { ...s.oscConfig, ...config }
        runtime.updateConfig({
          oscHost: next.host,
          oscPort: next.port,
          coordSystem: next.coordSystem,
          profile: getProfile(next.profile),
        })
        return { oscConfig: next }
      })
    },

    setMacros: (m) => {
      set(s => {
        const next = { ...s.macros, ...m }
        runtime.updateConfig({
          macroSpeed: next.speed,
          macroScale: { x: next.scaleX, y: next.scaleY, z: next.scaleZ },
          macroShift: { x: next.shiftX, y: next.shiftY, z: next.shiftZ },
        })
        return { macros: next }
      })
    },

    holProject: null,

    importHol: async (file: File) => {
      const result = await readHolFileFromInput(file)
      if (!result.success || !result.project) {
        return { success: false, error: result.error ?? 'Parse failed' }
      }
      set({ holProject: result.project })

      // Auto-update the Objects node count to match .hol track count
      const visibleTracks = result.project.tracks.filter(t => t.visible)
      const count = visibleTracks.length || result.project.tracks.length
      const { nodes } = get()
      const objNode = nodes.find(n => n.type === 'objects' || n.data?.label === 'Objects')
      if (objNode) {
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === objNode.id ? { ...n, data: { ...n.data, count } } : n
          ),
        }))
      }
      get().compile()
      return { success: true }
    },
  }
})

// Auto-compile on startup
setTimeout(() => useGraphStore.getState().compile(), 0)
