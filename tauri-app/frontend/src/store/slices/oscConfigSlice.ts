import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { safeSetItem, safeParseStoredJson } from '../../utils/safeStorage';

/// Configuration OSC partagée — adresse, port, profil
/// Utilisée par Toolbar (saisie), TrajectoryPanel (playMovement), goToNextCue (GO button)
/// Persistée dans localStorage pour survivre au redémarrage

const OSC_CONFIG_STORAGE_KEY = 'stagespace-osc-config';

interface PersistedOscConfig {
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  oscInPort: number;
  /// Frame rate de conversion HH:MM:SS:FF du timecode OSC (non-drop).
  timecodeFps: number;
  /// PSN/RTTrP — tracking industrie (BlackTrax/Zactrack/Follow-Me).
  psnEnabled: boolean;
  psnGroup: string;
  psnPort: number;
  /// Mapping tracker_id → object_index (texte "1:7,2:8").
  psnMap: string;
  /// Permutation/signes d'axes PSN→stage (texte "x,-y,z").
  psnAxes: string;
  /// Auto-venue : scale+offset espace canonique → salle réelle.
  venueEnabled: boolean;
  venueScale: string;
  venueOffset: string;
}

function loadConfigFromStorage(): Partial<PersistedOscConfig> {
  return safeParseStoredJson<Partial<PersistedOscConfig>>(OSC_CONFIG_STORAGE_KEY, {});
}

function saveConfigToStorage(config: PersistedOscConfig) {
  safeSetItem(OSC_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

const persist = (s: OscConfigSlice, patch: Partial<PersistedOscConfig>) => {
  saveConfigToStorage({
    oscAddress: s.oscAddress,
    oscPort: s.oscPort,
    oscProfile: s.oscProfile,
    oscInPort: s.oscInPort,
    timecodeFps: s.timecodeFps,
    psnEnabled: s.psnEnabled,
    psnGroup: s.psnGroup,
    psnPort: s.psnPort,
    psnMap: s.psnMap,
    psnAxes: s.psnAxes,
    venueEnabled: s.venueEnabled,
    venueScale: s.venueScale,
    venueOffset: s.venueOffset,
    ...patch,
  });
};

/// Intervalle de santé PSN — vit dans le slice (donnée), pas dans un
/// composant (l'UI lit juste `psnRunning`/`psnLastPacketAge`).
let psnHealthTimer: ReturnType<typeof setInterval> | null = null;

/// Vérifie si des movements sont actifs (playback en cours)
/// Import dynamique pour éviter une dépendance circulaire
async function isPlaybackActive(): Promise<boolean> {
  const { useGraphStore } = await import('../useGraphStore');
  return useGraphStore.getState().movements.length > 0;
}

export interface OscConfigSlice {
  /// OSC OUT — adresse du récepteur (Holophonix, SPAT, etc.)
  oscAddress: string;
  /// OSC OUT — port du récepteur
  oscPort: number;
  /// OSC OUT — profil de formatage (holophonix, iem, ircam, etc.)
  oscProfile: string;
  /// OSC IN — port d'écoute du receiver (messages entrants)
  oscInPort: number;
  /// Frame rate du timecode OSC entrant (24/25/30 non-drop, défaut 25).
  timecodeFps: number;
  /// PSN/RTTrP — tracking industrie.
  psnEnabled: boolean;
  psnGroup: string;
  psnPort: number;
  /// Mapping tracker_id→object_index, texte "1:7,2:8".
  psnMap: string;
  /// Permutation/signes d'axes PSN→stage, texte "x,-y,z" (convention
  /// variable selon l'installateur du système de tracking).
  psnAxes: string;
  /// Santé du flux PSN — âge du dernier paquet (ms), null = jamais reçu.
  psnLastPacketAge: number | null;
  psnRunning: boolean;
  setPsnConfig: (cfg: { enabled?: boolean; group?: string; port?: number; map?: string; axes?: string }) => Promise<void>;
  refreshPsnHealth: () => Promise<void>;
  /// Auto-venue — scale/offset texte "x,y,z" appliqués au payload OSC.
  venueEnabled: boolean;
  venueScale: string;
  venueOffset: string;
  setVenueConfig: (cfg: { enabled?: boolean; scale?: string; offset?: string }) => Promise<void>;
  setOscAddress: (addr: string) => void;
  setOscPort: (port: number) => void;
  setOscProfile: (profile: string) => void;
  setOscInPort: (port: number) => Promise<void>;
  setTimecodeFps: (fps: number) => Promise<void>;
}

export const createOscConfigSlice: StateCreator<OscConfigSlice, [], [], OscConfigSlice> = (set, get) => {
  const saved = loadConfigFromStorage();

  return {
    oscAddress: saved.oscAddress ?? '127.0.0.1',
    oscPort: saved.oscPort ?? 9000,
    oscProfile: saved.oscProfile ?? 'holophonix',
    oscInPort: saved.oscInPort ?? 8001,
    timecodeFps: saved.timecodeFps ?? 25,
    psnEnabled: saved.psnEnabled ?? false,
    psnGroup: saved.psnGroup ?? '236.0.0.1',
    psnPort: saved.psnPort ?? 56565,
    psnMap: saved.psnMap ?? '',
    psnAxes: saved.psnAxes ?? 'x,y,z',
    venueEnabled: saved.venueEnabled ?? false,
    venueScale: saved.venueScale ?? '1,1,1',
    venueOffset: saved.venueOffset ?? '0,0,0',
    psnLastPacketAge: null,
    psnRunning: false,
    setPsnConfig: async (cfg) => {
      const prev = {
        psnEnabled: get().psnEnabled,
        psnGroup: get().psnGroup,
        psnPort: get().psnPort,
        psnMap: get().psnMap,
        psnAxes: get().psnAxes,
      };
      const next = {
        psnEnabled: cfg.enabled ?? prev.psnEnabled,
        psnGroup: cfg.group ?? prev.psnGroup,
        psnPort: cfg.port ?? prev.psnPort,
        psnMap: cfg.map ?? prev.psnMap,
        psnAxes: cfg.axes ?? prev.psnAxes,
      };
      set(next);
      persist(get(), next);
      // Parse "1:7,2:8" → {1:7, 2:8} — l'opérateur saisit des track_ids,
      // le backend attend des obj_index (position dans osc_ids) :
      // conversion à la frontière UI→wire, comme partout ailleurs.
      const { useGraphStore } = await import('../useGraphStore');
      const oscIds = useGraphStore.getState().manualOscIds;
      const trackerMap: Record<number, number> = {};
      for (const pair of next.psnMap.split(',')) {
        const [t, o] = pair.split(':').map((s) => parseInt(s.trim()));
        const objIdx = oscIds.indexOf(o);
        if (Number.isFinite(t) && Number.isFinite(o) && objIdx >= 0) trackerMap[t] = objIdx;
      }
      try {
        await invoke('set_psn_config', {
          enabled: next.psnEnabled,
          group: next.psnGroup,
          port: next.psnPort,
          tracker_map: trackerMap,
          axes: next.psnAxes,
        });
        // Poll santé piloté par le slice (pas React) — tourne tant que le
        // flux est actif, indépendamment de l'UI ouverte.
        if (next.psnEnabled && !psnHealthTimer) {
          psnHealthTimer = setInterval(() => get().refreshPsnHealth(), 1000);
          get().refreshPsnHealth();
        } else if (!next.psnEnabled && psnHealthTimer) {
          clearInterval(psnHealthTimer);
          psnHealthTimer = null;
          set({ psnRunning: false, psnLastPacketAge: null });
        }
      } catch (e) {
        set(prev);
        persist(get(), prev);
        console.error('[setPsnConfig] Failed:', e);
        toast.error('PSN config failed: ' + e);
      }
    },
    setVenueConfig: async (cfg) => {
      const prev = {
        venueEnabled: get().venueEnabled,
        venueScale: get().venueScale,
        venueOffset: get().venueOffset,
      };
      const next = {
        venueEnabled: cfg.enabled ?? prev.venueEnabled,
        venueScale: cfg.scale ?? prev.venueScale,
        venueOffset: cfg.offset ?? prev.venueOffset,
      };
      const parse3 = (str: string): [number, number, number] | null => {
        const p = str.split(',').map((x) => parseFloat(x.trim()));
        return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : null;
      };
      const scale = parse3(next.venueScale);
      const offset = parse3(next.venueOffset);
      if (!scale || !offset) {
        toast.error('Venue config: scale/offset must be "x,y,z" numbers');
        return;
      }
      set(next);
      persist(get(), next);
      try {
        await invoke('set_venue_config', { enabled: next.venueEnabled, scale, offset });
      } catch (e) {
        set(prev);
        persist(get(), prev);
        toast.error('Venue config failed: ' + e);
      }
    },
    refreshPsnHealth: async () => {
      try {
        const [running, age] = await invoke<[boolean, number | null]>('get_psn_health');
        set({ psnRunning: running, psnLastPacketAge: age });
      } catch { /* silencieux — indicateur non critique */ }
    },
    setOscAddress: (addr) => {
      isPlaybackActive().then((active) => {
        if (active) {
          toast.warning('Cannot change OSC address during playback. Stop all moves first.');
          return;
        }
        set({ oscAddress: addr });
        persist(get(), { oscAddress: addr });
      });
    },
    setOscPort: (port) => {
      isPlaybackActive().then((active) => {
        if (active) {
          toast.warning('Cannot change OSC port during playback. Stop all moves first.');
          return;
        }
        set({ oscPort: port });
        persist(get(), { oscPort: port });
      });
    },
    setOscProfile: (profile) => {
      isPlaybackActive().then((active) => {
        if (active) {
          toast.warning('Cannot change OSC profile during playback. Stop all moves first.');
          return;
        }
        set({ oscProfile: profile });
        persist(get(), { oscProfile: profile });
      });
    },
    setOscInPort: async (port) => {
      if (await isPlaybackActive()) {
        toast.warning('Cannot change OSC input port during playback. Stop all moves first.');
        return;
      }
      const oldPort = get().oscInPort;
      set({ oscInPort: port });
      persist(get(), { oscInPort: port });
      // Appliquer côté backend (stop l'ancien receiver, démarre le nouveau)
      try {
        await invoke('set_osc_receiver_port', { port });
      } catch (e) {
        // Revert state + storage si le backend échoue
        set({ oscInPort: oldPort });
        persist(get(), { oscInPort: oldPort });
        console.error('[setOscInPort] Failed to set OSC receiver port:', e);
        toast.error('OSC port change failed: ' + e);
      }
    },
    setTimecodeFps: async (fps) => {
      const prev = get().timecodeFps;
      set({ timecodeFps: fps });
      persist(get(), { timecodeFps: fps });
      try {
        await invoke('set_timecode_fps', { fps });
      } catch (e) {
        set({ timecodeFps: prev });
        persist(get(), { timecodeFps: prev });
        console.error('[setTimecodeFps] Failed:', e);
        toast.error('Timecode fps change failed: ' + e);
      }
    },
  };
};
