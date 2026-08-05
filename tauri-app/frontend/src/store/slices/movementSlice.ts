import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import { computeCentroid } from '../utils/geometryUtils';
import type { Node, Edge } from 'reactflow';
import type { MovementInfo, HolProject } from '../types/index';

/// Graphe sauvegardé pour un movement — permet le [edit] (recharger le graphe dans l'éditeur)
export interface SavedGraph {
  nodes: Node[];
  edges: Edge[];
  trackIndices: number[];
  name: string;
}

export interface MovementSlice {
  // Multi-movement: plusieurs runtimes parallèles
  movements: MovementInfo[];
  movementPositions: Record<string, Array<{ index: number; x: number; y: number; z: number }>>;
  /// Graphes sauvegardés par movementId — pour le [edit] dans le panneau Moves
  savedGraphs: Record<string, SavedGraph>;
  setMovementPositions: (movementId: string, positions: Array<{ index: number; x: number; y: number; z: number }>) => void;
  playMovement: (name: string, trackIndices: number[], isPreview: boolean, oscAddress: string, oscPort: number, oscProfile: string) => Promise<string | null>;
  stopMovement: (movementId: string) => Promise<void>;
  stopMovementWithFade: (movementId: string, fadeDuration: number) => Promise<void>;
  stopAllMovements: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  /// Charge le graphe sauvegardé d'un movement dans l'éditeur (pour le [edit])
  loadMovementGraph: (movementId: string) => void;
}

type MovementStore = MovementSlice & {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  holProject: HolProject | null;
  manualOscIds: number[];
  graphCompileVersion: number;
  refreshMovements: () => Promise<void>;
};

export const createMovementSlice: StateCreator<MovementStore, [], [], MovementSlice> = (set, get) => ({
  movements: [],
  movementPositions: {},
  savedGraphs: {},

  setMovementPositions: (movementId, positions) =>
    set((s) => ({ movementPositions: { ...s.movementPositions, [movementId]: positions } })),

  playMovement: async (name, trackIndices, isPreview, _oscAddress, _oscPort, _oscProfile) => {
    const { nodes, edges, holProject, manualOscIds } = get();
    const { prepareGraphForSave } = await import('../../components/nodeParamSchema');
    const graphData = prepareGraphForSave(nodes, edges);

    // Récupérer les osc_ids correspondant aux trackIndices
    const oscIds = trackIndices.map((idx) => {
      if (holProject && idx < holProject.tracks.length) {
        return holProject.tracks[idx].id;
      }
      return manualOscIds[idx] ?? idx;
    });

    // Calculer l'isobarycentre des tracks ciblées — la trajectoire épouse la position de départ
    const origin = computeCentroid(holProject, trackIndices, manualOscIds);

    const movementId = `mv-${Date.now()}`;
    try {
      await invoke('activate_move', {
        request: {
          movement_id: movementId,
          name,
          graph_json: graphData,
          osc_ids: oscIds,
          track_indices: trackIndices,
          is_preview: isPreview,
          origin,
        },
      });
      // Sauvegarder le graphe pour le [edit]
      set((s) => ({
        savedGraphs: {
          ...s.savedGraphs,
          [movementId]: { nodes: [...nodes], edges: [...edges], trackIndices, name },
        },
      }));
      await get().refreshMovements(); // Await pour éviter race condition avec listener
      return movementId;
    } catch (e) {
      console.error('Failed to start movement:', e);
      return null;
    }
  },

  stopMovement: async (movementId) => {
    try {
      await invoke('deactivate_move', { movementId, fadeDuration: 0.0 });
      // Nettoyer les positions et le graphe sauvegardé
      set((s) => {
        const newPositions = { ...s.movementPositions };
        delete newPositions[movementId];
        const newSaved = { ...s.savedGraphs };
        delete newSaved[movementId];
        return { movementPositions: newPositions, savedGraphs: newSaved };
      });
      await get().refreshMovements(); // Await pour synchroniser listener
    } catch (e) {
      console.error('Failed to stop movement:', e);
      throw e;
    }
  },

  stopMovementWithFade: async (movementId, fadeDuration) => {
    try {
      await invoke('deactivate_move', { movementId, fadeDuration });
      set((s) => {
        const newPositions = { ...s.movementPositions };
        delete newPositions[movementId];
        const newSaved = { ...s.savedGraphs };
        delete newSaved[movementId];
        return { movementPositions: newPositions, savedGraphs: newSaved };
      });
      await get().refreshMovements();
    } catch (e) {
      console.error('Failed to stop movement with fade:', e);
      throw e;
    }
  },

  stopAllMovements: async () => {
    try {
      await invoke('deactivate_all_moves', { fadeDuration: 0.0 });
      set({ movementPositions: {}, savedGraphs: {} });
      await get().refreshMovements(); // Await pour synchroniser listener
    } catch (e) {
      console.error('Failed to stop all movements:', e);
    }
  },

  refreshMovements: async () => {
    try {
      const movements = await invoke<MovementInfo[]>('list_active_moves');
      set({ movements });
    } catch (e) {
      console.error('Failed to list movements:', e);
    }
  },

  loadMovementGraph: (movementId) => {
    const saved = get().savedGraphs[movementId];
    if (saved) {
      // Deep clone pour éviter de modifier le saved par référence
      get().setNodes(JSON.parse(JSON.stringify(saved.nodes)));
      get().setEdges(JSON.parse(JSON.stringify(saved.edges)));
    }
  },
});
