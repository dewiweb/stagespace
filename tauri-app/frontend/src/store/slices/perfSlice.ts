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
  /// Santé des flux — PSN running/age, armé, âge du dernier show-cmd
  /// (inclut le timecode) en secondes. Bandeau permanent P1.3.
  flowHealth: {
    psnRunning: boolean;
    psnAge: number | null;
    armed: boolean;
    showCmdAgeS: number | null;
  };
  refreshFlowHealth: () => Promise<void>;
  /// Positions réellement émises par objet (ce que le renderer a reçu) —
  /// confidence view : le "commanded" vs l'intention GUI.
  emittedPositions: Record<number, [number, number, number]>;
  refreshEmittedPositions: () => Promise<void>;
}

export const createPerfSlice: StateCreator<PerfSlice, [], [], PerfSlice> = (set) => ({
  perfStats: null,
  setPerfStats: (stats) => set({ perfStats: stats }),
  objectStates: {},
  refreshObjectStates: async () => {
    try {
      const states = await invoke<Record<number, string>>('get_object_states');
      set({ objectStates: states });
    } catch { /* non critique */ }
  },
  flowHealth: { psnRunning: false, psnAge: null, armed: true, showCmdAgeS: null },
  refreshFlowHealth: async () => {
    try {
      const [[psnRunning, psnAge], armed, showCmdAgeS] = await Promise.all([
        invoke<[boolean, number | null]>('get_psn_health'),
        invoke<boolean>('get_osc_armed'),
        invoke<number | null>('get_last_show_cmd_age'),
      ]);
      set({ flowHealth: { psnRunning, psnAge, armed, showCmdAgeS } });
    } catch { /* non critique */ }
  },
  emittedPositions: {},
  refreshEmittedPositions: async () => {
    try {
      const pos = await invoke<Record<number, [number, number, number]>>('get_emitted_positions');
      set({ emittedPositions: pos });
    } catch { /* non critique */ }
  },
});

// Poll source-de-contrôle — vit dans le slice (donnée), pas React, et
// JAMAIS gaté sur playback : park/manual/psn restent lisibles à l'arrêt.
// Import dynamique : le module scope n'a pas accès au store à la création.
setInterval(() => {
  import('../useGraphStore')
    .then((m) => {
      const s = m.useGraphStore.getState();
      s.refreshObjectStates();
      s.refreshFlowHealth();
      s.refreshEmittedPositions();
    })
    .catch(() => {});
}, 1500);
