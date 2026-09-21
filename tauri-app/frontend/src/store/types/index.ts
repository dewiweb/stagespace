export type NodeType =
  | 'Objects' | 'Duration' | 'Output' | 'Input'
  | 'Circular' | 'Elliptical' | 'Spiral' | 'Lissajous' | 'Figure8' | 'Linear' | 'Oscillation'
  | 'Formation' | 'PerlinNoise' | 'Converge' | 'Pendulum'
  | 'RoseCurve' | 'Helix' | 'Wave'
  | 'Bouncing' | 'Avoidance' | 'Spring' | 'Follow' | 'Swarm' | 'VectorField'
  | 'CustomTrajectory'
  | 'DrawSpline' | 'EvaluateSpline' | 'TrimSpline' | 'OffsetSpline'
  | 'TimeFalloff' | 'PointDistanceFalloff' | 'DirectionalFalloff' | 'AudioAmplitudeFalloff'
  | 'Scale' | 'Rotate' | 'Offset' | 'PhaseShift'
  | 'Mirror' | 'Clamp' | 'LFO' | 'Jitter'
  | 'RadiusScale' | 'HeightOffset' | 'PerTrackDepth' | 'Barycenter' | 'AudioFalloff' | 'ManualPosition'
  | 'Zone' | 'Velocity'
  | 'MoveRef' | 'Merge'
  | 'BPM' | 'AudioAmplitude' | 'AudioSpectrum' | 'OSCInput'
  | 'Mix' | 'Group' | 'Sequence' | 'Crossfade';

export type AppStatus = 'idle' | 'compiling' | 'compiled' | 'playing' | 'error';

// Généré depuis Rust (ts-rs) — voir src-tauri/src/lib.rs `MovementInfo`.
export type { MovementInfo } from '../../types/generated/MovementInfo';

export interface HolTrack {
  id: number;
  name: string;
  position: [number, number, number];
  color: string;
}

export interface HolProject {
  tracks: HolTrack[];
}
