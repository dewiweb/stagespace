import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import { safeSetItem } from '../utils/safeStorage';

export interface CueData {
  id: string;
  name: string;
  description: string;
  graph: any;
  timestamp: number;
  macros?: {
    speed: number;
    scale: number;
    shift_x: number;
    shift_y: number;
    shift_z: number;
    yaw: number;
    pitch: number;
    roll: number;
  };
  track_indices: number[];
  fade_duration: number;
  cue_number?: string;
  // Phase 3
  global_graph?: any;
  active_move_ids: string[];
  per_track_depths: number[];
  manual_positions: Record<number, [number, number, number]>;
  spatial_macros?: {
    radius_scale: number;
    height_offset: number;
  };
}

interface CuelistState {
  cues: CueData[];
  currentCueIndex: number;
  isRecalling: boolean;

  loadFromStorage: () => void;
  saveToStorage: () => void;
  storeCue: (cue: Omit<CueData, 'id' | 'timestamp'>) => Promise<CueData>;
  recallCue: (cueId: string) => Promise<void>;
  deleteCue: (cueId: string) => void;
  goToNextCue: () => Promise<void>;
  goToPreviousCue: () => Promise<void>;
}

const STORAGE_KEY = 'stagespace-cuelist';

function loadFromStorage(): CueData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
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
    // Appeler le backend pour créer le cue (valide la structure)
    const cue = await invoke<CueData>('store_cue', { request: cueData });
    const cues = [...get().cues, cue];
    set({ cues });
    saveToStorage(cues);
    return cue;
  },

  recallCue: async (cueId: string) => {
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
