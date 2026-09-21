import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
// Types générés depuis Rust via ts-rs — ne pas éditer les miroirs.
import type { Transform } from '../../types/generated/Transform';
import type { MappingDestination } from '../../types/generated/MappingDestination';
import type { OscMapping } from '../../types/generated/OscMapping';
import type { OscInStatsSnapshot } from '../../types/generated/OscInStatsSnapshot';
import type { MacroTarget } from '../../types/generated/MacroTarget';
import type { SpatialChannel } from '../../types/generated/SpatialChannel';
import type { ObjectRef } from '../../types/generated/ObjectRef';

export type { MappingDestination, OscMapping };
export type OscTransform = Transform;
export type OscInStats = OscInStatsSnapshot;

/// Macros spatiales pilotables par OSC IN — utilisé pour typer la sortie du
/// parser textuel (le backend valide au désérialiser).
export type { MacroTarget };

const DEFAULT_TRANSFORM: OscTransform = {
  scale: 1,
  offset: 0,
  min: null,
  max: null,
  smooth: 0,
  deadzone: 0,
};

/// Parse une destination textuelle :
/// `handler:name`, `macro:scale`, `channel:gain:3`, `position:2` —
/// un nom nu est traité comme un handler (comportement historique).
export function parseDestination(spec: string): MappingDestination {
  const parts = spec.split(':');
  if (parts[0] === 'handler' && parts[1]) {
    return { kind: 'handler', name: parts[1] };
  }
  if (parts[0] === 'macro' && parts[1]) {
    return { kind: 'macro', name: parts[1] as MacroTarget };
  }
  if (parts[0] === 'channel' && parts[1] && parts[2] !== undefined) {
    const channel = (parts[1][0].toUpperCase() + parts[1].slice(1).toLowerCase()) as SpatialChannel;
    const object: ObjectRef = parts[2].startsWith('*') ? parts[2] : parseInt(parts[2], 10);
    return { kind: 'channel', channel, object };
  }
  if (parts[0] === 'position' && parts[1] !== undefined) {
    const object: ObjectRef = parts[1].startsWith('*') ? parts[1] : parseInt(parts[1], 10);
    return { kind: 'position', object };
  }
  return { kind: 'handler', name: spec };
}

/// Parse une transform textuelle en paires `key=value` :
/// `scale=2 offset=1 min=0 max=1 smooth=0.5 deadzone=0.1`
/// Un nombre nu est traité comme scale (ex. "x*2+1" legacy → non supporté,
/// utiliser scale=2 offset=1).
export function parseTransform(spec: string | null): OscTransform {
  if (!spec) return { ...DEFAULT_TRANSFORM };
  const t = { ...DEFAULT_TRANSFORM };
  for (const token of spec.split(/[\s,]+/).filter(Boolean)) {
    const [key, raw] = token.split('=');
    const v = parseFloat(raw);
    if (!isNaN(v) && key in t) {
      (t as Record<string, number | null>)[key] = v;
    }
  }
  return t;
}

export function describeDestination(d: MappingDestination): string {
  switch (d.kind) {
    case 'handler':
      return `handler:${d.name}`;
    case 'macro':
      return `macro:${d.name}`;
    case 'channel':
      return `channel:${d.channel}:${d.object}`;
    case 'position':
      return `position:${d.object}`;
  }
}

export interface OscSlice {
  // OSC IN
  oscMappings: Map<string, OscMapping>;
  oscValues: Map<string, number[]>;
  setOscValues: (values: Map<string, number[]> | ((prev: Map<string, number[]>) => Map<string, number[]>)) => void;
  addOscMapping: (address: string, destination: string, transform: string | null) => Promise<void>;
  removeOscMapping: (address: string) => Promise<void>;
  listOscMappings: () => Promise<Array<OscMapping>>;
  getOscValue: (handler: string) => Promise<number[]>;
  getAllOscValues: () => Promise<Record<string, number[]>>;
  setOscInEnabled: (enabled: boolean) => Promise<void>;
  suppressOscIn: (durationMs: number) => Promise<void>;
}

export const createOscSlice: StateCreator<OscSlice, [], [], OscSlice> = (set, get) => ({
  oscMappings: new Map(),
  oscValues: new Map(),
  setOscValues: (values) =>
    set({ oscValues: typeof values === 'function' ? values(get().oscValues) : values }),

  addOscMapping: async (address, destination, transform) => {
    const mapping: OscMapping = {
      address,
      destination: parseDestination(destination),
      transform: parseTransform(transform),
      enabled: true,
    };
    await invoke('osc_add_mapping', { mapping });
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

  setOscInEnabled: async (enabled) => {
    await invoke('osc_set_in_enabled', { enabled });
  },

  suppressOscIn: async (durationMs) => {
    await invoke('osc_suppress_in', { durationMs });
  },
});
