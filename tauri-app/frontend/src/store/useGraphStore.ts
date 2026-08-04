import React from 'react';
import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { safeListen as listen } from '../utils/tauri';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  MarkerType,
} from 'reactflow';
import { createPerfSlice, type PerfSlice } from './slices/perfSlice';
import { createAudioSlice, type AudioSlice } from './slices/audioSlice';
import { createOscSlice, type OscSlice } from './slices/oscSlice';
import { createPersistenceSlice, type PersistenceSlice } from './slices/persistenceSlice';
import { createMacrosSlice, type MacrosSlice } from './slices/macrosSlice';
import { createHolProjectSlice, type HolProjectSlice } from './slices/holProjectSlice';
import { createDrawModeSlice, type DrawModeSlice } from './slices/drawModeSlice';
import { createMovementSlice, type MovementSlice } from './slices/movementSlice';
import { createMoveSlotsSlice, type MoveSlotsSlice } from './slices/moveSlotsSlice';
import { createOscConfigSlice, type OscConfigSlice } from './slices/oscConfigSlice';
import { SHAPE_PRESETS } from '../utils/shapePresets';
import type {
  NodeType,
  AppStatus,
  MovementInfo,
  HolTrack,
  HolProject,
} from './types/index';

// Re-export types from slices for backward compatibility
export type { AudioState } from './slices/audioSlice';
export type { PerfStats } from './slices/perfSlice';
export type { OscMapping } from './slices/oscSlice';

// Re-export types from types/index for backward compatibility
export type { NodeType, AppStatus, MovementInfo, HolTrack, HolProject };

interface GraphState
  extends PerfSlice, AudioSlice, OscSlice, PersistenceSlice,
    MacrosSlice, HolProjectSlice, DrawModeSlice,
    MovementSlice, MoveSlotsSlice, OscConfigSlice {
  // React Flow state (single source of truth)
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;

  // Playback / status
  isPlaying: boolean;
  status: AppStatus;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  duration: number;
  compileError: string | null;
  playError: string | null;
  positions: Array<{ index: number; x: number; y: number; z: number }>;
  clearCompileError: () => void;
  clearPlayError: () => void;
  setPositions: (positions: Array<{ index: number; x: number; y: number; z: number }>) => void;

  // Compilation & playback
  compile: () => Promise<boolean>;
  playGraph: (oscAddress: string, oscPort: number, oscIds: number[], oscProfile: string) => Promise<void>;
  previewGraph: (oscIds: number[]) => Promise<void>;
  stopGraph: () => Promise<void>;
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
  // Incrémenté à chaque compilation/update — pour déclencher la visu de trajectoire
  graphCompileVersion: number;

  // .hol project import — extrait vers holProjectSlice

  // Macro controls — extraits vers macrosSlice

  // Track selection (from .hol import) — extraits vers holProjectSlice

  // Manual OSC IDs (quand pas de .hol — tracks virtuels) — extraits vers holProjectSlice

  // Manual object positions (drag in visualiseur + default circle) — extraits vers holProjectSlice
  manualPositions: Record<number, [number, number, number]>;
  setManualPosition: (index: number, pos: [number, number, number]) => void;
  setManualPositions: (positions: Record<number, [number, number, number]>) => void;
  resetManualPositions: (nObjects: number) => void;

  // Draw mode (freehand trajectory drawing) — extrait vers drawModeSlice

  // Multi-movement — extrait vers movementSlice

  // Shape presets
  applyShapePreset: (presetId: string, nObjects: number) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pushHistory: () => void;

  // Panic
  panic: () => Promise<void>;
}

export const useGraphStore = create<GraphState>()((...a) => {
  const [set, get] = a;
  return {
  ...createPerfSlice(...a),
  ...createAudioSlice(...a),
  ...createOscSlice(...a),
  ...createPersistenceSlice(...a),
  ...createMacrosSlice(...a),
  ...createHolProjectSlice(...a),
  ...createDrawModeSlice(...a),
  ...createMovementSlice(...a),
  ...createMoveSlotsSlice(...a),
  ...createOscConfigSlice(...a),

  // Graphe par défaut — preset Circle pour que l'Expert ne démarre jamais vide
  ...(() => {
    const preset = SHAPE_PRESETS[0]; // Circle
    return preset.build(8);
  })(),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as Node[] });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) as Edge[] });
  },
  onConnect: (connection) => {
    get().pushHistory();
    set({
      edges: rfAddEdge(
        { ...connection, markerEnd: { type: MarkerType.ArrowClosed } },
        get().edges,
      ) as Edge[],
    });
  },

  addNode: (node) => {
    get().pushHistory();
    set((s) => ({ nodes: [...s.nodes, node] }));
  },
  removeNode: (id) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
    }));
  },
  updateNodeData: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  isPlaying: false,
  status: 'idle',
  currentTime: 0,
  setCurrentTime: (t) => set({ currentTime: t }),
  duration: 4.0,
  compileError: null,
  playError: null,
  positions: [],
  clearCompileError: () => set({ compileError: null, status: get().isPlaying ? 'playing' : 'idle' }),
  clearPlayError: () => set({ playError: null, status: get().isPlaying ? 'playing' : 'idle' }),
  setPositions: (positions) => set({ positions }),
  graphCompileVersion: 0,

  compile: async () => {
    set({ compileError: null, status: 'compiling' });
    const { nodes, edges } = get();
    try {
      await invoke('compile_graph', { graphJson: { nodes, edges } });
      set({ status: 'compiled', graphCompileVersion: get().graphCompileVersion + 1 });
      return true;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      set({ compileError: message, status: 'error' });
      console.error('Compilation failed:', error);
      return false;
    }
  },

  playGraph: async (oscAddress, oscPort, oscIds, oscProfile) => {
    set({ playError: null });
    const { nodes, edges } = get();
    // Fusionner les params par défaut avant l'envoi
    const { prepareGraphForSave } = await import('../components/nodeParamSchema');
    const graphData = prepareGraphForSave(nodes, edges);
    try {
      await invoke('play_graph', {
        request: {
          graph_json: graphData,
          osc_address: oscAddress,
          osc_port: oscPort,
          osc_ids: oscIds,
          osc_profile: oscProfile,
        },
      });
      set({ isPlaying: true, status: 'playing' });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      set({ playError: message, isPlaying: false, status: 'error' });
      console.error('Playback failed:', error);
    }
  },

  previewGraph: async (oscIds) => {
    set({ playError: null });
    const { nodes, edges } = get();
    const { prepareGraphForSave } = await import('../components/nodeParamSchema');
    const graphData = prepareGraphForSave(nodes, edges);
    try {
      await invoke('preview_graph', {
        request: {
          graph_json: graphData,
          osc_address: '127.0.0.1',
          osc_port: 9999,
          osc_ids: oscIds,
          osc_profile: 'holophonix',
        },
      });
      set({ isPlaying: true, status: 'playing' });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      set({ playError: message, isPlaying: false, status: 'error' });
      console.error('Preview failed:', error);
    }
  },

  stopGraph: async () => {
    set({ isPlaying: false, status: 'idle' });
    try {
      await invoke('stop_graph');
    } catch (error: any) {
      console.error('Stop failed:', error);
    }
  },

  updateGraphLive: async (fadeDuration?: number) => {
    const { isPlaying, movements, nodes, edges } = get();
    const { useAnimationStore } = await import('./useAnimationStore');
    const { activeMovementIds, selectedMovementId } = useAnimationStore.getState();
    if (!isPlaying && movements.length === 0 && activeMovementIds.length === 0) return;
    const { prepareGraphForSave } = await import('../components/nodeParamSchema');
    const graphData = prepareGraphForSave(nodes, edges);
    const fade = fadeDuration ?? 0.3;
    try {
      if (isPlaying) {
        await invoke('update_graph', { graphJson: graphData, fadeDuration: fade });
      }
      // Hot-swap : si un movement est sélectionné, on ne swap que celui-ci.
      // Sinon, on swap tous les movements actifs (fallback).
      const allMovementIds = new Set([
        ...movements.map((m) => m.id),
        ...activeMovementIds,
      ]);
      const targetIds = selectedMovementId && allMovementIds.has(selectedMovementId)
        ? [selectedMovementId]
        : Array.from(allMovementIds);
      if (targetIds.length > 0) {
        await Promise.all(targetIds.map((movementId) =>
          invoke('update_movement_graph', {
            movementId,
            graphJson: graphData,
            fadeDuration: fade,
          }).catch((e: any) => console.error(`Hot-swap failed for movement ${movementId}:`, e))
        ));
      }
      set({ graphCompileVersion: get().graphCompileVersion + 1 });
    } catch (error: any) {
      console.error('Live update failed:', error);
    }
  },

  // Track selection — extrait vers holProjectSlice
  // Draw mode — extrait vers drawModeSlice

  applyShapePreset: (presetId, nObjects) => {
    import('../utils/shapePresets').then(({ SHAPE_PRESETS }) => {
      const preset = SHAPE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const { nodes: newNodes, edges: newEdges } = preset.build(nObjects);
      get().pushHistory();
      set({ nodes: newNodes, edges: newEdges });
      // Sync l'animation store : graph_json + name du preset
      import('./useAnimationStore').then(({ useAnimationStore }) => {
        const animState = useAnimationStore.getState();
        animState.setCurrent({
          ...animState.current,
          name: preset.name,
          graph_json: { nodes: newNodes, edges: newEdges },
        });
        // Hot-swap : uniquement le movement sélectionné (si un movement est sélectionné)
        // Si aucun movement sélectionné mais des movements actifs → on les swap tous (comportement fallback)
        const { isPlaying, movements } = get();
        const hasActiveMovements = isPlaying || movements.length > 0 || animState.activeMovementIds.length > 0;
        if (hasActiveMovements) {
          get().updateGraphLive(1.0);
        }
      });
    });
  },

  // ─── Undo/Redo ───
  _history: [] as Array<{ nodes: any[]; edges: any[] }>,
  _historyIndex: -1,
  canUndo: false,
  canRedo: false,
  pushHistory: () => {
    const { nodes, edges, _history, _historyIndex } = get() as any;
    const snapshot = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    const newHistory = _history.slice(0, _historyIndex + 1);
    newHistory.push(snapshot);
    // Limite à 50 entrées
    if (newHistory.length > 50) newHistory.shift();
    set({ _history: newHistory, _historyIndex: newHistory.length - 1, canUndo: newHistory.length > 1, canRedo: false } as any);
  },
  undo: () => {
    const { _history, _historyIndex } = get() as any;
    if (_historyIndex <= 0) return;
    const newIdx = _historyIndex - 1;
    const snapshot = _history[newIdx];
    set({
      nodes: JSON.parse(JSON.stringify(snapshot.nodes)),
      edges: JSON.parse(JSON.stringify(snapshot.edges)),
      _historyIndex: newIdx,
      canUndo: newIdx > 0,
      canRedo: true,
    } as any);
    // Hot-swap si en lecture
    if (get().isPlaying) get().updateGraphLive(0.3);
  },
  redo: () => {
    const { _history, _historyIndex } = get() as any;
    if (_historyIndex >= _history.length - 1) return;
    const newIdx = _historyIndex + 1;
    const snapshot = _history[newIdx];
    set({
      nodes: JSON.parse(JSON.stringify(snapshot.nodes)),
      edges: JSON.parse(JSON.stringify(snapshot.edges)),
      _historyIndex: newIdx,
      canUndo: true,
      canRedo: newIdx < _history.length - 1,
    } as any);
    if (get().isPlaying) get().updateGraphLive(0.3);
  },

  // ─── Panic ───
  panic: async () => {
    const { movements, holProject, manualOscIds } = get();
    // Stop immédiat — tous les movements + runtime legacy
    if (movements.length > 0) {
      await get().stopAllMovements();
    }
    if (get().isPlaying) {
      await get().stopGraph();
    }
    // Envoyer les positions d'origine à tous les récepteurs OSC
    const { safeInvoke: invoke } = await import('../utils/tauri');
    if (holProject) {
      for (const track of holProject.tracks) {
        try {
          await invoke('send_osc_position', {
            oscId: track.id,
            x: track.position[0],
            y: track.position[1],
            z: track.position[2],
          });
        } catch (e) {
          console.error('Panic: failed to send position for track', track.id, e);
        }
      }
    } else {
      // Sans .hol: envoyer position (0,0,0) pour tous les manualOscIds
      for (const id of manualOscIds) {
        try {
          await invoke('send_osc_position', { oscId: id, x: 0, y: 0, z: 0 });
        } catch (e) {
          console.error('Panic: failed to send position for id', id, e);
        }
      }
    }
  },

  };
});

// Hook to listen to position updates from Rust
export const usePositionListener = () => {
  const setPositions = useGraphStore((s) => s.setPositions);
  const setCurrentTime = useGraphStore((s) => s.setCurrentTime);

  React.useEffect(() => {
    const unlisten = listen('positions-update', (event: any) => {
      const { time, positions } = event.payload as {
        time: number;
        positions: Array<[number, [number, number, number]]>;
      };
      setPositions(positions.map(([index, [x, y, z]]) => ({ index, x, y, z })));
      setCurrentTime(time);
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [setPositions, setCurrentTime]);
};

// Hook to listen to OSC value updates from Rust
export const useOscValueListener = () => {
  const setOscValues = useGraphStore((s) => s.setOscValues);

  React.useEffect(() => {
    const unlisten = listen('osc-value-update', (event: any) => {
      const { handler, value } = event.payload as { handler: string; value: number[] };
      setOscValues((prev) => new Map(prev).set(handler, value));
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [setOscValues]);
};

// ── Movement positions listener — écoute les events movement-positions-* ──
// Optimisé: ne se re-subscribe que quand les movement IDs changent (pas à chaque poll)
export const useMovementPositionsListener = () => {
  const setMovementPositions = useGraphStore((s) => s.setMovementPositions);
  const movements = useGraphStore((s) => s.movements);
  const refreshMovements = useGraphStore((s) => s.refreshMovements);
  // Extraire juste les IDs pour éviter re-subscribe inutile au polling
  const movementIds = movements.map((m) => m.id).join(',');
  const movementsRef = React.useRef(movements);
  movementsRef.current = movements;

  // Écouter movements-update pour sync la liste des movements (launch/stop côté backend)
  React.useEffect(() => {
    const unlisten = listen('movements-update', () => {
      refreshMovements();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [refreshMovements]);

  React.useEffect(() => {
    const ids = movementIds.split(',').filter(Boolean);
    if (ids.length === 0) return;
    const unlistens: Array<Promise<() => void>> = [];
    for (const id of ids) {
      const eventName = `movement-positions-${id}`;
      const unlisten = listen(eventName, (event: any) => {
        const { positions } = event.payload as {
          time: number;
          positions: Array<[number, [number, number, number]]>;
        };
        setMovementPositions(
          id,
          positions.map(([index, [x, y, z]]) => ({ index, x, y, z })),
        );
      });
      unlistens.push(unlisten);
    }
    return () => {
      for (const p of unlistens) {
        p.then((fn) => fn()).catch(() => {});
      }
    };
  }, [movementIds, setMovementPositions]);
};

