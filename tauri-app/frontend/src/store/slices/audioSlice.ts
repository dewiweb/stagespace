import { StateCreator } from 'zustand';
import { safeSetItem } from '../../utils/safeStorage';

const AUDIO_DEVICE_STORAGE_KEY = 'stagespace-audio-device';

export interface AudioState {
  bpm: { bpm: number; confidence: number; last_beat_time: number } | null;
  amplitude: { rms: number; bass: number; mid: number; high: number } | null;
  spectrum: { spectrum: number[]; fft_size: number } | null;
}

export interface AudioSlice {
  // Audio
  audioState: AudioState;
  setAudioState: (state: AudioState) => void;
  /// Device ID sélectionné pour l'entrée audio (persisté)
  selectedAudioDeviceId: string | null;
  setSelectedAudioDeviceId: (deviceId: string | null) => void;
}

function loadAudioDeviceFromStorage(): string | null {
  try {
    return localStorage.getItem(AUDIO_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveAudioDeviceToStorage(deviceId: string | null) {
  if (deviceId) {
    safeSetItem(AUDIO_DEVICE_STORAGE_KEY, deviceId);
  } else {
    localStorage.removeItem(AUDIO_DEVICE_STORAGE_KEY);
  }
}

export const createAudioSlice: StateCreator<AudioSlice, [], [], AudioSlice> = (set) => ({
  audioState: { bpm: null, amplitude: null, spectrum: null },
  setAudioState: (audioState) => set({ audioState }),
  selectedAudioDeviceId: loadAudioDeviceFromStorage(),
  setSelectedAudioDeviceId: (deviceId) => {
    set({ selectedAudioDeviceId: deviceId });
    saveAudioDeviceToStorage(deviceId);
  },
});
