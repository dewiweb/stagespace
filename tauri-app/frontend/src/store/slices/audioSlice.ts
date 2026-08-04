import { StateCreator } from 'zustand';

export interface AudioState {
  bpm: { bpm: number; confidence: number; last_beat_time: number } | null;
  amplitude: { rms: number; bass: number; mid: number; high: number } | null;
  spectrum: { spectrum: number[]; fft_size: number } | null;
}

export interface AudioSlice {
  // Audio
  audioState: AudioState;
  setAudioState: (state: AudioState) => void;
}

export const createAudioSlice: StateCreator<AudioSlice, [], [], AudioSlice> = (set) => ({
  audioState: { bpm: null, amplitude: null, spectrum: null },
  setAudioState: (audioState) => set({ audioState }),
});
