import { create } from 'zustand';
import { type Node, type Edge, MarkerType } from 'reactflow';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';

// ─── Helpers ───

let nodeCounter = 0;
const genId = (type: string) => `${type.toLowerCase()}-signal-${Date.now()}-${nodeCounter++}`;

const makeNode = (type: string, position: { x: number; y: number }, params: Record<string, any> = {}): Node => ({
  id: genId(type),
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const makeEdge = (from: string, to: string, fromPort = 'output', toPort = 'signal'): Edge => ({
  id: `${from}-${to}`,
  source: from,
  target: to,
  sourceHandle: fromPort,
  targetHandle: toPort,
  markerEnd: { type: MarkerType.ArrowClosed },
});

// ─── Graph signal par défaut ───
// Point de départ minimal : LFO lent → SignalOut sur le yaw global.
// Démontre le contrat (delta additif, en degrés) sans surprise : ±15°.

export function buildDefaultSignalGraph(): { nodes: Node[]; edges: Edge[] } {
  const lfo = makeNode('SignalLfo', { x: 100, y: 200 }, {
    waveform: 'sine',
    frequency: 0.05,
    amplitude: 1.0,
    offset: 0.0,
    phase: 0.0,
  });
  const map = makeNode('SignalMap', { x: 330, y: 200 }, {
    in_min: -1.0,
    in_max: 1.0,
    out_min: -15.0,
    out_max: 15.0,
  });
  const out = makeNode('SignalOut', { x: 560, y: 200 }, {
    target: 'yaw',
    amount: 1.0,
  });

  return {
    nodes: [lfo, map, out],
    edges: [makeEdge(lfo.id, map.id), makeEdge(map.id, out.id)],
  };
}

// ─── Store ───

interface SignalGraphState {
  nodes: Node[];
  edges: Edge[];

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;

  // Compile et pousse le graph signal au backend (scope global —
  // `update_signal_graph` avec movement_id null → MergeRuntime).
  pushSignalGraph: () => Promise<void>;

  resetToDefault: () => void;
}

const STORAGE_KEY = 'stagespace-signal-graph-v1';

function loadFromStorage(): { nodes: Node[]; edges: Edge[] } | null {
  const parsed = safeParseStoredJson<{ nodes: Node[]; edges: Edge[] } | null>(STORAGE_KEY, null);
  if (!parsed?.nodes || !parsed?.edges) return null;
  const nodeIds = new Set(parsed.nodes.map((n: Node) => n.id));
  const validEdges = parsed.edges.filter(
    (e: Edge) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  if (validEdges.length !== parsed.edges.length) {
    console.warn('[signalGraph] Cached graph has invalid edges, discarding');
    return null;
  }
  return { nodes: parsed.nodes, edges: parsed.edges };
}

function saveToStorage(nodes: Node[], edges: Edge[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
}

const _defaultGraph = buildDefaultSignalGraph();
const _stored = loadFromStorage();

export const useSignalGraphStore = create<SignalGraphState>((set, get) => ({
  // Un graph signal vide ne compile pas (SignalOut requis) — on démarre
  // sur l'exemple LFO→yaw plutôt qu'un canvas vide qui refuserait le push.
  nodes: _stored?.nodes ?? _defaultGraph.nodes,
  edges: _stored?.edges ?? _defaultGraph.edges,

  setNodes: (nodes) => {
    set({ nodes });
    saveToStorage(nodes, get().edges);
  },

  setEdges: (edges) => {
    set({ edges });
    saveToStorage(get().nodes, edges);
  },

  updateNodeData: (id, data) => {
    const nodes = get().nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            data: {
              ...n.data,
              ...data,
              params: data.params && (n.data as any).params
                ? { ...(n.data as any).params, ...data.params }
                : (data.params ?? (n.data as any).params),
            },
          }
        : n,
    );
    set({ nodes });
    saveToStorage(nodes, get().edges);
  },

  pushSignalGraph: async () => {
    const { nodes, edges } = get();

    // Format React Flow attendu par build_graph_from_json.
    const graphJson = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: 'custom',
        position: n.position,
        data: {
          label: (n.data as any)?.label ?? (n.data as any)?.type ?? '',
          type: (n.data as any)?.type ?? 'SignalOut',
          params: (n.data as any)?.params ?? {},
        },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'output',
        targetHandle: e.targetHandle ?? 'signal',
      })),
    };

    try {
      await invoke('update_signal_graph', { graphJson, movementId: null });
    } catch (e) {
      console.error('[pushSignalGraph] Failed:', e);
      const { toast } = await import('../utils/toast-helpers');
      toast.error(`Signal graph push failed — macro modulation may be stale: ${e}`);
    }
  },

  resetToDefault: () => {
    const { nodes, edges } = buildDefaultSignalGraph();
    set({ nodes, edges });
    saveToStorage(nodes, edges);
  },
}));
