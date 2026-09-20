import { StateCreator } from 'zustand';
import type { Node, Edge } from 'reactflow';
import { safeInvoke as invoke } from '../../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../../utils/safeStorage';
import { toast } from '../../utils/toast-helpers';
import type { MoveSlot } from './moveSlotsSlice';
import { saveSlotsToStorage } from './moveSlotsSlice';
import type { CueData } from '../useCuelistStore';
import type { HolProject } from '../types/index';
import type {
  Zone,
  ZoneParams,
  ChannelModulation,
  ModulationParams,
  SpatialChannels,
} from './spatialFxSlice';

export interface PersistenceSlice {
  // Persistence (localStorage)
  saveGraph: (name: string) => Promise<void>;
  loadGraph: (name: string) => Promise<void>;
  deleteGraph: (name: string) => Promise<void>;
  listGraphs: () => Promise<string[]>;

  // Persistence sur disque (Tauri IPC) — .hfg = show complet depuis v2
  saveGraphToFile: (filePath: string) => Promise<void>;
  loadGraphFromFile: (filePath: string) => Promise<void>;
}

// Le slice accède aux autres slices via get() — type étendu du store
type PersistenceStore = PersistenceSlice & {
  nodes: Node[];
  edges: Edge[];
  movements: { id: string }[];
  moveSlots: MoveSlot[];
  setlistOrder: string[];
  currentSetlistIndex: number;
  editingSlotId: string | null;
  holProject: HolProject | null;
  manualOscIds: number[];
  manualPositions: Record<number, [number, number, number]>;
  selectedTrackIds: Set<number>;
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  oscInPort: number;
  zones: Zone[];
  modulations: ChannelModulation[];
  objectChannels: Record<number, SpatialChannels>;
  kinematicSmoothing: number;
  refreshSpatialFx: () => Promise<void>;
};

// ─── Enveloppe .hfg ───
// v0 : fichier brut {nodes, edges} (avant versioning)
// v1 : enveloppe {format: 'stagespace-graph', nodes, edges} — graphe seul
// v2 : enveloppe {format: 'stagespace-show', ...} — show complet :
//      graphe édité + graphe global + slots + setlist + cues + config OSC +
//      spatial FX + tracks (.hol / manuels)
const SHOW_FILE_FORMAT = 'stagespace-show';
const SHOW_FILE_VERSION = 2;

interface OscConfigData {
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  oscInPort: number;
}

interface TracksData {
  holProject: HolProject | null;
  manualOscIds: number[];
  manualPositions: Record<number, [number, number, number]>;
  selectedTrackIds: number[];
}

interface SpatialFxData {
  zones: Zone[];
  modulations: ChannelModulation[];
  objectChannels: Record<number, SpatialChannels>;
  kinematicSmoothing?: number;
}

interface ShowFileEnvelope {
  format?: string;
  version?: number;
  savedAt?: number;
  // Graphe édité — top-level pour compat v0/v1
  nodes: Node[];
  edges: Edge[];
  // v2 : show complet
  globalGraph?: { nodes: Node[]; edges: Edge[] };
  slots?: MoveSlot[];
  setlistOrder?: string[];
  currentSetlistIndex?: number;
  editingSlotId?: string | null;
  cues?: CueData[];
  osc?: OscConfigData;
  spatialFx?: SpatialFxData;
  tracks?: TracksData;
}

/// Valide l'enveloppe et retourne la version effective (0 = legacy brut).
function validateShowFile(raw: ShowFileEnvelope): number {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Invalid show file: missing nodes/edges');
  }
  if (raw.format === SHOW_FILE_FORMAT || raw.format === 'stagespace-graph') {
    const v = raw.version ?? 0;
    if (v > SHOW_FILE_VERSION) {
      throw new Error(
        `Show file version ${v} is newer than supported (${SHOW_FILE_VERSION}) — update the app`,
      );
    }
    return v;
  }
  return 0; // legacy brut — accepté tel quel
}

// ─── Conversions pour le restore des spatial FX ───

/// Zone (état backend) → ZoneParams (payload add_zone)
function zoneToParams(z: Zone): ZoneParams {
  const channels: Record<string, number> = {};
  for (const [k, v] of Object.entries(z.channels ?? {})) {
    if (typeof v === 'number') channels[k] = v;
  }
  if (z.shape.shape === 'sphere') {
    return {
      shape: 'sphere',
      a: z.shape.center,
      radius: z.shape.radius,
      falloff: z.falloff,
      channels,
      objects: z.objects ?? null,
    };
  }
  return {
    shape: 'box',
    a: z.shape.min,
    b: z.shape.max,
    falloff: z.falloff,
    channels,
    objects: z.objects ?? null,
  };
}

const MOD_SOURCE_TO_WIRE: Record<string, ModulationParams['source']> = {
  Speed: 'speed',
  Acceleration: 'accel',
  Jerk: 'jerk',
  AngularSpeed: 'angvel',
};

/// ChannelModulation (état backend) → ModulationParams (payload add_channel_modulation)
function modulationToParams(m: ChannelModulation): ModulationParams {
  return {
    source: MOD_SOURCE_TO_WIRE[m.source] ?? 'speed',
    channel: m.channel.toLowerCase(),
    scale: m.scale,
    offset: m.offset,
    min: m.min,
    max: m.max,
    object_index: m.object,
    listener: m.listener ?? null,
  };
}

export const createPersistenceSlice: StateCreator<PersistenceStore, [], [], PersistenceSlice> = (set, get) => ({
  saveGraph: async (name) => {
    const { nodes, edges } = get();
    const graphData = { nodes, edges, timestamp: Date.now() };
    safeSetItem(`stagespace_graph_${name}`, JSON.stringify(graphData));
  },

  loadGraph: async (name) => {
    const key = `stagespace_graph_${name}`;
    let exists = false;
    try {
      exists = localStorage.getItem(key) !== null;
    } catch {}
    if (!exists) throw new Error(`Graph "${name}" not found`);
    const graphData = safeParseStoredJson<{ nodes: Node[]; edges: Edge[] } | null>(key, null);
    if (!graphData) throw new Error(`Graph "${name}" is corrupted (backup saved)`);
    set({ nodes: graphData.nodes, edges: graphData.edges });
  },

  deleteGraph: async (name) => {
    localStorage.removeItem(`stagespace_graph_${name}`);
  },

  listGraphs: async () => {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('stagespace_graph_'))
      .map((k) => k.replace('stagespace_graph_', ''));
  },

  saveGraphToFile: async (filePath) => {
    const s = get();
    // Le graphe global et les cues vivent dans des stores séparés —
    // import dynamique pour éviter les cycles d'import.
    const { useGlobalGraphStore } = await import('../useGlobalGraphStore');
    const { useCuelistStore } = await import('../useCuelistStore');
    const globalStore = useGlobalGraphStore.getState();
    const cueStore = useCuelistStore.getState();

    const envelope: ShowFileEnvelope = {
      format: SHOW_FILE_FORMAT,
      version: SHOW_FILE_VERSION,
      savedAt: Date.now(),
      nodes: s.nodes,
      edges: s.edges,
      globalGraph: { nodes: globalStore.nodes, edges: globalStore.edges },
      slots: s.moveSlots,
      setlistOrder: s.setlistOrder,
      currentSetlistIndex: s.currentSetlistIndex,
      editingSlotId: s.editingSlotId,
      cues: cueStore.cues,
      osc: {
        oscAddress: s.oscAddress,
        oscPort: s.oscPort,
        oscProfile: s.oscProfile,
        oscInPort: s.oscInPort,
      },
      spatialFx: {
        zones: s.zones,
        modulations: s.modulations,
        objectChannels: s.objectChannels,
        kinematicSmoothing: s.kinematicSmoothing,
      },
      tracks: {
        holProject: s.holProject,
        manualOscIds: s.manualOscIds,
        manualPositions: s.manualPositions,
        selectedTrackIds: Array.from(s.selectedTrackIds),
      },
    };

    try {
      await invoke('save_graph_to_file', { filePath, graphJson: envelope });
    } catch (e) {
      console.error('Failed to save show file:', e);
      throw e;
    }
  },

  loadGraphFromFile: async (filePath) => {
    // Live-safety : charger un show remplace slots, cues, config OSC et
    // spatial FX — refuser pendant le playback plutôt que corrompre
    // l'état de moves en cours.
    if (get().movements.length > 0) {
      toast.warning('Cannot load a show during playback — stop all moves first.');
      throw new Error('Cannot load show file during playback');
    }

    const raw = await invoke<ShowFileEnvelope>('load_graph_from_file', { filePath });
    const version = validateShowFile(raw);

    // v0/v1 : graphe seul — comportement historique
    set({ nodes: raw.nodes, edges: raw.edges });
    if (version < 2) return;

    // ── Restore complet (v2) ──
    const { useGlobalGraphStore } = await import('../useGlobalGraphStore');
    const { useCuelistStore } = await import('../useCuelistStore');

    // 1. Tracks — source de vérité des positions/IDs (origins, preview 3D).
    //    L'effet pushGlobalOscIds réagit au changement d'état automatiquement.
    if (raw.tracks) {
      set({
        holProject: raw.tracks.holProject ?? null,
        manualOscIds: raw.tracks.manualOscIds ?? [],
        manualPositions: raw.tracks.manualPositions ?? {},
        selectedTrackIds: new Set(raw.tracks.selectedTrackIds ?? []),
      });
    }

    // 2. Slots + setlist + slot en édition — persistés comme d'habitude
    if (raw.slots) {
      set({
        moveSlots: raw.slots,
        setlistOrder: raw.setlistOrder ?? raw.slots.map((sl) => sl.id),
        currentSetlistIndex: raw.currentSetlistIndex ?? -1,
        editingSlotId: raw.editingSlotId ?? null,
      });
      saveSlotsToStorage(raw.slots);
    }

    // 3. Cues — frontend-owned (localStorage), juste à restaurer
    if (raw.cues) {
      useCuelistStore.setState({ cues: raw.cues, currentCueIndex: -1 });
      useCuelistStore.getState().saveToStorage();
    }

    // 4. Config OSC — set direct + push backend (playback déjà exclu)
    if (raw.osc) {
      set({
        oscAddress: raw.osc.oscAddress,
        oscPort: raw.osc.oscPort,
        oscProfile: raw.osc.oscProfile,
        oscInPort: raw.osc.oscInPort,
      });
      safeSetItem('stagespace-osc-config', JSON.stringify(raw.osc));
      try {
        await invoke('set_osc_output', {
          address: raw.osc.oscAddress,
          port: raw.osc.oscPort,
          profile: raw.osc.oscProfile,
        });
        await invoke('set_osc_receiver_port', { port: raw.osc.oscInPort });
      } catch (e) {
        console.error('Failed to restore OSC config:', e);
        toast.error(`Show loaded but OSC config failed to apply: ${e}`);
      }
    }

    // 5. Graphe global — restore + push backend pour que le post-process
    //    reflète le fichier (sinon le merge tourne sur l'ancien graphe)
    if (raw.globalGraph) {
      useGlobalGraphStore.setState({
        nodes: raw.globalGraph.nodes,
        edges: raw.globalGraph.edges,
      });
      try {
        await useGlobalGraphStore.getState().pushGlobalGraph();
      } catch (e) {
        console.error('Failed to push restored global graph:', e);
      }
    }

    // 6. Spatial FX — replay des zones/modulations/channels sur le backend
    //    (clear d'abord : le fichier remplace l'état courant)
    if (raw.spatialFx) {
      try {
        await invoke('clear_zones');
        await invoke('clear_channel_modulations');
        await invoke('clear_all_spatial_channels');
        for (const z of raw.spatialFx.zones ?? []) {
          await invoke('add_zone', { params: zoneToParams(z) });
        }
        for (const m of raw.spatialFx.modulations ?? []) {
          await invoke('add_channel_modulation', { params: modulationToParams(m) });
        }
        for (const [objIdx, channels] of Object.entries(raw.spatialFx.objectChannels ?? {})) {
          for (const [channel, value] of Object.entries(channels)) {
            if (typeof value === 'number') {
              await invoke('set_spatial_channel', {
                objectIndex: Number(objIdx),
                channel,
                value,
              });
            }
          }
        }
        if (typeof raw.spatialFx.kinematicSmoothing === 'number') {
          await invoke('set_kinematic_smoothing', { smoothing: raw.spatialFx.kinematicSmoothing });
        }
        await get().refreshSpatialFx?.();
      } catch (e) {
        console.error('Failed to restore spatial FX:', e);
        toast.error(`Show loaded but spatial FX restore failed: ${e}`);
      }
    }
  },
});
