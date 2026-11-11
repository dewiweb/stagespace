import { create } from 'zustand';
import { type Edge, MarkerType } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';
import type { NodeType } from '../types/generated/NodeType';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';
import { migrateStoredGraph } from '../utils/graphMigration';
import { createGraphHistory } from '../utils/graphHistory';
import { stripFrames } from '../utils/frameNode';

// ─── Helpers ───

let nodeCounter = 0;
const genId = (type: string) => `${type.toLowerCase()}-global-${Date.now()}-${nodeCounter++}`;

const makeNode = (type: NodeType, position: { x: number; y: number }, params: Record<string, any> = {}): GraphNode => ({
  id: genId(type),
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const makeEdge = (from: string, to: string, fromPort = 'out', toPort = 'in'): Edge => ({
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

export function buildDefaultGlobalGraph(): { nodes: GraphNode[]; edges: Edge[] } {
  const input = makeNode('Merge', { x: 50, y: 250 }, { label: 'Merged Positions' });
  input.data.type = 'Merge';
  input.data.label = 'Merged';

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
  nodes: GraphNode[];
  edges: Edge[];
  isGlobalGraphEnabled: boolean;

  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  toggleEnabled: () => void;

  // Compiler et pousser le graph global au backend
  pushGlobalGraph: () => Promise<boolean>;

  // Reset au graph par défaut
  resetToDefault: () => void;

  // Undo/redo — même sémantique burst-fusionnée que le store sub.
  undo: () => void;
  redo: () => void;
}

const STORAGE_KEY = 'stagespace-global-graph-v4';

function loadFromStorage(): { nodes: GraphNode[]; edges: Edge[] } | null {
  const parsed = safeParseStoredJson<{ nodes: GraphNode[]; edges: Edge[] } | null>(STORAGE_KEY, null);
  // Migre les types renommés (Input→Merge), drop les inconnus et les
  // edges orphelins — un graphe stale doit se réparer, pas spammer des
  // toasts ParseError à chaque push.
  return migrateStoredGraph(parsed, 'globalGraph');
}

function saveToStorage(nodes: GraphNode[], edges: Edge[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
}

// Initialiser une seule fois pour que les IDs des nodes et edges correspondent
const _defaultGraph = buildDefaultGlobalGraph();
const _stored = loadFromStorage();
const history = createGraphHistory<GraphNode, Edge>();

export const useGlobalGraphStore = create<GlobalGraphState>((set, get) => ({
  nodes: _stored?.nodes ?? _defaultGraph.nodes,
  edges: _stored?.edges ?? _defaultGraph.edges,
  isGlobalGraphEnabled: true,

  setNodes: (nodes) => {
    history.record(get().nodes, get().edges);
    set({ nodes });
    saveToStorage(nodes, get().edges);
  },

  setEdges: (edges) => {
    history.record(get().nodes, get().edges);
    set({ edges });
    saveToStorage(get().nodes, edges);
  },

  updateNodeData: (id, data) => {
    history.record(get().nodes, get().edges);
    const nodes = get().nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            data: {
              ...n.data,
              ...data,
              params: data.params && n.data.params
                ? { ...n.data.params, ...data.params }
                : (data.params ?? n.data.params),
            },
          }
        : n,
    );
    set({ nodes });
    saveToStorage(nodes, get().edges);
  },

  toggleEnabled: () => set((s) => ({ isGlobalGraphEnabled: !s.isGlobalGraphEnabled })),

  pushGlobalGraph: async () => {
    const { nodes, edges, isGlobalGraphEnabled } = get();
    if (!isGlobalGraphEnabled) return true;

    // Préparer le graph pour le backend — format React Flow (data.type, data.params)
    // Le parser Rust (build_graph_from_json) attend ce format.
    // Les frames (UI-only) sont filtrés — 'Frame' n'est pas un NodeType.
    const stripped = stripFrames(nodes, edges);
    const graphJson = {
      nodes: stripped.nodes.map((n) => ({
        id: n.id,
        type: 'custom',
        position: n.position,
        data: {
          label: n.data.label ?? n.data.type ?? '',
          type: n.data.type ?? 'Output',
          params: n.data.params ?? {},
        },
      })),
      edges: stripped.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'out',
        targetHandle: e.targetHandle ?? 'in',
      })),
    };

    try {
      await invoke('update_global_graph', { graphJson });
      // L'origin du post-process global = centroïde de TOUTES les tracks
      // (pas celle du dernier move spawné — le backend n'y touche plus).
      const { useGraphStore } = await import('./useGraphStore');
      const { computeCentroid } = await import('./utils/geometryUtils');
      const { holProject, manualOscIds } = useGraphStore.getState();
      const origin = computeCentroid(holProject, [], manualOscIds);
      await invoke('set_global_origin', { origin });
      return true;
    } catch (e) {
      console.error('[pushGlobalGraph] Failed:', e);
      // Le post-process global ne correspond plus à l'éditeur — critique en live.
      const { toast } = await import('../utils/toast-helpers');
      toast.error(`Global graph push failed — post-processing may be stale: ${e}`);
      return false;
    }
  },

  resetToDefault: () => {
    history.record(get().nodes, get().edges);
    const { nodes, edges } = buildDefaultGlobalGraph();
    set({ nodes, edges });
    saveToStorage(nodes, edges);
  },

  undo: () => {
    const snap = history.undo(get().nodes, get().edges);
    if (!snap) return;
    set({ nodes: snap.nodes, edges: snap.edges });
    saveToStorage(snap.nodes, snap.edges);
  },

  redo: () => {
    const snap = history.redo(get().nodes, get().edges);
    if (!snap) return;
    set({ nodes: snap.nodes, edges: snap.edges });
    saveToStorage(snap.nodes, snap.edges);
  },
}));
