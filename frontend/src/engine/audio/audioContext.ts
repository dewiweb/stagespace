// ── Shared audio frame singleton ──────────────────────────────────────────────
// A mutable ref updated by the store at ~30fps.
// Read by the graph compiler (audioAmplitude/bpm signal nodes) at compile-time
// to produce bound falloff functions that read the current frame at call-time.

import type { AudioFrame } from './types'

export const sharedAudioFrame: AudioFrame = {
  amplitude: 0,
  peak: 0,
  bpm: 0,
  beat: false,
  spectrum: new Float32Array(1024),
}

export function updateSharedAudioFrame(frame: AudioFrame): void {
  sharedAudioFrame.amplitude = frame.amplitude
  sharedAudioFrame.peak      = frame.peak
  sharedAudioFrame.bpm       = frame.bpm
  sharedAudioFrame.beat      = frame.beat
  sharedAudioFrame.spectrum  = frame.spectrum
}
