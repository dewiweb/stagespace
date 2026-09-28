import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import { safeSetItem, safeParseStoredJson } from '../utils/safeStorage';
import type { Cue } from '../types/generated/Cue';
import type { StoreCueRequest } from '../types/generated/StoreCueRequest';

/// Cue complet tel que sérialisé par le backend — type généré (ts-rs).
/// Inclut `moves`/`object_channels` capturés côté Rust au store.
export type CueData = Cue;

interface CuelistState {
  cues: CueData[];
  currentCueIndex: number;
  isRecalling: boolean;

  loadFromStorage: () => void;
  saveToStorage: () => void;
  storeCue: (cue: StoreCueRequest) => Promise<CueData>;
  recallCue: (cueId: string) => Promise<void>;
  deleteCue: (cueId: string) => void;
  /// Met à jour un cue en place (fade_duration éditable post-store) —
  /// la cuelist vit côté frontend (localStorage), le backend n'en garde
  /// pas de copie.
  updateCue: (cue: CueData) => void;
  goToNextCue: () => Promise<void>;
  goToPreviousCue: () => Promise<void>;
}

const STORAGE_KEY = 'stagespace-cuelist';

function loadFromStorage(): CueData[] {
  return safeParseStoredJson<CueData[]>(STORAGE_KEY, []);
}

function saveToStorage(cues: CueData[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(cues));
}

export const useCuelistStore = create<CuelistState>((set, get) => ({
  cues: loadFromStorage(),
  currentCueIndex: -1,
  isRecalling: false,

  loadFromStorage: () => {
    set({ cues: loadFromStorage() });
  },

  saveToStorage: () => {
    saveToStorage(get().cues);
  },

  storeCue: async (cueData) => {
    try {
      // Appeler le backend pour créer le cue (valide la structure)
      const cue = await invoke<CueData>('store_cue', { request: cueData });
      const cues = [...get().cues, cue];
      set({ cues });
      saveToStorage(cues);
      return cue;
    } catch (e) {
      console.error('[storeCue] Failed:', e);
      toast.error('Failed to store cue: ' + e);
      throw e;
    }
  },

  recallCue: async (cueId: string) => {
    if (get().isRecalling) return; // empêche les recalls concurrents
    const cue = get().cues.find((c) => c.id === cueId);
    if (!cue) return;
    set({ isRecalling: true });
    try {
      await invoke('recall_cue', { cue });
      const idx = get().cues.findIndex((c) => c.id === cueId);
      set({ currentCueIndex: idx });
      // Cue legacy (pré-Phase5) : `moves` est vide, le backend a désactivé
      // les moves mais ne peut pas respawner — le graphe vit dans cue.graph.
      // Le restaurer dans l'éditeur et le rejouer, sinon le show reste muet.
      if ((!cue.moves || cue.moves.length === 0) && cue.graph) {
        const g = cue.graph as { nodes?: unknown[]; edges?: unknown[] };
        if (Array.isArray(g.nodes) && g.nodes.length > 0) {
          const { useGraphStore } = await import('./useGraphStore');
          const gs = useGraphStore.getState();
          gs.setNodes(g.nodes as never);
          gs.setEdges(Array.isArray(g.edges) ? (g.edges as never) : []);
          gs.autoSaveToEditingSlot();
          const id = await gs.playMovement(cue.name, cue.track_indices ?? [], false, '', 0, '');
          if (id) {
            toast.info(`Legacy cue "${cue.name}" — graph restored and replayed`);
          } else {
            toast.error(`Legacy cue "${cue.name}" — graph restored but replay failed`, 0);
          }
        }
      }
    } catch (e) {
      console.error('[recallCue] Failed:', e);
      toast.error('Cue recall failed: ' + e);
    } finally {
      set({ isRecalling: false });
    }
  },

  deleteCue: (cueId: string) => {
    const { cues, currentCueIndex } = get();
    const currentCue = currentCueIndex >= 0 ? cues[currentCueIndex] : null;
    const filtered = cues.filter((c) => c.id !== cueId);
    // Ne JAMAIS reset à -1 : le prochain GO sauterait au cue 1 au lieu de
    // suivre la position courante. Si le cue courant est supprimé, se placer
    // juste avant le cue suivant pour que GO le rappelle.
    let newIndex = -1;
    if (currentCue) {
      newIndex = currentCue.id === cueId
        ? Math.min(currentCueIndex, filtered.length) - 1
        : filtered.findIndex((c) => c.id === currentCue.id);
    }
    set({ cues: filtered, currentCueIndex: newIndex });
    saveToStorage(filtered);
  },

  updateCue: (cue) => {
    const cues = get().cues.map((c) => (c.id === cue.id ? cue : c));
    set({ cues });
    saveToStorage(cues);
  },

  goToNextCue: async () => {
    const { cues, currentCueIndex } = get();
    if (currentCueIndex + 1 >= cues.length) {
      toast.info(cues.length === 0 ? 'No cues in list' : 'End of cue list');
      return;
    }
    const nextCue = cues[currentCueIndex + 1];
    await get().recallCue(nextCue.id);
  },

  goToPreviousCue: async () => {
    const { cues, currentCueIndex } = get();
    if (currentCueIndex <= 0) {
      toast.info(cues.length === 0 ? 'No cues in list' : 'Already at first cue');
      return;
    }
    const prevCue = cues[currentCueIndex - 1];
    await get().recallCue(prevCue.id);
  },
}));
