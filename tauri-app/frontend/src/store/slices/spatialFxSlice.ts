import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';

/// Noms sérialisés côté Rust : SpatialChannel → "Gain" | "Spread" | …
export type SpatialChannelName =
  | 'Gain' | 'Spread' | 'Distance' | 'Presence' | 'Yaw' | 'Aperture' | 'Lfe';

export const SPATIAL_CHANNELS: SpatialChannelName[] = [
  'Gain', 'Spread', 'Distance', 'Presence', 'Yaw', 'Aperture', 'Lfe',
];

/// Tous les champs sont optionnels (Option<f64> côté Rust).
export type SpatialChannels = Partial<Record<
  'gain' | 'spread' | 'distance' | 'presence' | 'yaw' | 'aperture' | 'lfe',
  number | null
>>;

export type ZoneShape =
  | { shape: 'sphere'; center: [number, number, number]; radius: number }
  | { shape: 'box'; min: [number, number, number]; max: [number, number, number] };

export interface Zone {
  shape: ZoneShape;
  falloff: number;
  channels: SpatialChannels;
  objects?: number[] | null;
  enabled: boolean;
}

export type KinematicSourceName = 'Speed' | 'Acceleration' | 'Jerk';

/// min/max arrivent en `number | null` (null = ±∞ côté Rust).
export interface ChannelModulation {
  object: number | null;
  source: KinematicSourceName;
  channel: SpatialChannelName;
  scale: number;
  offset: number;
  min: number | null;
  max: number | null;
}

/// Payload pour `add_zone` — shape textuelle + coins génériques a/b.
export interface ZoneParams {
  shape: 'sphere' | 'box';
  a: [number, number, number];
  radius?: number | null;
  b?: [number, number, number] | null;
  falloff?: number | null;
  channels: Record<string, number>;
  objects?: number[] | null;
}

/// Payload pour `add_channel_modulation`.
export interface ModulationParams {
  source: 'speed' | 'accel' | 'jerk';
  channel: string;
  scale: number;
  offset?: number | null;
  min?: number | null;
  max?: number | null;
  object_index?: number | null;
}

/// Parse "gain=0.5,spread=1" → { gain: 0.5, spread: 1 }.
export function parseChannelsSpec(spec: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const token of spec.split(/[,;\s]+/).filter(Boolean)) {
    const [name, raw] = token.split('=');
    const v = parseFloat(raw);
    if (name && !isNaN(v)) out[name.toLowerCase()] = v;
  }
  return out;
}

/// Parse "x,y,z" → [x, y, z] (null si invalide).
export function parseVec3(spec: string): [number, number, number] | null {
  const parts = spec.split(/[,\s]+/).filter(Boolean).map(parseFloat);
  return parts.length === 3 && parts.every((v) => !isNaN(v))
    ? [parts[0], parts[1], parts[2]]
    : null;
}

/// Parse "0,1,2" → [0, 1, 2] (null si vide → tous les objets).
export function parseObjectsSpec(spec: string): number[] | null {
  const parts = spec
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((s) => parseInt(s, 10));
  return parts.length > 0 && parts.every((v) => !isNaN(v)) ? parts : null;
}

export function describeChannels(channels: SpatialChannels): string {
  return Object.entries(channels)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

export function describeZoneShape(shape: ZoneShape): string {
  if (shape.shape === 'sphere') {
    return `sphere @(${shape.center.map((v) => v.toFixed(1)).join(',')}) r=${shape.radius}`;
  }
  return `box (${shape.min.map((v) => v.toFixed(1)).join(',')})→(${shape.max.map((v) => v.toFixed(1)).join(',')})`;
}

export interface SpatialFxSlice {
  zones: Zone[];
  modulations: ChannelModulation[];
  objectChannels: Record<number, SpatialChannels>;
  refreshSpatialFx: () => Promise<void>;
  addZone: (params: ZoneParams) => Promise<void>;
  removeZone: (index: number) => Promise<void>;
  clearZones: () => Promise<void>;
  addModulation: (params: ModulationParams) => Promise<void>;
  removeModulation: (index: number) => Promise<void>;
  clearModulations: () => Promise<void>;
  setKinematicSmoothing: (smoothing: number) => Promise<void>;
  setSpatialChannel: (objectIndex: number, channel: string, value: number) => Promise<void>;
  clearSpatialChannel: (objectIndex: number, channel?: string) => Promise<void>;
  clearAllSpatialChannels: () => Promise<void>;
}

export const createSpatialFxSlice: StateCreator<SpatialFxSlice, [], [], SpatialFxSlice> = (set, get) => ({
  zones: [],
  modulations: [],
  objectChannels: {},

  refreshSpatialFx: async () => {
    const [zones, modulations, objectChannels] = await Promise.all([
      invoke<Zone[]>('list_zones').catch((e) => {
        console.error('Failed to list zones:', e);
        return [] as Zone[];
      }),
      invoke<ChannelModulation[]>('list_channel_modulations').catch((e) => {
        console.error('Failed to list modulations:', e);
        return [] as ChannelModulation[];
      }),
      invoke<Record<number, SpatialChannels>>('list_spatial_channels').catch((e) => {
        console.error('Failed to list spatial channels:', e);
        return {} as Record<number, SpatialChannels>;
      }),
    ]);
    set({ zones, modulations, objectChannels });
  },

  addZone: async (params) => {
    await invoke('add_zone', { params });
    await get().refreshSpatialFx();
  },

  removeZone: async (index) => {
    await invoke('remove_zone', { index });
    await get().refreshSpatialFx();
  },

  clearZones: async () => {
    await invoke('clear_zones');
    await get().refreshSpatialFx();
  },

  addModulation: async (params) => {
    await invoke('add_channel_modulation', { params });
    await get().refreshSpatialFx();
  },

  removeModulation: async (index) => {
    await invoke('remove_channel_modulation', { index });
    await get().refreshSpatialFx();
  },

  clearModulations: async () => {
    await invoke('clear_channel_modulations');
    await get().refreshSpatialFx();
  },

  setKinematicSmoothing: async (smoothing) => {
    await invoke('set_kinematic_smoothing', { smoothing });
  },

  setSpatialChannel: async (objectIndex, channel, value) => {
    await invoke('set_spatial_channel', { objectIndex, channel, value });
    await get().refreshSpatialFx();
  },

  clearSpatialChannel: async (objectIndex, channel) => {
    await invoke('clear_spatial_channel', { objectIndex, channel: channel ?? null });
    await get().refreshSpatialFx();
  },

  clearAllSpatialChannels: async () => {
    await invoke('clear_all_spatial_channels');
    await get().refreshSpatialFx();
  },
});
