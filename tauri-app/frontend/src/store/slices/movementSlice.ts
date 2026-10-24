import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { computeCentroid } from '../utils/geometryUtils';
import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../../components/nodeParamSchema';
import type { MovementInfo, HolProject } from '../types/index';

/// Graphe sauvegardé pour un movement — permet le [edit] (recharger le graphe dans l'éditeur)
export interface SavedGraph {
  nodes: GraphNode[];
  edges: Edge[];
  trackIndices: number[];
  name: string;
}

/// Objet mutable hors-store pour les positions à 60 FPS.
/// Évite les re-renders React massifs quand setMovementPositions est appelé 60x/seconde.
/// Le render loop lit via storeState.movementPositions (référence stable vers cet objet).
const _movementPositionsExternal: Record<string, Array<{ index: number; x: number; y: number; z: number }>> = {};

/// Anti-spam : refreshMovements tourne après chaque play/stop — si le backend
/// est mort on ne veut pas 20 toasts. Un seul toast par fenêtre de 10s.
let _lastRefreshErrorToastAt = 0;

export interface MovementSlice {
  // Multi-movement: plusieurs runtimes parallèles
  movements: MovementInfo[];
  movementPositions: Record<string, Array<{ index: number; x: number; y: number; z: number }>>;
  /// Graphes sauvegardés par movementId — pour le [edit] dans le panneau Moves
  savedGraphs: Record<string, SavedGraph>;
  setMovementPositions: (movementId: string, positions: Array<{ index: number; x: number; y: number; z: number }>) => void;
  clearMovementPositions: () => void;
  playMovement: (name: string, trackIndices: number[], isPreview: boolean, oscAddress: string, oscPort: number, oscProfile: string) => Promise<string | null>;
  stopMovement: (movementId: string) => Promise<void>;
  stopMovementWithFade: (movementId: string, fadeDuration: number) => Promise<void>;
  stopAllMovements: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  /// Charge le graphe sauvegardé d'un movement dans l'éditeur (pour le [edit])
  loadMovementGraph: (movementId: string) => void;
  /// Stratégie de résolution quand plusieurs moves actifs ciblent la même
  /// track (override|crossfade|blend|priority). Un node Merge du graphe
  /// global peut aussi la fixer — le dernier écrivain gagne.
  mergeStrategy: string;
  setMergeStrategy: (strategy: string) => Promise<void>;
}

type MovementStore = MovementSlice & {
  nodes: GraphNode[];
  edges: Edge[];
  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  holProject: HolProject | null;
  manualOscIds: number[];
  graphCompileVersion: number;
  refreshMovements: () => Promise<void>;
  // Undo + auto-save du slot édité — optionnels dans la vue structurelle,
  // présents sur le store combiné.
  pushHistory?: () => void;
  autoSaveToEditingSlot?: () => void;
};

export const createMovementSlice: StateCreator<MovementStore, [], [], MovementSlice> = (set, get) => ({
  movements: [],
  // Référence stable vers l'objet mutable — pas de set() à 60 FPS
  movementPositions: _movementPositionsExternal,
  savedGraphs: {},

  setMovementPositions: (movementId, positions) => {
    // Mutation directe — pas de set() pour éviter 60 re-renders/seconde
    _movementPositionsExternal[movementId] = positions;
  },
  clearMovementPositions: () => {
    for (const k of Object.keys(_movementPositionsExternal)) delete _movementPositionsExternal[k];
  },

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
      toast.error('Failed to start movement: ' + e);
      return null;
    }
  },

  stopMovement: async (movementId) => {
    try {
      await invoke('deactivate_move', { movementId, fadeDuration: 0.0 });
      // Nettoyer l'objet mutable directement (pas de set())
      delete _movementPositionsExternal[movementId];
      delete _movementPositionsExternal['global'];
      set((s) => {
        const newSaved = { ...s.savedGraphs };
        delete newSaved[movementId];
        return { savedGraphs: newSaved };
      });
      // Fire-and-forget : le movementId du slot est déjà cleared,
      // refreshMovements sert seulement à mettre à jour le panneau d'inspection
      get().refreshMovements();
    } catch (e) {
      console.error('Failed to stop movement:', e);
      toast.error('Failed to stop movement: ' + e);
      throw e;
    }
  },

  stopMovementWithFade: async (movementId, fadeDuration) => {
    try {
      await invoke('deactivate_move', { movementId, fadeDuration });
      delete _movementPositionsExternal[movementId];
      delete _movementPositionsExternal['global'];
      set((s) => {
        const newSaved = { ...s.savedGraphs };
        delete newSaved[movementId];
        return { savedGraphs: newSaved };
      });
      get().refreshMovements();
    } catch (e) {
      console.error('Failed to stop movement with fade:', e);
      toast.error('Failed to stop movement with fade: ' + e);
      throw e;
    }
  },

  stopAllMovements: async () => {
    try {
      await invoke('deactivate_all_moves', { fadeDuration: 0.0 });
      // Vider l'objet mutable
      for (const k of Object.keys(_movementPositionsExternal)) delete _movementPositionsExternal[k];
      set({ savedGraphs: {} });
      get().refreshMovements();
    } catch (e) {
      console.error('Failed to stop all movements:', e);
      toast.error('Stop all failed: ' + e);
      // Rethrow : panic() doit savoir que le stop a échoué (sinon il
      // afficherait "all moves stopped" alors que des moves tournent).
      throw e;
    }
  },

  refreshMovements: async () => {
    try {
      const movements = await invoke<MovementInfo[]>('list_active_moves');
      set({ movements });
    } catch (e) {
      console.error('Failed to list movements:', e);
      const now = Date.now();
      if (now - _lastRefreshErrorToastAt > 10_000) {
        _lastRefreshErrorToastAt = now;
        toast.error(`Cannot list running movements: ${e}`);
      }
    }
  },

  loadMovementGraph: (movementId) => {
    const saved = get().savedGraphs[movementId];
    if (saved) {
      if (!Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) {
        toast.error(`Saved graph for "${movementId}" is corrupted — cannot load`);
        return;
      }
      // pushHistory AVANT de remplacer le graphe (undo ramène au graphe courant)
      get().pushHistory?.();
      // Deep clone pour éviter de modifier le saved par référence
      get().setNodes(JSON.parse(JSON.stringify(saved.nodes)));
      get().setEdges(JSON.parse(JSON.stringify(saved.edges)));
      // Persister vers le slot en édition — sinon le graphe chargé est perdu
      get().autoSaveToEditingSlot?.();
    }
  },

  mergeStrategy: 'override',
  setMergeStrategy: async (strategy) => {
    try {
      await invoke('set_merge_strategy', { strategy });
      set({ mergeStrategy: strategy });
    } catch (e) {
      console.error('Failed to set merge strategy:', e);
      toast.error(`Merge strategy failed: ${e}`);
      throw e;
    }
  },
});
