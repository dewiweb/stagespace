// ── Audio analysis types ──────────────────────────────────────────────────────

export interface AudioFrame {
  amplitude: number      // RMS 0–1
  peak: number           // peak 0–1
  bpm: number            // detected BPM (0 if unknown)
  beat: boolean          // true on beat tick
  spectrum: Float32Array // FFT magnitudes (dB, 0 = silence)
}

export interface AudioConfig {
  fftSize: number          // 2^n, default 2048
  smoothingTimeConstant: number   // 0–1, default 0.8
  bpmWindowSeconds: number // window for BPM averaging, default 4
  beatThreshold: number    // energy multiplier to detect beat, default 1.3
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  bpmWindowSeconds: 4,
  beatThreshold: 1.3,
}
