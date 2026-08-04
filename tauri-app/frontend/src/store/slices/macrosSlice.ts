import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import type { MovementInfo } from '../types/index';

export type MacrosState = {
  speed: number;
  scale: number;
  shiftX: number;
  shiftY: number;
  shiftZ: number;
  yaw: number;
  pitch: number;
  roll: number;
  radius_scale: number;
  height_offset: number;
};

export interface MacrosSlice {
  // Macro controls
  macros: MacrosState;
  setMacros: (macros: Partial<MacrosState>) => void;
  pushMacrosToRuntime: () => Promise<void>;
  setLoopMode: (mode: 'loop' | 'oneshot') => Promise<void>;
}

// pushMacrosToRuntime accède à movements via get() — on étend le type attendu du store
type MacrosStore = MacrosSlice & {
  movements: MovementInfo[];
};

export const createMacrosSlice: StateCreator<MacrosStore, [], [], MacrosSlice> = (set, get) => ({
  macros: { speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0, radius_scale: 1.0, height_offset: 0 },
  setMacros: (partial) => set((s) => ({ macros: { ...s.macros, ...partial } })),

  pushMacrosToRuntime: async () => {
    const { macros, movements } = get();
    const macroReq = {
      speed: macros.speed,
      scale: macros.scale,
      shiftX: macros.shiftX,
      shiftY: macros.shiftY,
      shiftZ: macros.shiftZ,
      yaw: macros.yaw,
      pitch: macros.pitch,
      roll: macros.roll,
      radius_scale: macros.radius_scale,
      height_offset: macros.height_offset,
    };
    try {
      if (movements.length > 0) {
        // Multi-movement: pousser vers chaque movement
        await Promise.all(movements.map((mv) =>
          invoke('set_movement_macro', { movementId: mv.id, request: macroReq })
        ));
      } else {
        // Legacy: runtime global
        await invoke('set_macro', { request: macroReq });
      }
    } catch (e) {
      console.error('Failed to push macros:', e);
    }
  },

  setLoopMode: async (mode) => {
    try {
      await invoke('set_loop_mode', { mode });
    } catch (e) {
      console.error('Failed to set loop mode:', e);
    }
  },
});
