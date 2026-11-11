import { create } from 'zustand';
import { type Edge, MarkerType } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';
import type { NodeType } from '../types/generated/NodeType';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';
import { migrateStoredGraph } from '../utils/graphMigration';
import { createGraphHistory } from '../utils/graphHistory';
import { stripFrames } from '../utils/frameNode';
import { useGraphStore } from './useGraphStore';

// ─── Helpers ───

let nodeCounter = 0;
const genId = (type: string) => `${type.toLowerCase()}-signal-${Date.now()}-${nodeCounter++}`;

const makeNode = (type: NodeType, position: { x: number; y: number }, params: Record<string, any> = {}): GraphNode => ({
  id: genId(type),
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const makeEdge = (from: string, to: string, fromPort = 'out', toPort = 'signal'): Edge => ({
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

export function buildDefaultSignalGraph(): { nodes: GraphNode[]; edges: Edge[] } {
  const lfo = makeNode('SignalLfo', { x: 100, y: 200 }, {
    waveform: 'sine',
    frequency: 0.05,
    amplitude: 1.0,
    center: 0.0,
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
  nodes: GraphNode[];
  edges: Edge[];
  /// 'global' = modulation du MergeRuntime (macros) ; slotId = modulation
  /// per-move (cibles `param:` liées au graphe du slot).
  context: 'global' | string;

  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  /// Bascule le contexte d'édition — charge le graphe de modulation du
  /// slot (ou le global) dans le store.
  setContext: (slotId: string | null, slotGraph?: { nodes: GraphNode[]; edges: Edge[] } | null) => void;

  // Compile et pousse le graph signal au backend (scope global —
  // `update_signal_graph` avec movement_id null → MergeRuntime).
  pushSignalGraph: () => Promise<boolean>;

  resetToDefault: () => void;

  // Undo/redo — vidé au setContext (le graphe chargé change d'identité).
  undo: () => void;
  redo: () => void;
}

const STORAGE_KEY = 'stagespace-signal-graph-v1';

function loadFromStorage(): { nodes: GraphNode[]; edges: Edge[] } | null {
  const parsed = safeParseStoredJson<{ nodes: GraphNode[]; edges: Edge[] } | null>(STORAGE_KEY, null);
  // Même migration que le graphe global — types renommés/inconnus.
  return migrateStoredGraph(parsed, 'signalGraph');
}

function saveToStorage(nodes: GraphNode[], edges: Edge[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
}

/// Écrit les edits : global → localStorage ; slot → slot.signalGraph
/// (persisté avec les slots par moveSlotsSlice).
function persist(state: SignalGraphState, nodes: GraphNode[], edges: Edge[]) {
  if (state.context === 'global') {
    saveToStorage(nodes, edges);
  } else {
    // Accès différé (cycle useGraphStore → persistenceSlice → ce module).
    useGraphStore.getState().setSlotSignalGraph(state.context, { nodes, edges });
  }
}

const _defaultGraph = buildDefaultSignalGraph();
const _stored = loadFromStorage();
const history = createGraphHistory<GraphNode, Edge>();

export const useSignalGraphStore = create<SignalGraphState>((set, get) => ({
  // Un graph signal vide ne compile pas (SignalOut requis) — on démarre
  // sur l'exemple LFO→yaw plutôt qu'un canvas vide qui refuserait le push.
  nodes: _stored?.nodes ?? _defaultGraph.nodes,
  edges: _stored?.edges ?? _defaultGraph.edges,
  context: 'global',

  setNodes: (nodes) => {
    history.record(get().nodes, get().edges);
    set({ nodes });
    persist(get(), nodes, get().edges);
  },

  setEdges: (edges) => {
    history.record(get().nodes, get().edges);
    set({ edges });
    persist(get(), get().nodes, edges);
  },

  setContext: (slotId, slotGraph) => {
    const ctx = slotId ?? 'global';
    if (ctx === get().context) return;
    // Un autre graphe charge — l'historique de l'ancien contexte ne doit
    // pas pouvoir le restaurer ici.
    history.clear();
    if (ctx === 'global') {
      // Relire le storage frais — _stored est figé au chargement du
      // module : revenir à 'global' après un contexte slot écrasait
      // silencieusement tous les edits de session.
      const fresh = loadFromStorage();
      set({
        context: 'global',
        nodes: fresh?.nodes ?? _defaultGraph.nodes,
        edges: fresh?.edges ?? _defaultGraph.edges,
      });
    } else {
      set({
        context: ctx,
        nodes: slotGraph?.nodes ?? [],
        edges: slotGraph?.edges ?? [],
      });
    }
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
    persist(get(), nodes, get().edges);
  },

  pushSignalGraph: async () => {
    const { nodes, edges } = get();

    // Format React Flow attendu par build_graph_from_json.
    // Les frames (UI-only) sont filtrés — 'Frame' n'est pas un NodeType.
    const stripped = stripFrames(nodes, edges);
    const graphJson = {
      nodes: stripped.nodes.map((n) => ({
        id: n.id,
        type: 'custom',
        position: n.position,
        data: {
          label: n.data.label ?? n.data.type ?? '',
          type: n.data.type ?? 'SignalOut',
          params: n.data.params ?? {},
        },
      })),
      edges: stripped.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'out',
        targetHandle: e.targetHandle ?? 'signal',
      })),
    };

    try {
      // Contexte per-move : pousse sur le worker du slot s'il joue —
      // sinon le graphe est juste persisté (appliqué au prochain play).
      const ctx = get().context;
      const movementId =
        ctx === 'global'
          ? null
          : (useGraphStore.getState().moveSlots.find((s) => s.id === ctx)?.movementId ?? null);
      if (ctx !== 'global' && !movementId) return true;
      await invoke('update_signal_graph', { graphJson, movementId });
      return true;
    } catch (e) {
      console.error('[pushSignalGraph] Failed:', e);
      const { toast } = await import('../utils/toast-helpers');
      toast.error(`Signal graph push failed — macro modulation may be stale: ${e}`);
      return false;
    }
  },

  resetToDefault: () => {
    history.record(get().nodes, get().edges);
    const { nodes, edges } = buildDefaultSignalGraph();
    set({ nodes, edges });
    saveToStorage(nodes, edges);
  },

  undo: () => {
    const snap = history.undo(get().nodes, get().edges);
    if (!snap) return;
    set({ nodes: snap.nodes, edges: snap.edges });
    persist(get(), snap.nodes, snap.edges);
  },

  redo: () => {
    const snap = history.redo(get().nodes, get().edges);
    if (!snap) return;
    set({ nodes: snap.nodes, edges: snap.edges });
    persist(get(), snap.nodes, snap.edges);
  },
}));
