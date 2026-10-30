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
    ...patch,
  });
};

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
