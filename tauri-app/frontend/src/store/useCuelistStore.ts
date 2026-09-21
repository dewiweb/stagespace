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
    } catch (e) {
      console.error('[recallCue] Failed:', e);
      toast.error('Cue recall failed: ' + e);
    } finally {
      set({ isRecalling: false });
    }
  },

  deleteCue: (cueId: string) => {
    const cues = get().cues.filter((c) => c.id !== cueId);
    set({ cues, currentCueIndex: -1 });
    saveToStorage(cues);
  },

  goToNextCue: async () => {
    const { cues, currentCueIndex } = get();
    if (currentCueIndex + 1 >= cues.length) return;
    const nextCue = cues[currentCueIndex + 1];
    await get().recallCue(nextCue.id);
  },

  goToPreviousCue: async () => {
    const { currentCueIndex } = get();
    if (currentCueIndex <= 0) return;
    const cues = get().cues;
    const prevCue = cues[currentCueIndex - 1];
    await get().recallCue(prevCue.id);
  },
}));
