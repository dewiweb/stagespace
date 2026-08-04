import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';

export interface OscMapping {
  address: string;
  handler: string;
  transform: string | null;
}

export interface OscSlice {
  // OSC IN
  oscMappings: Map<string, OscMapping>;
  oscValues: Map<string, number[]>;
  setOscValues: (values: Map<string, number[]> | ((prev: Map<string, number[]>) => Map<string, number[]>)) => void;
  addOscMapping: (address: string, handler: string, transform: string | null) => Promise<void>;
  removeOscMapping: (address: string) => Promise<void>;
  listOscMappings: () => Promise<Array<OscMapping>>;
  getOscValue: (handler: string) => Promise<number[]>;
  getAllOscValues: () => Promise<Record<string, number[]>>;
}

export const createOscSlice: StateCreator<OscSlice, [], [], OscSlice> = (set, get) => ({
  oscMappings: new Map(),
  oscValues: new Map(),
  setOscValues: (values) =>
    set({ oscValues: typeof values === 'function' ? values(get().oscValues) : values }),

  addOscMapping: async (address, handler, transform) => {
    await invoke('osc_add_mapping', { address, handler, transform });
    const mappings = await get().listOscMappings();
    set({ oscMappings: new Map(mappings.map((m) => [m.address, m])) });
  },

  removeOscMapping: async (address) => {
    await invoke('osc_remove_mapping', { address });
    const mappings = await get().listOscMappings();
    set({ oscMappings: new Map(mappings.map((m) => [m.address, m])) });
  },

  listOscMappings: async () => {
    try {
      return await invoke('osc_list_mappings');
    } catch (e) {
      console.error('Failed to list OSC mappings:', e);
      return [];
    }
  },

  getOscValue: async (handler) => {
    try {
      return await invoke<number[]>('osc_get_value', { handler });
    } catch (e) {
      console.error('Failed to get OSC value:', e);
      return [];
    }
  },

  getAllOscValues: async () => {
    try {
      return await invoke<Record<string, number[]>>('osc_get_all_values');
    } catch (e) {
      console.error('Failed to get all OSC values:', e);
      return {};
    }
  },
});
