import { StateCreator } from 'zustand';
import { safeInvoke as invoke } from '../../utils/tauri';

/// Configuration OSC partagée — adresse, port, profil
/// Utilisée par Toolbar (saisie), TrajectoryPanel (playMovement), goToNextCue (GO button)
/// Persistée dans localStorage pour survivre au redémarrage

const OSC_CONFIG_STORAGE_KEY = 'stagespace-osc-config';

interface PersistedOscConfig {
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  oscInPort: number;
}

function loadConfigFromStorage(): Partial<PersistedOscConfig> {
  try {
    const raw = localStorage.getItem(OSC_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveConfigToStorage(config: PersistedOscConfig) {
  try {
    localStorage.setItem(OSC_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {}
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
  setOscAddress: (addr: string) => void;
  setOscPort: (port: number) => void;
  setOscProfile: (profile: string) => void;
  setOscInPort: (port: number) => Promise<void>;
}

export const createOscConfigSlice: StateCreator<OscConfigSlice, [], [], OscConfigSlice> = (set, get) => {
  const saved = loadConfigFromStorage();

  return {
    oscAddress: saved.oscAddress ?? '127.0.0.1',
    oscPort: saved.oscPort ?? 9000,
    oscProfile: saved.oscProfile ?? 'holophonix',
    oscInPort: saved.oscInPort ?? 8001,
    setOscAddress: (addr) => {
      set({ oscAddress: addr });
      const s = get();
      saveConfigToStorage({ oscAddress: addr, oscPort: s.oscPort, oscProfile: s.oscProfile, oscInPort: s.oscInPort });
    },
    setOscPort: (port) => {
      set({ oscPort: port });
      const s = get();
      saveConfigToStorage({ oscAddress: s.oscAddress, oscPort: port, oscProfile: s.oscProfile, oscInPort: s.oscInPort });
    },
    setOscProfile: (profile) => {
      set({ oscProfile: profile });
      const s = get();
      saveConfigToStorage({ oscAddress: s.oscAddress, oscPort: s.oscPort, oscProfile: profile, oscInPort: s.oscInPort });
    },
    setOscInPort: async (port) => {
      set({ oscInPort: port });
      const s = get();
      saveConfigToStorage({ oscAddress: s.oscAddress, oscPort: s.oscPort, oscProfile: s.oscProfile, oscInPort: port });
      // Appliquer côté backend (stop l'ancien receiver, démarre le nouveau)
      try {
        await invoke('set_osc_receiver_port', { port });
      } catch (e) {
        console.error('[setOscInPort] Failed to set OSC receiver port:', e);
      }
    },
  };
};
