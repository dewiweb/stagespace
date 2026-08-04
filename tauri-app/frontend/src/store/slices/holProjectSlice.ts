import { StateCreator } from 'zustand';
import type { Node } from 'reactflow';
import { safeInvoke as invoke } from '../../utils/tauri';
import type { HolProject, MovementInfo } from '../types/index';

export interface HolProjectSlice {
  // .hol project import
  holProject: HolProject | null;
  importHol: (filePath: string) => Promise<void>;
  clearHol: () => void;

  // Track selection (from .hol import)
  selectedTrackIds: Set<number>;
  toggleTrackSelection: (trackId: number) => void;
  selectAllTracks: () => void;
  deselectAllTracks: () => void;
  getSelectedOscIds: () => number[];
  syncObjectsNode: () => void;

  // Manual OSC IDs (quand pas de .hol — tracks virtuels)
  manualOscIds: number[];
  setManualOscIds: (ids: number[]) => void;

  // Manual object positions — positions persistées des objets dans le visualiseur
  // Utilisé pour: positions initiales (cercle par défaut) + drag en manipulate mode
  // Key = index de l'objet (0-based), Value = [x, y, z]
  manualPositions: Record<number, [number, number, number]>;
  setManualPosition: (index: number, pos: [number, number, number]) => void;
  setManualPositions: (positions: Record<number, [number, number, number]>) => void;
  resetManualPositions: (nObjects: number) => void;
}

// syncObjectsNode accède à nodes, updateNodeData, addNode, isPlaying, movements, updateGraphLive via get()
type HolProjectStore = HolProjectSlice & {
  nodes: Node[];
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  addNode: (node: Node) => void;
  isPlaying: boolean;
  movements: MovementInfo[];
  updateGraphLive: (fadeDuration?: number) => Promise<void>;
};

// Génère des positions en cercle pour n objets (radius adaptatif)
function defaultCirclePositions(n: number): Record<number, [number, number, number]> {
  const radius = n <= 4 ? 1.5 : n <= 8 ? 2.0 : 2.5;
  const positions: Record<number, [number, number, number]> = {};
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    positions[i] = [
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    ];
  }
  return positions;
}

export const createHolProjectSlice: StateCreator<HolProjectStore, [], [], HolProjectSlice> = (set, get) => ({
  holProject: null,
  importHol: async (filePath) => {
    try {
      const project = await invoke<HolProject>('import_hol_project', { filePath });
      // Auto-sélectionner tous les tracks
      const allIds = new Set(project.tracks.map((t) => t.id));
      // Initialiser manualPositions depuis les tracks du .hol
      const positions: Record<number, [number, number, number]> = {};
      project.tracks.forEach((track, i) => {
        positions[i] = track.position;
      });
      set({ holProject: project, selectedTrackIds: allIds, manualPositions: positions });
      // Sync le node Objects avec les tracks
      get().syncObjectsNode();
    } catch (error: any) {
      console.error('Failed to import .hol project:', error);
      throw error;
    }
  },
  clearHol: () => set({ holProject: null, selectedTrackIds: new Set() }),

  // Track selection — tous sélectionnés par défaut (cohérent avec getSelectedOscIds)
  selectedTrackIds: new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 9]),
  manualOscIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  setManualOscIds: (ids) => set({ manualOscIds: ids }),

  // Manual positions — cercle par défaut pour 9 objets
  manualPositions: defaultCirclePositions(9),
  setManualPosition: (index, pos) =>
    set((s) => ({ manualPositions: { ...s.manualPositions, [index]: pos } })),
  setManualPositions: (positions) => set({ manualPositions: positions }),
  resetManualPositions: (nObjects) => set({ manualPositions: defaultCirclePositions(nObjects) }),

  toggleTrackSelection: (trackId) => {
    const s = get();
    const next = new Set(s.selectedTrackIds);
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    set({ selectedTrackIds: next });
    // Sync Objects node + hot-swap si en lecture
    get().syncObjectsNode();
  },
  selectAllTracks: () => {
    set((s) => ({
      selectedTrackIds: new Set(s.holProject?.tracks.map((t) => t.id) ?? []),
    }));
    get().syncObjectsNode();
  },
  deselectAllTracks: () => {
    set({ selectedTrackIds: new Set() });
    get().syncObjectsNode();
  },
  getSelectedOscIds: () => {
    const s = get();
    // Retourne les tracks sélectionnés, ou empty array si aucun
    // (plus de fallback — selectedTrackIds est initialisé avec tous les tracks par défaut)
    return Array.from(s.selectedTrackIds).sort((a, b) => a - b);
  },
  syncObjectsNode: () => {
    const s = get();
    const ids = s.getSelectedOscIds();
    // Même si ids est vide, on met à jour (pour montrer 0 objets si l'utilisateur désélectionne tout)
    // Mais on ne crée pas de node Objects si la liste est vide et qu'il n'y a pas de node existant
    if (ids.length === 0 && !s.nodes.find((n) => (n.data as any)?.type === 'Objects')) return;

    // Trouver le node Objects et mettre à jour n_objects
    const objectsNode = s.nodes.find((n) => (n.data as any)?.type === 'Objects');
    if (objectsNode) {
      const newParams = { ...(objectsNode.data as any).params, n_objects: ids.length, track_ids: ids };
      get().updateNodeData(objectsNode.id, { params: newParams });
    } else {
      // Créer un node Objects s'il n'existe pas
      const newId = `objects-${Date.now()}`;
      get().addNode({
        id: newId,
        type: 'custom',
        position: { x: 50, y: 250 },
        data: { label: 'Objects', type: 'Objects', params: { n_objects: ids.length, track_ids: ids } },
      });
    }

    // Hot-swap si en lecture (runtime legacy ou movements)
    if (s.isPlaying || s.movements.length > 0) {
      get().updateGraphLive(0.3);
    }
  },
});
