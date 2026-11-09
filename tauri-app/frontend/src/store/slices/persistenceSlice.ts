import { StateCreator } from 'zustand';
import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../../components/nodeParamSchema';
import { safeInvoke as invoke, silentCatch } from '../../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../../utils/safeStorage';
import { toast } from '../../utils/toast-helpers';
import type { MoveSlot } from './moveSlotsSlice';
import { normalizeSlot, saveSlotsToStorage } from './moveSlotsSlice';
import type { CueData } from '../useCuelistStore';
import type { HolProject } from '../types/index';
import type { OscMapping } from '../../types/generated/OscMapping';
import type { MacrosState } from './macrosSlice';
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
  /// Applique une enveloppe show déjà chargée (welcome screen, tests) —
  /// même chemin que loadGraphFromFile sans la lecture fichier.
  loadShowEnvelope: (envelope: ShowFileEnvelope) => Promise<void>;
}

// Le slice accède aux autres slices via get() — type étendu du store
type PersistenceStore = PersistenceSlice & {
  nodes: GraphNode[];
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
  macros: MacrosState;
  refreshSpatialFx: () => Promise<void>;
  pushMacrosToRuntime: () => Promise<void>;
  // Internes undo — reset au load (l'historique pointait sur l'ancien show).
  _history: Array<{ nodes: GraphNode[]; edges: Edge[] }>;
  _historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
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

export interface ShowFileEnvelope {
  format?: string;
  version?: number;
  savedAt?: number;
  // Graphe édité — top-level pour compat v0/v1
  nodes: GraphNode[];
  edges: Edge[];
  // v2 : show complet
  globalGraph?: { nodes: GraphNode[]; edges: Edge[] };
  /// Graph de modulation global (domaine signal → deltas de macros)
  signalGraph?: { nodes: GraphNode[]; edges: Edge[] };
  slots?: MoveSlot[];
  setlistOrder?: string[];
  currentSetlistIndex?: number;
  editingSlotId?: string | null;
  cues?: CueData[];
  osc?: OscConfigData;
  spatialFx?: SpatialFxData;
  tracks?: TracksData;
  oscMappings?: OscMapping[];
  macros?: MacrosState;
}

/// Valide l'enveloppe et retourne la version effective (0 = legacy brut).
/// Un `format` présent mais inconnu est REJETÉ (typo/format futur) — sinon il
/// serait traité en v0 et cues/slots/FX seraient silencieusement droppés.
function validateShowFile(raw: ShowFileEnvelope): number {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Invalid show file: missing nodes/edges');
  }
  if (raw.format !== undefined) {
    if (raw.format !== SHOW_FILE_FORMAT && raw.format !== 'stagespace-graph') {
      throw new Error(`Unrecognized show file format '${raw.format}'`);
    }
    if (raw.format === SHOW_FILE_FORMAT && raw.version === undefined) {
      throw new Error('Show file is missing its version field');
    }
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

/// Sections v2 : si présentes, elles doivent être des tableaux — sinon elles
/// seraient stockées verbatim et casseraient plus tard dans `.map`.
function validateSections(raw: ShowFileEnvelope) {
  const arrays: Array<[string, unknown]> = [
    ['slots', raw.slots],
    ['cues', raw.cues],
    ['setlistOrder', raw.setlistOrder],
    ['oscMappings', raw.oscMappings],
  ];
  for (const [name, v] of arrays) {
    if (v !== undefined && !Array.isArray(v)) {
      throw new Error(`Invalid show file: '${name}' must be an array`);
    }
  }
  if (raw.tracks !== undefined && (typeof raw.tracks !== 'object' || raw.tracks === null)) {
    throw new Error("Invalid show file: 'tracks' must be an object");
  }
  if (raw.spatialFx !== undefined && (typeof raw.spatialFx !== 'object' || raw.spatialFx === null)) {
    throw new Error("Invalid show file: 'spatialFx' must be an object");
  }
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
      exists = typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null;
    } catch {
      // localStorage indisponible (mode privé, quota) — traité comme absent
    }
    if (!exists) throw new Error(`Graph "${name}" not found`);
    const graphData = safeParseStoredJson<{ nodes: GraphNode[]; edges: Edge[] } | null>(key, null);
    if (!graphData) throw new Error(`Graph "${name}" is corrupted (backup saved)`);
    set({ nodes: graphData.nodes, edges: graphData.edges });
  },

  deleteGraph: async (name) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`stagespace_graph_${name}`);
  },

  listGraphs: async () => {
    if (typeof localStorage === 'undefined') return [];
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('stagespace_graph_'))
      .map((k) => k.replace('stagespace_graph_', ''));
  },

  saveGraphToFile: async (filePath) => {
    const s = get();
    // Le graphe global et les cues vivent dans des stores séparés —
    // import dynamique pour éviter les cycles d'import.
    const { useGlobalGraphStore } = await import('../useGlobalGraphStore');
    const { useSignalGraphStore } = await import('../useSignalGraphStore');
    const { useCuelistStore } = await import('../useCuelistStore');
    const globalStore = useGlobalGraphStore.getState();
    const signalStore = useSignalGraphStore.getState();
    const cueStore = useCuelistStore.getState();

    // OSC IN mappings : sérialisables — sinon ils sont perdus au load.
    let oscMappings: OscMapping[] | undefined;
    try {
      oscMappings = await invoke<OscMapping[]>('osc_list_mappings');
    } catch (e) {
      console.error('[saveGraphToFile] osc_list_mappings failed:', e);
      toast.warning(`OSC IN mappings not saved — list failed: ${e}`);
    }

    const envelope: ShowFileEnvelope = {
      format: SHOW_FILE_FORMAT,
      version: SHOW_FILE_VERSION,
      savedAt: Date.now(),
      nodes: s.nodes,
      edges: s.edges,
      globalGraph: { nodes: globalStore.nodes, edges: globalStore.edges },
      signalGraph: { nodes: signalStore.nodes, edges: signalStore.edges },
      // Strip runtime state : movementId n'a de sens que pendant la session —
      // un slot rechargé afficherait un fantôme "playing".
      slots: s.moveSlots.map((sl) => ({ ...sl, movementId: null })),
      setlistOrder: s.setlistOrder,
      currentSetlistIndex: s.currentSetlistIndex,
      editingSlotId: s.editingSlotId,
      cues: cueStore.cues,
      oscMappings,
      macros: s.macros,
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
    // Live-safety : refuser avant l'IPC — pas de lecture fichier inutile.
    if (get().movements.length > 0) {
      toast.warning('Cannot load a show during playback — stop all moves first.');
      throw new Error('Cannot load show during playback');
    }
    const raw = await invoke<ShowFileEnvelope>('load_graph_from_file', { filePath });
    await get().loadShowEnvelope(raw);
  },

  loadShowEnvelope: async (raw) => {
    // Live-safety : charger un show remplace slots, cues, config OSC et
    // spatial FX — refuser pendant le playback plutôt que corrompre
    // l'état de moves en cours.
    if (get().movements.length > 0) {
      toast.warning('Cannot load a show during playback — stop all moves first.');
      throw new Error('Cannot load show during playback');
    }

    const version = validateShowFile(raw);
    validateSections(raw);

    // Undo reset : l'historique pointe sur l'ancien show — un Ctrl+Z après
    // load réinjecterait le graphe d'avant-load dans le nouveau (et
    // l'autosave le pousserait en live).
    set({
      _history: [],
      _historyIndex: -1,
      canUndo: false,
      canRedo: false,
    });

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

    // 2. Slots + setlist + slot en édition — persistés comme d'habitude.
    //    normalizeSlot backfill les champs ajoutés après coup (un .hfg écrit
    //    par une ancienne version n'a pas fadeIn/assignments/audioMods…).
    if (raw.slots) {
      const slots = raw.slots.map(normalizeSlot);
      set({
        moveSlots: slots,
        setlistOrder: raw.setlistOrder ?? slots.map((sl) => sl.id),
        currentSetlistIndex: raw.currentSetlistIndex ?? -1,
        editingSlotId: raw.editingSlotId ?? null,
      });
      saveSlotsToStorage(slots);
    }

    // 3. Cues — frontend-owned (localStorage), juste à restaurer
    if (raw.cues) {
      useCuelistStore.setState({ cues: raw.cues, currentCueIndex: -1 });
      useCuelistStore.getState().saveToStorage();
    }

    // 3b. OSC IN mappings — clear + replay (le fichier remplace l'état).
    //     Rollback sur l'état précédent si le replay échoue à mi-parcours :
    //     un clear réussi suivi d'un add en échec laisserait sinon des
    //     mappings partiels silencieusement.
    if (raw.oscMappings !== undefined) {
      const prevMappings: OscMapping[] = await invoke<OscMapping[]>('osc_list_mappings').catch(() => []);
      try {
        await invoke('osc_clear_mappings');
        for (const m of raw.oscMappings) {
          await invoke('osc_add_mapping', { mapping: m });
        }
      } catch (e) {
        console.error('Failed to restore OSC IN mappings:', e);
        try {
          await invoke('osc_clear_mappings');
          for (const m of prevMappings) {
            await invoke('osc_add_mapping', { mapping: m });
          }
        } catch (rbErr) {
          console.error('OSC mappings rollback failed:', rbErr);
        }
        toast.error(`Show loaded but OSC IN mappings restore failed: ${e}`);
      }
    }

    // 3c. Macros globales — restore frontend + push backend. Sur échec du
    //     push, revert le frontend pour rester aligné avec le backend.
    if (raw.macros) {
      const prevMacros = get().macros;
      set({ macros: { ...get().macros, ...raw.macros } });
      try {
        await get().pushMacrosToRuntime?.();
      } catch (e) {
        console.error('Failed to push restored macros:', e);
        set({ macros: prevMacros });
        await get().pushMacrosToRuntime?.().catch(silentCatch);
        toast.error(`Show loaded but macros failed to apply: ${e}`);
      }
    }

    // 4. Config OSC — set direct + push backend (playback déjà exclu).
    //    Rollback frontend + backend sur échec pour éviter la divergence.
    if (raw.osc) {
      const prevOsc = {
        oscAddress: get().oscAddress,
        oscPort: get().oscPort,
        oscProfile: get().oscProfile,
        oscInPort: get().oscInPort,
      };
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
        set(prevOsc);
        safeSetItem('stagespace-osc-config', JSON.stringify(prevOsc));
        await invoke('set_osc_output', {
          address: prevOsc.oscAddress,
          port: prevOsc.oscPort,
          profile: prevOsc.oscProfile,
        }).catch(silentCatch);
        await invoke('set_osc_receiver_port', { port: prevOsc.oscInPort }).catch(silentCatch);
        toast.error(`Show loaded but OSC config failed to apply: ${e}`);
      }
    }

    // 5. Graphe global — restore + push backend. Revert + re-push de
    //    l'ancien graphe si le push échoue (frontend/backend alignés).
    if (raw.globalGraph) {
      const prevNodes = useGlobalGraphStore.getState().nodes;
      const prevEdges = useGlobalGraphStore.getState().edges;
      useGlobalGraphStore.setState({
        nodes: raw.globalGraph.nodes,
        edges: raw.globalGraph.edges,
      });
      // push*() retournent un succès — le rollback est réel (les pushes
      // catchaient en interne : le revert n'exécutait jamais).
      const ok = await useGlobalGraphStore.getState().pushGlobalGraph();
      if (!ok) {
        useGlobalGraphStore.setState({ nodes: prevNodes, edges: prevEdges });
        await useGlobalGraphStore.getState().pushGlobalGraph();
        toast.error('Show loaded but global graph failed to apply — reverted');
      }
    }

    // 5b. Graph de modulation (domaine signal) — même pattern restore+push.
    const { useSignalGraphStore } = await import('../useSignalGraphStore');
    if (raw.signalGraph) {
      const prevNodes = useSignalGraphStore.getState().nodes;
      const prevEdges = useSignalGraphStore.getState().edges;
      useSignalGraphStore.setState({
        nodes: raw.signalGraph.nodes,
        edges: raw.signalGraph.edges,
        // Le push cible le graphe GLOBAL du merge — si l'utilisateur
        // avait un Mods-tab de slot ouvert (context != 'global'), le
        // push court-circuitait et le graphe était silencieusement
        // perdu au prochain setContext (revue L4).
        context: 'global',
      });
      const ok = await useSignalGraphStore.getState().pushSignalGraph();
      if (!ok) {
        useSignalGraphStore.setState({ nodes: prevNodes, edges: prevEdges });
        await useSignalGraphStore.getState().pushSignalGraph();
        toast.error('Show loaded but signal graph failed to apply — reverted');
      }
    }

    // 6. Spatial FX — replay des zones/modulations/channels sur le backend
    //    (clear d'abord : le fichier remplace l'état courant). Le store
    //    frontend est le snapshot de l'état précédent (playback exclu →
    //    pas de divergence possible) — rollback par replay sur échec.
    if (raw.spatialFx) {
      const prevFx = {
        zones: get().zones,
        modulations: get().modulations,
        objectChannels: get().objectChannels,
        kinematicSmoothing: get().kinematicSmoothing,
      };
      const replayFx = async (fx: typeof prevFx) => {
        await invoke('clear_zones');
        await invoke('clear_channel_modulations');
        await invoke('clear_all_spatial_channels');
        for (const z of fx.zones ?? []) {
          await invoke('add_zone', { params: zoneToParams(z) });
        }
        for (const m of fx.modulations ?? []) {
          await invoke('add_channel_modulation', { params: modulationToParams(m) });
        }
        for (const [objIdx, channels] of Object.entries(fx.objectChannels ?? {})) {
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
        await invoke('set_kinematic_smoothing', { smoothing: fx.kinematicSmoothing });
      };
      try {
        await replayFx({
          zones: raw.spatialFx.zones ?? [],
          modulations: raw.spatialFx.modulations ?? [],
          objectChannels: raw.spatialFx.objectChannels ?? {},
          kinematicSmoothing:
            typeof raw.spatialFx.kinematicSmoothing === 'number'
              ? raw.spatialFx.kinematicSmoothing
              : prevFx.kinematicSmoothing,
        });
        await get().refreshSpatialFx?.();
      } catch (e) {
        console.error('Failed to restore spatial FX:', e);
        try {
          await replayFx(prevFx);
          await get().refreshSpatialFx?.();
        } catch (rbErr) {
          console.error('Spatial FX rollback failed:', rbErr);
        }
        toast.error(`Show loaded but spatial FX restore failed: ${e}`);
      }
    }
  },
});
