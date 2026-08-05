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

export interface CueInfo {
  id: string;
  name: string;
  description: string;
  graph: any;
  timestamp: number;
  macros?: {
    speed: number; scale: number;
    shiftX: number; shiftY: number; shiftZ: number;
    yaw: number; pitch: number; roll: number;
  };
  track_indices?: number[];
  fade_duration?: number;
  cue_number?: string;
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
