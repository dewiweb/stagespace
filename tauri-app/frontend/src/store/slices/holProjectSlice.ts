import { StateCreator } from 'zustand';
import type { GraphNode } from '../../components/nodeParamSchema';
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import type { HolProject } from '../types/index';
import { syncObjectsGraphNodes } from './objectsNodeSync';

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
  nodes: GraphNode[];
  updateNodeData: (id: string, data: Partial<Record<string, any>>) => void;
  addNode: (node: GraphNode) => void;
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
    // Live-guard : un .hol redéfinit le mapping track→osc_id — refusé pendant
    // le playback (le backend garde aussi, mais autant éviter le round-trip).
    if ((get() as { movements?: { length: number } }).movements?.length) {
      toast.warning('Cannot import a .hol project while moves are playing — stop all first');
      return;
    }
    try {
      const project = await invoke<HolProject>('import_hol_project', { filePath });
      // Le parser drop les données malformées — les surfacer (sticky si des
      // positions ont été perdues, sinon warning simple).
      if (project.warnings && project.warnings.length > 0) {
        const posLost = project.warnings.some((w) => w.includes('position') || w.includes('invalid'));
        toast.warning(
          `.hol imported with ${project.warnings.length} warning(s):\n${project.warnings.slice(0, 4).join('\n')}${project.warnings.length > 4 ? `\n… +${project.warnings.length - 4} more` : ''}`,
          posLost ? 0 : 8000,
        );
      }
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
        toast.warning(`Track positions not sent to backend — Barycenter/origin may be wrong: ${e}`);
      }
    } catch (error: any) {
      console.error('Failed to import .hol project:', error);
      throw error;
    }
  },
  clearHol: () => {
    if ((get() as { movements?: { length: number } }).movements?.length) {
      toast.warning('Cannot clear the .hol project while moves are playing — stop all first');
      return;
    }
    set({ holProject: null, selectedTrackIds: new Set() });
    // Clear track positions au backend (pas de .hol → origin = [0,0,0])
    invoke('set_track_positions', { positions: {} }).catch((e) => {
      console.error('[clearHol] set_track_positions failed:', e);
    });
  },

  // Track selection — pool de tracks virtuels (1..DEFAULT_TRACK_COUNT)
  // Pas de projet .hol → on offre un pool généreux, tous sélectionnés par défaut
  selectedTrackIds: new Set<number>(Array.from({ length: DEFAULT_TRACK_COUNT }, (_, i) => i + 1)),
  manualOscIds: Array.from({ length: DEFAULT_TRACK_COUNT }, (_, i) => i + 1),
  setManualOscIds: (ids) => {
    // Resync la sélection : sans projet .hol, selectedTrackIds sont des OSC ids
    // — une sélection qui dépasse les nouveaux ids enverrait des tracks
    // inexistants au backend (computeTrackIndices les skip → move vide).
    set((s) => ({
      manualOscIds: ids,
      selectedTrackIds: s.holProject
        ? s.selectedTrackIds
        : new Set([...s.selectedTrackIds].filter((id) => ids.includes(id))),
    }));
    get().syncObjectsNode();
    syncEditingSlotTracks(get, set);
  },

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
      // Sans projet .hol, "select all" = tous les OSC IDs manuels —
      // sinon la sélection se vide et le move part avec 0 track.
      selectedTrackIds: new Set(
        s.holProject ? s.holProject.tracks.map((t) => t.id) : s.manualOscIds
      ),
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
    // Mutation du graphe partagée avec syncObjectsNodeNoHotSwap
    // (objectsNodeSync.ts) — createIfMissing : ce chemin crée le node
    // Objects s'il n'existe pas, contrairement au switch de slot.
    syncObjectsGraphNodes(get, { createIfMissing: true });
  },
});
