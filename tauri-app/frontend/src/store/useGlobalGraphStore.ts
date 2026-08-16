import { create } from 'zustand';
import { type Node, type Edge, MarkerType } from 'reactflow';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeSetItem } from '../utils/safeStorage';

// ─── Helpers ───

let nodeCounter = 0;
const genId = (type: string) => `${type.toLowerCase()}-global-${Date.now()}-${nodeCounter++}`;

const makeNode = (type: string, position: { x: number; y: number }, params: Record<string, any> = {}): Node => ({
  id: genId(type),
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const makeEdge = (from: string, to: string, fromPort = 'output', toPort = 'input'): Edge => ({
  id: `${from}-${to}`,
  source: from,
  target: to,
  sourceHandle: fromPort,
  targetHandle: toPort,
  markerEnd: { type: MarkerType.ArrowClosed },
});

// ─── Graph global par défaut ───
// Reproduit le comportement hardcodé d'avant la Phase 2 :
// radius_scale → height_offset → per_track_depth → scale → rotate → offset → output

export function buildDefaultGlobalGraph(): { nodes: Node[]; edges: Edge[] } {
  const input = makeNode('Input', { x: 50, y: 250 }, { label: 'Merged Positions' });
  (input.data as any).type = 'Input';
  (input.data as any).label = 'Merged';

  // ManualPosition first — override positions from drag 3D
  const manualPos = makeNode('ManualPosition', { x: 230, y: 250 });
  const radiusScale = makeNode('RadiusScale', { x: 410, y: 250 }, { radius_scale: 1.0 });
  const heightOffset = makeNode('HeightOffset', { x: 580, y: 250 }, { height_offset: 0.0 });
  const perTrackDepth = makeNode('PerTrackDepth', { x: 750, y: 250 }, { depths: [] });
  const scale = makeNode('Scale', { x: 920, y: 250 }, { scale: 1.0 });
  const rotate = makeNode('Rotate', { x: 1090, y: 250 }, { yaw: 0, pitch: 0, roll: 0 });
  const offset = makeNode('Offset', { x: 1260, y: 250 }, { x: 0, y: 0, z: 0 });
  const output = makeNode('Output', { x: 1430, y: 250 });

  const nodes = [input, manualPos, radiusScale, heightOffset, perTrackDepth, scale, rotate, offset, output];
  const edges = [
    makeEdge(input.id, manualPos.id),
    makeEdge(manualPos.id, radiusScale.id),
    makeEdge(radiusScale.id, heightOffset.id),
    makeEdge(heightOffset.id, perTrackDepth.id),
    makeEdge(perTrackDepth.id, scale.id),
    makeEdge(scale.id, rotate.id),
    makeEdge(rotate.id, offset.id),
    makeEdge(offset.id, output.id),
  ];

  return { nodes, edges };
}

// ─── Store ───

interface GlobalGraphState {
  nodes: Node[];
  edges: Edge[];
  isGlobalGraphEnabled: boolean;

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  toggleEnabled: () => void;

  // Compiler et pousser le graph global au backend
  pushGlobalGraph: () => Promise<void>;

  // Reset au graph par défaut
  resetToDefault: () => void;
}

const STORAGE_KEY = 'stagespace-global-graph-v4';

function loadFromStorage(): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.nodes || !parsed.edges) return null;
    // Validation : vérifier que tous les edges référencent des nodes existants
    const nodeIds = new Set(parsed.nodes.map((n: Node) => n.id));
    const validEdges = parsed.edges.filter(
      (e: Edge) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    if (validEdges.length !== parsed.edges.length) {
      console.warn('[globalGraph] Cached graph has invalid edges, discarding');
      return null;
    }
    return { nodes: parsed.nodes, edges: parsed.edges };
  } catch {}
  return null;
}

function saveToStorage(nodes: Node[], edges: Edge[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
}

// Initialiser une seule fois pour que les IDs des nodes et edges correspondent
const _defaultGraph = buildDefaultGlobalGraph();
const _stored = loadFromStorage();

export const useGlobalGraphStore = create<GlobalGraphState>((set, get) => ({
  nodes: _stored?.nodes ?? _defaultGraph.nodes,
  edges: _stored?.edges ?? _defaultGraph.edges,
  isGlobalGraphEnabled: true,

  setNodes: (nodes) => {
    set({ nodes });
    saveToStorage(nodes, get().edges);
  },

  setEdges: (edges) => {
    set({ edges });
    saveToStorage(get().nodes, edges);
  },

  toggleEnabled: () => set((s) => ({ isGlobalGraphEnabled: !s.isGlobalGraphEnabled })),

  pushGlobalGraph: async () => {
    const { nodes, edges, isGlobalGraphEnabled } = get();
    if (!isGlobalGraphEnabled) return;

    // Préparer le graph pour le backend — format React Flow (data.type, data.params)
    // Le parser Rust (build_graph_from_json) attend ce format
    const graphJson = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: 'custom',
        position: n.position,
        data: {
          label: (n.data as any)?.label ?? (n.data as any)?.type ?? '',
          type: (n.data as any)?.type ?? 'Output',
          params: (n.data as any)?.params ?? {},
        },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'output',
        targetHandle: e.targetHandle ?? 'input',
      })),
    };

    try {
      await invoke('update_global_graph', { graphJson });
    } catch (e) {
      console.error('[pushGlobalGraph] Failed:', e);
    }
  },

  resetToDefault: () => {
    const { nodes, edges } = buildDefaultGlobalGraph();
    set({ nodes, edges });
    saveToStorage(nodes, edges);
  },
}));
