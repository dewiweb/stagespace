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
import { OscRouter } from '../engine/osc/OscRouter'
import { OscBridgeClient } from '../engine/osc/OscBridgeClient'
import { CueSystem } from '../engine/osc/CueSystem'
import type { Cue } from '../engine/osc/CueSystem'
import type { OscBinding } from '../engine/osc/types'
import type { CompileResult } from '../engine/graph/types'
import type { PositionFrame } from '../engine/runtime/types'
import type { HolProject } from '../engine/hol/HolParser'
import { readHolFileFromInput } from '../engine/hol/HolParser'
import { AudioAnalyser } from '../engine/audio/AudioAnalyser'
import type { AudioFrame } from '../engine/audio/types'
import { updateSharedAudioFrame } from '../engine/audio/audioContext'

const compiler      = new GraphCompiler()
const audioAnalyser = new AudioAnalyser()
const oscRouter     = new OscRouter()
const bridge        = new OscBridgeClient('ws://localhost:8765')
const cueSystem     = new CueSystem()

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

// ── OSC IN : bridge → router → macros / nodeParams / cues ────────────────────
bridge.onMessage((msg) => {
  oscRouter.dispatch(msg)
  // Keep last 20 messages for display
  useGraphStore.setState(s => ({
    recentOscIn: [msg, ...s.recentOscIn].slice(0, 20),
  }))
})

oscRouter.setApplyFn((binding: OscBinding, args) => {
  const val = typeof args[0] === 'number' ? args[0] : 0
  switch (binding.target.kind) {
    case 'macroSpeed':
      runtime.updateConfig({ macroSpeed: val })
      break
    case 'macroScale': {
      const cfg = runtime.getConfig()
      const axis = binding.target.axis
      runtime.updateConfig({ macroScale: { ...cfg.macroScale, [axis]: val } })
      break
    }
    case 'macroShift': {
      const cfg = runtime.getConfig()
      const axis = binding.target.axis
      runtime.updateConfig({ macroShift: { ...cfg.macroShift, [axis]: val } })
      break
    }
    case 'cueGo':
      cueSystem.go(binding.target.cueId)
      break
    case 'custom':
      binding.target.fn(args)
      break
    default:
      break
  }
})

cueSystem.setOnGo((cue) => {
  // Restore cue snapshot: apply node data from each snapshot
  useGraphStore.getState().applyCue(cue)
})

export interface OSCConfig {
  host: string
  port: number
  oscInPort: number
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
  bridgeConnected: boolean
  macros: MacroControls
  audioFrame: AudioFrame
  audioRunning: boolean
  cueList: Cue[]
  recentOscIn: import('../engine/osc/types').OscMessage[]

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

  startAudio: () => Promise<void>
  stopAudio: () => void

  recordCue: (name?: string) => Cue
  goCue: (id: string) => void
  deleteCue: (id: string) => void
  applyCue: (cue: Cue) => void

  holProject: HolProject | null
  importHol: (file: File) => Promise<{ success: boolean; error?: string }>

  saveGraph: () => void
  loadGraph: (file: File) => Promise<{ success: boolean; error?: string }>
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
  // OSC OUT : runtime tick → bridge → UDP
  runtime.setOSCSender((address, args) => bridge.send(address, args))

  // Bridge status → store
  bridge.onStatus((s) => set({ bridgeConnected: s.connected }))

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
    oscConfig: { host: '127.0.0.1', port: 9000, oscInPort: 9001, profile: 'holophonix', coordSystem: 'xyz' },
    bridgeConnected: false,
    macros: { speed: 1, scaleX: 1, scaleY: 1, scaleZ: 1, shiftX: 0, shiftY: 0, shiftZ: 0 },
    audioFrame: { amplitude: 0, peak: 0, bpm: 0, beat: false, spectrum: new Float32Array(1024) },
    audioRunning: false,
    cueList: [],
    recentOscIn: [],

    startAudio: async () => {
      if (audioAnalyser.isRunning) return
      await audioAnalyser.start()
      set({ audioRunning: true })
      // Poll audio frame at ~30fps via setInterval (RAF not reliable outside canvas)
      const id = window.setInterval(() => {
        if (!audioAnalyser.isRunning) { window.clearInterval(id); return }
        const frame = { ...audioAnalyser.lastFrame }
        updateSharedAudioFrame(frame)
        set({ audioFrame: frame })
      }, 33) as unknown as number
    },

    stopAudio: () => {
      audioAnalyser.stop()
      set({ audioRunning: false, audioFrame: { amplitude: 0, peak: 0, bpm: 0, beat: false, spectrum: new Float32Array(1024) } })
    },

    recordCue: (name?: string) => {
      const { nodes } = get()
      const snapshots = nodes.map(n => ({ nodeId: n.id, data: { ...n.data } }))
      const cue = cueSystem.record(snapshots, name)
      set({ cueList: cueSystem.getAll() })
      return cue
    },

    goCue: (id: string) => {
      cueSystem.go(id)
    },

    deleteCue: (id: string) => {
      cueSystem.delete(id)
      set({ cueList: cueSystem.getAll() })
    },

    applyCue: (cue: Cue) => {
      set(s => ({
        nodes: s.nodes.map(n => {
          const snap = cue.snapshots.find(sp => sp.nodeId === n.id)
          return snap ? { ...n, data: { ...n.data, ...snap.data } } : n
        }),
      }))
      get().compile()
    },

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

      if (result.success && result.slots.length > 0) {
        const { nodes: currentNodes } = get()
        // Build one EngineSlot per TrajSlot — resolve trackIds from Objects node
        // For simplicity: all slots share the same Objects node (single Objects node model)
        // Future: each output could have its own Objects node chain
        const objNode = currentNodes.find(n => n.type === 'objects')
        const trackIds = objNode?.data?.trackIds as number[] | undefined

        let objectIndexOffset = 0
        const engineSlots = result.slots.map(slot => {
          const tracks = Array.from({ length: slot.objectCount }, (_, i) => ({
            id: trackIds && trackIds.length >= objectIndexOffset + i + 1
              ? trackIds[objectIndexOffset + i]
              : objectIndexOffset + i + 1,
            objectIndex: i,
          }))
          objectIndexOffset += slot.objectCount
          return { fn: slot.fn, tracks, duration: slot.duration }
        })
        runtime.updateConfig({ duration: result.slots[0].duration })
        runtime.setSlots(engineSlots)
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
        // Propagate target host/port to the bridge in real time
        bridge.configure({ oscHost: next.host, oscPort: next.port, oscInPort: next.oscInPort })
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

      // Auto-update the Objects node: set count + trackIds + initialPositions from visible tracks
      const visibleTracks = result.project.tracks.filter(t => t.visible)
      const activeTracks = visibleTracks.length > 0 ? visibleTracks : result.project.tracks
      const count = activeTracks.length
      const trackIds = activeTracks.map(t => t.id)
      // Convert AED → XYZ (Holophonix: azim=0→Y+, azim=90→X+)
      const initialPositions = activeTracks.map(t => {
        if (t.azim === undefined || t.dist === undefined) return { x: 0, y: 0, z: 0 }
        const a = (t.azim * Math.PI) / 180
        const e = ((t.elev ?? 0) * Math.PI) / 180
        return {
          x: t.dist * Math.cos(e) * Math.sin(a),
          y: t.dist * Math.cos(e) * Math.cos(a),
          z: t.dist * Math.sin(e),
        }
      })
      const { nodes } = get()
      const objNode = nodes.find(n => n.type === 'objects')
      if (objNode) {
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === objNode.id
              ? { ...n, data: { ...n.data, count, trackIds, initialPositions } }
              : n
          ),
        }))
      }
      get().compile()
      return { success: true }
    },

    saveGraph: () => {
      const { nodes, edges, oscConfig } = get()
      const payload = {
        version: 1,
        nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map(e => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
        oscConfig,
        cueList: cueSystem.toJSON(),
      }
      const json = JSON.stringify(payload, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = 'holoflow-graph.json'
      a.click()
      URL.revokeObjectURL(url)
    },

    loadGraph: async (file: File) => {
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!data.nodes || !data.edges) return { success: false, error: 'Invalid graph file' }
        const restoredNodes: Node[] = data.nodes.map((n: Record<string, unknown>) => ({
          id: n.id as string,
          type: n.type as string,
          position: n.position as { x: number; y: number },
          data: n.data as Record<string, unknown>,
        }))
        const restoredEdges: Edge[] = data.edges.map((e: Record<string, unknown>) => ({
          id: e.id as string,
          source: e.source as string,
          sourceHandle: e.sourceHandle as string | undefined,
          target: e.target as string,
          targetHandle: e.targetHandle as string | undefined,
        }))
        set({ nodes: restoredNodes, edges: restoredEdges })
        if (data.oscConfig) get().setOSCConfig(data.oscConfig)
        if (data.cueList) cueSystem.fromJSON(data.cueList)
        get().compile()
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  }
})

// Auto-compile on startup
setTimeout(() => useGraphStore.getState().compile(), 0)
