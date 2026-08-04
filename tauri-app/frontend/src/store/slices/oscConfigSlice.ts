import { StateCreator } from 'zustand';

/// Configuration OSC partagée — adresse, port, profil
/// Utilisée par Toolbar (saisie), TrajectoryPanel (playMovement), goToNextCue (GO button)
export interface OscConfigSlice {
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  setOscAddress: (addr: string) => void;
  setOscPort: (port: number) => void;
  setOscProfile: (profile: string) => void;
}

export const createOscConfigSlice: StateCreator<OscConfigSlice, [], [], OscConfigSlice> = (set) => ({
  oscAddress: '127.0.0.1',
  oscPort: 9000,
  oscProfile: 'holophonix',
  setOscAddress: (addr) => set({ oscAddress: addr }),
  setOscPort: (port) => set({ oscPort: port }),
  setOscProfile: (profile) => set({ oscProfile: profile }),
});
