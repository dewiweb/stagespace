import { StateCreator } from 'zustand';
import type { PerfStatsResponse } from '../../types/generated/PerfStatsResponse';

/// Payload complet de `get_perf_stats` — généré depuis Rust (ts-rs).
/// Inclut les champs liveness (isRunning, threadDied…) en plus des métriques.
export type PerfStats = PerfStatsResponse;

export interface PerfSlice {
  // Performance overlay
  perfStats: PerfStats | null;
  setPerfStats: (stats: PerfStats) => void;
}

export const createPerfSlice: StateCreator<PerfSlice, [], [], PerfSlice> = (set) => ({
  perfStats: null,
  setPerfStats: (stats) => set({ perfStats: stats }),
});
