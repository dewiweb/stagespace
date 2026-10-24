import type { AudioModSource, AudioModTarget } from '../store/useMoveEditorStore';

export function audioSourceLabel(s: AudioModSource): string {
  if (typeof s === 'string') {
    const map: Record<string, string> = {
      bpm: 'BPM', amplitude_rms: 'RMS', amplitude_bass: 'Bass',
      amplitude_mid: 'Mid', amplitude_high: 'High',
    };
    return map[s] ?? s;
  }
  return `Band ${s.spectrum_band}`;
}

export function audioTargetLabel(t: AudioModTarget): string {
  const map: Record<string, string> = {
    speed: 'Speed', scale: 'Scale', radius_scale: 'Radius',
    height_offset: 'Height', offset_x: 'Offset X', offset_y: 'Offset Y',
    offset_z: 'Offset Z', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll',
  };
  if (typeof t === 'string') return map[t] ?? t;
  return String(t);
}
