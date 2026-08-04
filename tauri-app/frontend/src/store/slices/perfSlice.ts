import { StateCreator } from 'zustand';

export interface PerfStats {
  fps: number;
  oscRate: number;
  latencyMs: number;
  cpuPercent: number;
}

export interface PerfSlice {
  // Performance overlay
  perfStats: PerfStats | null;
  setPerfStats: (stats: PerfStats) => void;
}

export const createPerfSlice: StateCreator<PerfSlice, [], [], PerfSlice> = (set) => ({
  perfStats: null,
  setPerfStats: (stats) => set({ perfStats: stats }),
});
