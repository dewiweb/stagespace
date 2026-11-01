import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import type { PerfStatsResponse } from '../../types/generated/PerfStatsResponse';

/// Payload complet de `get_perf_stats` — généré depuis Rust (ts-rs).
/// Inclut les champs liveness (isRunning, threadDied…) en plus des métriques.
export type PerfStats = PerfStatsResponse;

export interface PerfSlice {
  // Performance overlay
  perfStats: PerfStats | null;
  setPerfStats: (stats: PerfStats) => void;
  /// Source-de-contrôle par objet — move / manual / psn / park / hold /
  /// track. La lecture opérateur du modèle de contrôle.
  objectStates: Record<number, string>;
  refreshObjectStates: () => Promise<void>;
}

export const createPerfSlice: StateCreator<PerfSlice, [], [], PerfSlice> = (set, get) => ({
  perfStats: null,
  setPerfStats: (stats) => set({ perfStats: stats }),
  objectStates: {},
  refreshObjectStates: async () => {
    try {
      const states = await invoke<Record<number, string>>('get_object_states');
      set({ objectStates: states });
    } catch { /* non critique */ }
  },
});

// Poll source-de-contrôle — vit dans le slice (donnée), pas React, et
// JAMAIS gaté sur playback : park/manual/psn restent lisibles à l'arrêt.
// Import dynamique : le module scope n'a pas accès au store à la création.
setInterval(() => {
  import('../useGraphStore')
    .then((m) => m.useGraphStore.getState().refreshObjectStates())
    .catch(() => {});
}, 1500);
