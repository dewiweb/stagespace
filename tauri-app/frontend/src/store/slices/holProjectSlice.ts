import { StateCreator } from 'zustand';
import type { Node } from 'reactflow';
import { safeInvoke as invoke } from '../../utils/tauri';
import type { HolProject } from '../types/index';

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
  /// Définit directement la sélection de tracks (utilisé par selectSlotForEditing)
  setSelectedTrackIds: (ids: Set<number>) => void;
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

// syncObjectsNode accède à nodes, updateNodeData, addNode via get()
type HolProjectStore = HolProjectSlice & {
  nodes: Node[];
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  addNode: (node: Node) => void;
  // Pour sync inverse : mettre à jour le slot édité quand selectedTrackIds change
  editingSlotId: string | null;
  setSlotTracks: (id: string, trackIds: number[]) => void;
};

// Génère des positions en cercle pour n objets (radius adaptatif)
function defaultCirclePositions(n: number): Record<number, [number, number, number]> {
  const radius = n <= 4 ? 1.5 : n <= 8 ? 2.0 : n <= 16 ? 3.0 : n <= 32 ? 4.0 : 5.0;
  const positions: Record<number, [number, number, number]> = {};
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    // Backend coords: x=right, y=depth, z=up. Cercle horizontal → z=0
    positions[i] = [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0,
    ];
  }
  return positions;
}

/// Nombre de tracks virtuels par défaut quand pas de projet .hol
const DEFAULT_TRACK_COUNT = 64;

/// Sync inverse : quand selectedTrackIds change (via Inspector/TrackGrid),
/// mettre à jour les tracks du slot édité pour garder l'UI synchronisée.
function syncEditingSlotTracks(
  get: () => HolProjectStore,
  _set: (partial: Partial<HolProjectStore>) => void,
) {
  const { editingSlotId, selectedTrackIds, setSlotTracks } = get();
  if (!editingSlotId || !setSlotTracks) return;
  const trackIds = Array.from(selectedTrackIds).sort((a, b) => a - b);
  setSlotTracks(editingSlotId, trackIds);
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
      // Pousser les positions des tracks au backend (pour Barycenter node)
      const trackPositions: Record<number, [number, number, number]> = {};
      project.tracks.forEach((track) => {
        trackPositions[track.id] = track.position;
      });
      try {
        await invoke('set_track_positions', { positions: trackPositions });
      } catch (e) {
        console.error('[importHol] Failed to push track positions:', e);
      }
    } catch (error: any) {
      console.error('Failed to import .hol project:', error);
      throw error;
    }
  },
  clearHol: () => {
    set({ holProject: null, selectedTrackIds: new Set() });
    // Clear track positions au backend (pas de .hol → origin = [0,0,0])
    invoke('set_track_positions', { positions: {} }).catch(() => {});
  },

  // Track selection — pool de tracks virtuels (1..DEFAULT_TRACK_COUNT)
  // Pas de projet .hol → on offre un pool généreux, tous sélectionnés par défaut
  selectedTrackIds: new Set<number>(Array.from({ length: DEFAULT_TRACK_COUNT }, (_, i) => i + 1)),
  manualOscIds: Array.from({ length: DEFAULT_TRACK_COUNT }, (_, i) => i + 1),
  setManualOscIds: (ids) => set({ manualOscIds: ids }),

  // Manual positions — cercle par défaut
  manualPositions: defaultCirclePositions(DEFAULT_TRACK_COUNT),
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
    // Sync inverse : mettre à jour le slot édité
    syncEditingSlotTracks(get, set);
  },
  selectAllTracks: () => {
    set((s) => ({
      selectedTrackIds: new Set(s.holProject?.tracks.map((t) => t.id) ?? []),
    }));
    get().syncObjectsNode();
    syncEditingSlotTracks(get, set);
  },
  deselectAllTracks: () => {
    set({ selectedTrackIds: new Set() });
    get().syncObjectsNode();
    syncEditingSlotTracks(get, set);
  },
  setSelectedTrackIds: (ids) => {
    set({ selectedTrackIds: new Set(ids) });
    get().syncObjectsNode();
    // Pas de sync inverse ici — cette fonction est appelée par selectSlotForEditing
    // qui a déjà défini les tracks du slot
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

    // Types de nodes qui ont un paramètre n_objects à sync avec le node Objects
    const ENGINE_TYPES = new Set([
      'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
      'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
      'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
      'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
      'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
      'Mix', 'Group', 'Sequence', 'Crossfade',
    ]);

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

    // Sync n_objects sur tous les nodes engines (évite CountMismatch)
    // Le node Objects vient d'être mis à jour, on relit les nodes courants
    const currentNodes = get().nodes;
    currentNodes.forEach((node) => {
      const nodeType = (node.data as any)?.type as string;
      if (ENGINE_TYPES.has(nodeType)) {
        const params = (node.data as any)?.params ?? {};
        if (params.n_objects !== ids.length) {
          get().updateNodeData(node.id, { params: { ...params, n_objects: ids.length } });
        }
      }
    });

    // PAS de hot-swap ici — la sélection de tracks ne doit pas affecter
    // les moves en cours de lecture. Le hot-swap sera déclenché séparément
    // par updateGraphLive quand l'utilisateur modifie un paramètre du graphe.
  },
});
