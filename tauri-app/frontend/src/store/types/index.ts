export type NodeType =
  | 'Objects' | 'Duration' | 'Output' | 'Input'
  | 'Circular' | 'Elliptical' | 'Spiral' | 'Lissajous' | 'Figure8' | 'Linear' | 'Oscillation'
  | 'Formation' | 'PerlinNoise' | 'Converge' | 'Pendulum'
  | 'RoseCurve' | 'Helix' | 'Wave'
  | 'Bouncing' | 'Avoidance' | 'Spring' | 'Follow' | 'Swarm'
  | 'CustomTrajectory'
  | 'DrawSpline' | 'EvaluateSpline' | 'TrimSpline' | 'OffsetSpline'
  | 'TimeFalloff' | 'PointDistanceFalloff' | 'DirectionalFalloff' | 'AudioAmplitudeFalloff'
  | 'Scale' | 'Rotate' | 'Offset' | 'PhaseShift' | 'BarycentricGroup'
  | 'Mirror' | 'Clamp' | 'LFO' | 'Jitter'
  | 'RadiusScale' | 'HeightOffset' | 'PerTrackDepth' | 'Barycenter' | 'AudioFalloff' | 'ManualPosition'
  | 'Zone' | 'Velocity'
  | 'MoveRef' | 'Merge'
  | 'BPM' | 'AudioAmplitude' | 'AudioSpectrum' | 'OSCInput'
  | 'Mix' | 'Group' | 'Sequence' | 'Crossfade';

export type AppStatus = 'idle' | 'compiling' | 'compiled' | 'playing' | 'error';

export interface MovementInfo {
  id: string;
  name: string;
  osc_ids: number[];
  is_preview: boolean;
  is_playing: boolean;
  track_count: number;
  fps: number;
  osc_rate: number;
  latency_ms: number;
  cpu_percent: number;
}

export interface HolTrack {
  id: number;
  name: string;
  position: [number, number, number];
  color: string;
}

export interface HolProject {
  tracks: HolTrack[];
}
