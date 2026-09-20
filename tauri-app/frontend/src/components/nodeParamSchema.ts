import { NodeType } from '../store/useGraphStore';
import { isValidConnection as isValidConnectionExported } from '../utils/connectionRules';

export type ParamType = 'number' | 'boolean' | 'string' | 'vec3' | 'enum' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  options?: string[];
  step?: number;
  min?: number;
  max?: number;
}

const PLANE_OPTIONS = ['xz', 'xy', 'yz'];
const AXIS_OPTIONS = ['x', 'y', 'z'];
const AXIS_ALL_OPTIONS = ['x', 'y', 'z', 'all'];
const EASING_OPTIONS = ['linear', 'ease_in', 'ease_out', 'ease_in_out'];
const SHAPE_OPTIONS = ['circle', 'line', 'arc', 'grid'];
const CONTAINER_OPTIONS = ['sphere', 'box'];
const COORD_OPTIONS = ['cartesian', 'polar', 'spherical'];
const BAND_OPTIONS = ['rms', 'bass', 'mid', 'high'];
const WAVEFORM_OPTIONS = ['sine', 'triangle', 'square', 'sawtooth'];
const ZONE_SHAPE_OPTIONS = ['sphere', 'box'];
const KINEMATIC_SOURCE_OPTIONS = ['speed', 'acceleration', 'jerk', 'angvel'];
const SPATIAL_CHANNEL_OPTIONS = ['gain', 'spread', 'distance', 'presence', 'yaw', 'aperture', 'lfe'];

export const PARAM_SCHEMA: Partial<Record<NodeType, ParamDef[]>> = {
  Objects: [{ key: 'n_objects', label: 'Count', type: 'number', min: 1, max: 64, step: 1 }],
  Duration: [{ key: 'duration', label: 'Duration (s)', type: 'number', min: 0.1, step: 0.1 }],
  Output: [{ key: 'track_range', label: 'Track Range (ex: 0-11)', type: 'text' }],

  Circular: [
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Spiral: [
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'expansion', label: 'Expansion', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Lissajous: [
    { key: 'a', label: 'A', type: 'number', step: 0.1 },
    { key: 'b', label: 'B', type: 'number', step: 0.1 },
    { key: 'delta', label: 'Delta', type: 'number', step: 0.01 },
    { key: 'scale', label: 'Scale', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Figure8: [
    { key: 'scale', label: 'Scale', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Linear: [
    { key: 'start', label: 'Start', type: 'vec3' },
    { key: 'end', label: 'End', type: 'vec3' },
  ],
  Oscillation: [
    { key: 'amplitude', label: 'Amplitude', type: 'number', step: 0.1 },
    { key: 'frequency', label: 'Frequency', type: 'number', step: 0.1 },
    { key: 'axis', label: 'Axis', type: 'enum', options: AXIS_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Formation: [
    { key: 'shape', label: 'Shape', type: 'enum', options: SHAPE_OPTIONS },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'rotate', label: 'Rotate', type: 'number', step: 0.1 },
    { key: 'elevation', label: 'Elevation', type: 'number', step: 0.1 },
  ],
  PerlinNoise: [
    { key: 'intensity', label: 'Intensity', type: 'number', step: 0.1 },
    { key: 'smoothness', label: 'Smoothness', type: 'number', step: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  Converge: [
    { key: 'start_radius', label: 'Start Radius', type: 'number', step: 0.1 },
    { key: 'end_radius', label: 'End Radius', type: 'number', step: 0.1 },
    { key: 'easing', label: 'Easing', type: 'enum', options: EASING_OPTIONS },
  ],
  Pendulum: [
    { key: 'length', label: 'Length', type: 'number', step: 0.1 },
    { key: 'gravity', label: 'Gravity', type: 'number', step: 0.1 },
    { key: 'initial_angle', label: 'Initial Angle', type: 'number', step: 0.1 },
    { key: 'damping', label: 'Damping', type: 'number', step: 0.01 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Bouncing: [
    { key: 'container', label: 'Container', type: 'enum', options: CONTAINER_OPTIONS },
    { key: 'container_size', label: 'Container Size', type: 'number', step: 0.1 },
    { key: 'restitution', label: 'Restitution', type: 'number', step: 0.01, min: 0, max: 1 },
    { key: 'gravity', label: 'Gravity', type: 'number', step: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  Avoidance: [
    { key: 'repulsion_radius', label: 'Repulsion Radius', type: 'number', step: 0.1 },
    { key: 'repulsion_strength', label: 'Repulsion Strength', type: 'number', step: 0.1 },
    { key: 'damping', label: 'Damping', type: 'number', step: 0.01 },
    { key: 'container_size', label: 'Container Size', type: 'number', step: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  Spring: [
    { key: 'target', label: 'Target', type: 'vec3' },
    { key: 'stiffness', label: 'Stiffness', type: 'number', step: 0.1 },
    { key: 'damping_coef', label: 'Damping', type: 'number', step: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  Follow: [
    { key: 'mode', label: 'Mode', type: 'enum', options: ['follow', 'pursue', 'evade', 'orbit', 'arrive'] },
    { key: 'speed', label: 'Max Speed', type: 'number', step: 0.1, min: 0 },
    { key: 'distance', label: 'Distance / Ring Radius', type: 'number', step: 0.1, min: 0 },
    { key: 'lookahead', label: 'Lookahead s (pursue/evade)', type: 'number', step: 0.1, min: 0 },
    { key: 'arrive_radius', label: 'Arrive Radius', type: 'number', step: 0.1, min: 0 },
    { key: 'orbit_speed', label: 'Orbit Speed m/s', type: 'number', step: 0.1 },
    { key: 'orbit_dir', label: 'Orbit Dir (±1)', type: 'number', step: 1 },
    { key: 'responsiveness', label: 'Responsiveness', type: 'number', step: 0.05, min: 0, max: 1 },
    { key: 'target_radius', label: 'Target Radius', type: 'number', step: 0.1, min: 0 },
    { key: 'target_speed', label: 'Target Speed (rev/dur)', type: 'number', step: 0.1 },
    { key: 'target_z', label: 'Target Z', type: 'number', step: 0.1 },
    { key: 'init_radius', label: 'Init Scatter', type: 'number', step: 0.1, min: 0 },
    { key: 'bounds', label: 'Bounds (evade)', type: 'number', step: 0.1, min: 0 },
    { key: 'containment', label: 'Containment', type: 'number', step: 0.1, min: 0 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  Swarm: [
    { key: 'separation', label: 'Separation', type: 'number', step: 0.1 },
    { key: 'alignment', label: 'Alignment', type: 'number', step: 0.1 },
    { key: 'cohesion', label: 'Cohesion', type: 'number', step: 0.1 },
    { key: 'max_speed', label: 'Max Speed', type: 'number', step: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  VectorField: [
    { key: 'field', label: 'Field', type: 'enum', options: ['vortex', 'sink', 'source', 'flow', 'noise', 'drawn'] },
    { key: 'points', label: 'Drawn Vectors x,y,vx,vy;...', type: 'text' },
    { key: 'idw_power', label: 'IDW Power', type: 'number', step: 0.5, min: 0.5, max: 8 },
    { key: 'strength', label: 'Strength', type: 'number', step: 0.1, min: 0 },
    { key: 'center', label: 'Center', type: 'vec3' },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1, min: 0.01 },
    { key: 'swirl', label: 'Swirl (spiral)', type: 'number', step: 0.1 },
    { key: 'direction', label: 'Direction (flow)', type: 'vec3' },
    { key: 'noise_scale', label: 'Noise Scale', type: 'number', step: 0.1, min: 0.01 },
    { key: 'wander', label: 'Wander', type: 'number', step: 0.05, min: 0, max: 1 },
    { key: 'responsiveness', label: 'Responsiveness', type: 'number', step: 0.05, min: 0, max: 1 },
    { key: 'max_speed', label: 'Max Speed', type: 'number', step: 0.1, min: 0 },
    { key: 'bounds', label: 'Bounds', type: 'number', step: 0.1, min: 0.01 },
    { key: 'containment', label: 'Containment', type: 'number', step: 0.1, min: 0 },
    { key: 'init', label: 'Init Layout', type: 'enum', options: ['circle', 'line', 'grid', 'random', 'point'] },
    { key: 'init_radius', label: 'Init Radius', type: 'number', step: 0.1, min: 0 },
    { key: 'z_init', label: 'Z Init', type: 'number', step: 0.1 },
    { key: 'z_drift', label: 'Z Drift', type: 'number', step: 0.05 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],
  CustomTrajectory: [
    { key: 'coordinate_system', label: 'Coord System', type: 'enum', options: COORD_OPTIONS },
    { key: 'equations', label: 'Equations (x,y,z)', type: 'text' },
  ],
  BPM: [
    { key: 'bpm', label: 'BPM', type: 'number', step: 1, min: 1 },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
  ],
  AudioAmplitude: [
    { key: 'amplitude', label: 'Amplitude', type: 'number', step: 0.1 },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'band', label: 'Band', type: 'enum', options: BAND_OPTIONS },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
  ],
  TimeFalloff: [
    { key: 'start_time', label: 'Start Time', type: 'number', step: 0.1 },
    { key: 'end_time', label: 'End Time', type: 'number', step: 0.1 },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'curve', label: 'Curve', type: 'enum', options: EASING_OPTIONS },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
  ],
  PointDistanceFalloff: [
    { key: 'center', label: 'Center', type: 'vec3' },
    { key: 'max_distance', label: 'Max Distance', type: 'number', step: 0.1 },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'curve', label: 'Curve', type: 'enum', options: EASING_OPTIONS },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
  ],
  Mix: [{ key: 'blend', label: 'Blend', type: 'number', step: 0.01, min: 0, max: 1 }],
  Group: [],
  Sequence: [],
  Crossfade: [
    { key: 'fade_duration', label: 'Fade Duration (s)', type: 'number', step: 0.1, min: 0.1 },
  ],

  // New math engines
  Elliptical: [
    { key: 'a', label: 'Semi-major', type: 'number', step: 0.1 },
    { key: 'b', label: 'Semi-minor', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  RoseCurve: [
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'n_petals', label: 'Petals (k)', type: 'number', step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'plane', label: 'Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Helix: [
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
    { key: 'height', label: 'Height', type: 'number', step: 0.1 },
    { key: 'turns', label: 'Turns', type: 'number', step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  Wave: [
    { key: 'amplitude', label: 'Amplitude', type: 'number', step: 0.1 },
    { key: 'frequency', label: 'Frequency', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'axis', label: 'Wave Axis', type: 'enum', options: AXIS_OPTIONS },
    { key: 'spread', label: 'Spread', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],

  // Splines
  DrawSpline: [
    { key: 'points', label: 'Points', type: 'text' },
  ],
  EvaluateSpline: [
    { key: 'closed', label: 'Closed', type: 'boolean' },
    { key: 'tension', label: 'Tension', type: 'number', step: 0.1, min: 0, max: 1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  TrimSpline: [
    { key: 'points', label: 'Points', type: 'text' },
    { key: 'trim_start', label: 'Trim Start', type: 'number', step: 0.05, min: 0, max: 1 },
    { key: 'trim_end', label: 'Trim End', type: 'number', step: 0.05, min: 0, max: 1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],
  OffsetSpline: [
    { key: 'points', label: 'Points', type: 'text' },
    { key: 'offset_x', label: 'Offset X', type: 'number', step: 0.1 },
    { key: 'offset_y', label: 'Offset Y', type: 'number', step: 0.1 },
    { key: 'offset_z', label: 'Offset Z', type: 'number', step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', step: 0.1 },
    { key: 'phase_offset', label: 'Phase Offset', type: 'boolean' },
  ],

  // Falloffs
  DirectionalFalloff: [
    { key: 'direction', label: 'Direction', type: 'vec3' },
    { key: 'max_distance', label: 'Max Distance', type: 'number', step: 0.1 },
    { key: 'curve', label: 'Curve', type: 'enum', options: EASING_OPTIONS },
  ],
  AudioAmplitudeFalloff: [
    { key: 'band', label: 'Band', type: 'enum', options: BAND_OPTIONS },
    { key: 'min_val', label: 'Min', type: 'number', step: 0.01 },
    { key: 'max_val', label: 'Max', type: 'number', step: 0.01 },
    { key: 'curve', label: 'Curve', type: 'enum', options: EASING_OPTIONS },
  ],

  // Modifiers
  Scale: [
    { key: 'x', label: 'Scale X', type: 'number', step: 0.1 },
    { key: 'y', label: 'Scale Y', type: 'number', step: 0.1 },
    { key: 'z', label: 'Scale Z', type: 'number', step: 0.1 },
  ],
  Rotate: [
    { key: 'angleX', label: 'Angle X (rad)', type: 'number', step: 0.1 },
    { key: 'angleY', label: 'Angle Y (rad)', type: 'number', step: 0.1 },
    { key: 'angleZ', label: 'Angle Z (rad)', type: 'number', step: 0.1 },
  ],
  Offset: [
    { key: 'x', label: 'Offset X', type: 'number', step: 0.1 },
    { key: 'y', label: 'Offset Y', type: 'number', step: 0.1 },
    { key: 'z', label: 'Offset Z', type: 'number', step: 0.1 },
  ],
  PhaseShift: [
    { key: 'shift', label: 'Shift', type: 'number', step: 0.05, min: 0, max: 1 },
  ],
  Mirror: [
    { key: 'plane', label: 'Mirror Plane', type: 'enum', options: PLANE_OPTIONS },
    { key: 'offset', label: 'Plane Offset', type: 'number', step: 0.1 },
  ],
  Clamp: [
    { key: 'min_x', label: 'Min X', type: 'number', step: 0.1 },
    { key: 'max_x', label: 'Max X', type: 'number', step: 0.1 },
    { key: 'min_y', label: 'Min Y', type: 'number', step: 0.1 },
    { key: 'max_y', label: 'Max Y', type: 'number', step: 0.1 },
    { key: 'min_z', label: 'Min Z', type: 'number', step: 0.1 },
    { key: 'max_z', label: 'Max Z', type: 'number', step: 0.1 },
  ],
  LFO: [
    { key: 'waveform', label: 'Waveform', type: 'enum', options: WAVEFORM_OPTIONS },
    { key: 'frequency', label: 'Frequency (Hz)', type: 'number', step: 0.1, min: 0.01 },
    { key: 'amplitude', label: 'Amplitude', type: 'number', step: 0.1 },
    { key: 'axis', label: 'Axis', type: 'enum', options: AXIS_ALL_OPTIONS },
    { key: 'phase', label: 'Phase (rad)', type: 'number', step: 0.1 },
  ],
  Jitter: [
    { key: 'intensity', label: 'Intensity', type: 'number', step: 0.05, min: 0 },
    { key: 'frequency', label: 'Frequency', type: 'number', step: 0.1, min: 0.1 },
    { key: 'seed', label: 'Seed', type: 'number', step: 1 },
  ],

  // Sources
  AudioSpectrum: [
    { key: 'band', label: 'Band', type: 'enum', options: BAND_OPTIONS },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
  ],
  OSCInput: [
    { key: 'address', label: 'OSC Address', type: 'text' },
    { key: 'radius', label: 'Radius', type: 'number', step: 0.1 },
  ],

  // Global (Post-process) nodes
  Input: [],
  RadiusScale: [
    { key: 'radius_scale', label: 'Radius Scale', type: 'number', step: 0.1, min: 0 },
  ],
  HeightOffset: [
    { key: 'height_offset', label: 'Height Offset', type: 'number', step: 0.1 },
  ],
  PerTrackDepth: [
    { key: 'depths', label: 'Depths (JSON array)', type: 'text' },
  ],
  Barycenter: [],
  AudioFalloff: [
    { key: 'amount', label: 'Amount', type: 'number', step: 0.1, min: 0 },
    { key: 'target', label: 'Target', type: 'enum', options: ['scale', 'height'] },
  ],
  ManualPosition: [],
  Zone: [
    { key: 'shape', label: 'Shape', type: 'enum', options: ZONE_SHAPE_OPTIONS },
    { key: 'center', label: 'Center (sphere)', type: 'vec3' },
    { key: 'radius', label: 'Radius (sphere)', type: 'number', step: 0.1, min: 0 },
    { key: 'min', label: 'Min corner (box)', type: 'vec3' },
    { key: 'max', label: 'Max corner (box)', type: 'vec3' },
    { key: 'falloff', label: 'Falloff', type: 'number', step: 0.1, min: 0 },
    { key: 'channels', label: 'Channels (gain=0,spread=1)', type: 'text' },
    { key: 'objects', label: 'Objects (0,2,4 — empty = all)', type: 'text' },
    { key: 'enabled', label: 'Enabled', type: 'boolean' },
  ],
  Velocity: [
    { key: 'source', label: 'Source', type: 'enum', options: KINEMATIC_SOURCE_OPTIONS },
    { key: 'channel', label: 'Channel', type: 'enum', options: SPATIAL_CHANNEL_OPTIONS },
    { key: 'scale', label: 'Scale', type: 'number', step: 0.01 },
    { key: 'offset', label: 'Offset', type: 'number', step: 0.01 },
    { key: 'min', label: 'Min (empty = −∞)', type: 'text' },
    { key: 'max', label: 'Max (empty = +∞)', type: 'text' },
    { key: 'object', label: 'Object (empty = all)', type: 'text' },
    { key: 'listener', label: 'Listener (angvel)', type: 'vec3' },
  ],
  MoveRef: [
    { key: 'move_id', label: 'Move ID', type: 'text' },
  ],
  Merge: [
    { key: 'strategy', label: 'Strategy', type: 'enum', options: ['override', 'crossfade', 'blend', 'priority'] },
    { key: 'fade_duration', label: 'Fade (s)', type: 'number', step: 0.1, min: 0 },
  ],
};

export const NODE_CATEGORIES: { label: string; color: string; types: NodeType[] }[] = [
  { label: 'Structural', color: 'gray', types: ['Objects', 'Duration', 'Output', 'Input'] },
  {
    label: 'Math Engines',
    color: 'blue',
    types: ['Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8', 'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum', 'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory'],
  },
  {
    label: 'Physics Engines',
    color: 'green',
    types: ['Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField'],
  },
  { label: 'Splines', color: 'cyan', types: ['DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline'] },
  { label: 'Falloffs', color: 'orange', types: ['TimeFalloff', 'PointDistanceFalloff', 'DirectionalFalloff', 'AudioAmplitudeFalloff'] },
  { label: 'Modifiers', color: 'pink', types: ['Scale', 'Rotate', 'Offset', 'PhaseShift', 'Mirror', 'Clamp', 'LFO', 'Jitter'] },
  { label: 'Global (Post-process)', color: 'cyan', types: ['RadiusScale', 'HeightOffset', 'PerTrackDepth', 'Barycenter', 'AudioFalloff', 'ManualPosition', 'Zone', 'Velocity', 'MoveRef', 'Merge'] },
  { label: 'Composite', color: 'purple', types: ['Mix', 'Group', 'Sequence', 'Crossfade'] },
  { label: 'Sources', color: 'yellow', types: ['BPM', 'AudioAmplitude', 'AudioSpectrum', 'OSCInput'] },
];

/// Catégories disponibles pour le graph global (post-processing).
/// Pas d'engines, pas de splines, pas de falloffs, pas d'Objects/Duration.
/// Le graph global démarre depuis Input (positions mergées) ou MoveRef/Merge.
export const GLOBAL_GRAPH_CATEGORIES: string[] = [
  'Global (Post-process)',
  'Composite',
  'Sources',
];

/// Catégories disponibles pour les sub-graphs (moves).
/// Pas de nodes global-only (Input, MoveRef, Merge, RadiusScale, etc.).
export const SUB_GRAPH_CATEGORIES: string[] = [
  'Structural',
  'Math Engines',
  'Physics Engines',
  'Splines',
  'Falloffs',
  'Modifiers',
  'Composite',
  'Sources',
];

/// Nodes exclus du sub-graph (global-only)
export const GLOBAL_ONLY_NODES: Set<NodeType> = new Set([
  'Input', 'MoveRef', 'Merge', 'RadiusScale', 'HeightOffset',
  'PerTrackDepth', 'Barycenter', 'AudioFalloff', 'ManualPosition',
  'Zone', 'Velocity',
]);

/// Nodes exclus du global graph (sub-graph-only)
/// Mirror de validator.rs::is_subgraph_only_node — le global graph est une
/// chaîne de post-processing (Input/MoveRef → transforms → Output) ; tout
/// node de mouvement/composite/structurel y échouerait au compile.
export const SUB_ONLY_NODES: Set<NodeType> = new Set([
  // Structurels
  'Objects', 'Duration',
  // Moteurs math
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge',
  'Pendulum', 'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  // Physics
  'Bouncing', 'Spring', 'Follow', 'Swarm', 'Avoidance', 'VectorField',
  // Splines
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  // Falloffs
  'TimeFalloff', 'PointDistanceFalloff', 'DirectionalFalloff', 'AudioAmplitudeFalloff',
  // Sources
  'BPM', 'AudioAmplitude', 'AudioSpectrum', 'OSCInput',
  // Modifiers sub-graph only (pas compilables en post-process)
  'PhaseShift', 'LFO', 'Jitter',
  // Composites binaires (le global graph est une chaîne linéaire)
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

export const NODE_COLORS: Record<string, string> = {
  gray: '#4b5563',
  blue: '#2563eb',
  green: '#16a34a',
  purple: '#9333ea',
  yellow: '#ca8a04',
  orange: '#ea580c',
  cyan: '#0891b2',
  pink: '#db2777',
};

export function getCategoryColor(type: NodeType): string {
  for (const cat of NODE_CATEGORIES) {
    if (cat.types.includes(type)) return NODE_COLORS[cat.color] ?? '#4b5563';
  }
  return '#4b5563';
}

export function getDefaultParams(type: NodeType): Record<string, any> {
  const schema = PARAM_SCHEMA[type];
  if (!schema) return {};
  const params: Record<string, any> = {};
  for (const def of schema) {
    switch (def.type) {
      case 'number':
        params[def.key] = def.min ?? 0;
        break;
      case 'boolean':
        params[def.key] = false;
        break;
      case 'enum':
        params[def.key] = def.options?.[0] ?? '';
        break;
      case 'vec3':
        params[def.key] = [0, 0, 0];
        break;
      case 'text':
        params[def.key] = '';
        break;
      case 'string':
        params[def.key] = '';
        break;
    }
  }
  // Apply known sensible defaults
  const defaults: Partial<Record<NodeType, Record<string, any>>> = {
    Objects: { n_objects: 9 },
    Duration: { duration: 4.0 },
    Output: { track_range: '0-' },
    Circular: { radius: 1.5, speed: 1.0, plane: 'xz', phase_offset: true },
    Spiral: { radius: 0.5, speed: 1.0, expansion: 1.0, plane: 'xz' },
    Lissajous: { a: 1.5, b: 1.5, delta: Math.PI / 2, scale: 1.0 },
    Figure8: { scale: 1.5, speed: 1.0, plane: 'xz' },
    Linear: { start: [-1, 0, 0], end: [1, 0, 0] },
    Oscillation: { amplitude: 1.5, frequency: 1.0, axis: 'y' },
    Formation: { shape: 'circle', radius: 0.7, rotate: 0, elevation: 0 },
    PerlinNoise: { intensity: 0.5, smoothness: 0.5, seed: 42 },
    Converge: { start_radius: 0.9, end_radius: 0.0, easing: 'linear' },
    Pendulum: { length: 0.8, gravity: 9.81, initial_angle: 0.5, damping: 0.05, phase_offset: true },
    Bouncing: { container: 'sphere', container_size: 0.9, restitution: 0.95, gravity: 0, seed: 42 },
    Avoidance: { repulsion_radius: 0.4, repulsion_strength: 2.0, damping: 0.95, container_size: 0.9, seed: 42 },
    Spring: { target: [0, 0, 0], stiffness: 3.0, damping_coef: 0.5, seed: 42 },
    Follow: { mode: 'follow', speed: 0.5, distance: 0.3, lookahead: 0.4, arrive_radius: 0.6,
      orbit_speed: 0.3, orbit_dir: 1, responsiveness: 1.0, target_radius: 0.5,
      target_speed: 1.0, target_z: 0, init_radius: 0.5, bounds: 1.0, containment: 1.0, seed: 42 },
    Swarm: { separation: 0.3, alignment: 0.5, cohesion: 0.3, max_speed: 0.5, seed: 42 },
    VectorField: { field: 'vortex', strength: 0.5, center: [0, 0, 0], radius: 0.6, swirl: 0,
      direction: [1, 0, 0], noise_scale: 1.5, wander: 0.1, responsiveness: 0.1,
      max_speed: 1.0, bounds: 1.0, containment: 0.5, init: 'circle', init_radius: 0.6,
      z_init: 0, z_drift: 0, points: '', idw_power: 2.0, seed: 42 },
    Velocity: { source: 'speed', channel: 'spread', scale: 0.1, offset: 0, min: '', max: '1', object: '', listener: [0, 0, 0] },
    CustomTrajectory: { coordinate_system: 'cartesian', equations: '0.5,0.3,0.0' },
    BPM: { bpm: 120, radius: 1.0, plane: 'xz' },
    AudioAmplitude: { amplitude: 0.5, radius: 1.0, band: 'rms', plane: 'xz' },
    TimeFalloff: { start_time: 0, end_time: 4.0, radius: 1.0, curve: 'linear', plane: 'xz' },
    PointDistanceFalloff: { center: [0, 0, 0], max_distance: 1.0, radius: 1.0, curve: 'linear', plane: 'xz' },
    Mix: { blend: 0.5 },
    Elliptical: { a: 0.8, b: 0.4, speed: 1.0, plane: 'xy', phase_offset: true },
    RoseCurve: { radius: 0.8, n_petals: 4, speed: 1.0, plane: 'xy', phase_offset: true },
    Helix: { radius: 0.7, height: 1.6, turns: 3.0, speed: 1.0, phase_offset: true },
    DrawSpline: { points: '[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]' },
    EvaluateSpline: { closed: false, tension: 0.5, speed: 1.0, phase_offset: true },
    TrimSpline: { points: '[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]', trim_start: 0.0, trim_end: 1.0, speed: 1.0, phase_offset: true },
    OffsetSpline: { points: '[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]', offset_x: 0, offset_y: 0, offset_z: 0, speed: 1.0, phase_offset: true },
    DirectionalFalloff: { direction: [0, 0, 1], max_distance: 1.0, curve: 'linear' },
    AudioAmplitudeFalloff: { band: 'rms', min_val: 0, max_val: 1, curve: 'linear' },
    Scale: { x: 1, y: 1, z: 1 },
    Rotate: { angleX: 0, angleY: 0, angleZ: 0 },
    Offset: { x: 0, y: 0, z: 0 },
    PhaseShift: { shift: 0.1 },
    AudioSpectrum: { band: 'bass', radius: 1.0 },
    OSCInput: { address: '/track/1/xyz', radius: 1.0 },
    Wave: { amplitude: 1.0, frequency: 1.0, speed: 1.0, axis: 'y', spread: 4.0, phase_offset: true },
    Crossfade: { fade_duration: 1.0 },
    Mirror: { plane: 'xz', offset: 0.0 },
    Clamp: { min_x: -5, max_x: 5, min_y: -5, max_y: 5, min_z: -5, max_z: 5 },
    LFO: { waveform: 'sine', frequency: 0.5, amplitude: 0.3, axis: 'y', phase: 0 },
    Jitter: { intensity: 0.2, frequency: 2.0, seed: 42 },
    // Global (Post-process) nodes
    Input: {},
    RadiusScale: { radius_scale: 1.0 },
    HeightOffset: { height_offset: 0.0 },
    PerTrackDepth: { depths: [] },
    Barycenter: {},
    AudioFalloff: { amount: 1.0, target: 'scale' },
    ManualPosition: {},
    Zone: { shape: 'sphere', center: [0, 0, 0], radius: 2.0, min: [-1, -1, -1], max: [1, 1, 1], falloff: 0.5, channels: 'gain=0', objects: '', enabled: true },

    MoveRef: { move_id: '' },
    Merge: { strategy: 'override', fade_duration: 0.5 },
  };
  return { ...params, ...(defaults[type] ?? {}) };
}

/**
 * Descriptions courtes pour chaque node — affichées dans la palette et au hover
 */
export const NODE_DESCRIPTIONS: Partial<Record<NodeType, string>> = {
  // Structural
  Objects: "Définit le nombre d'objets/tracks et leurs IDs. Obligatoire — source du graphe",
  Duration: "Définit la durée d'un cycle en secondes. Obligatoire — synchronise les engines",
  Output: "Terminal du graphe — envoie les positions via OSC aux tracks. Obligatoire",
  Group: "Partitionne N objets en 2 groupes : A→[0..n/2], B→[n/2..n]. Pour affecter des tracks différentes",
  Mix: "Blend linéaire entre 2 trajectoires (0=A, 1=B). Pour fondre 2 mouvements",
  Sequence: "Enchaîne 2 trajectoires temporellement : A pendant sa durée, puis B. Coupe net",
  Crossfade: "Enchaîne A→B avec un fondu (crossfade). Plus fluide que Sequence",
  // Math Engines
  Circular: "Mouvement circulaire — radius, speed, plane. Le plus utilisé",
  Elliptical: "Ellipse avec axes indépendants (a≠b). Pour orbites aplatis",
  Spiral: "Spirale qui expande/contracte avec le temps",
  Lissajous: "Courbes harmoniques complexes (a, b, delta). Figures décoratives",
  Figure8: "Lemniscate — figure 8 horizontale",
  Linear: "Interpolation linéaire entre 2 points (start→end)",
  Oscillation: "Sinusoïde sur un axe (x/y/z). Pour vibrations",
  Formation: "Formations statiques : cercle, ligne, arc, grille. Sans mouvement",
  PerlinNoise: "Bruit de Perlin — mouvement organique aléatoire smooth",
  Converge: "Convergence radiale vers le centre avec easing",
  Pendulum: "Pendule physique amorti (length, gravity, damping)",
  RoseCurve: "Rose polaire r=cos(kθ) — fleurs à n_pétals",
  Helix: "Hélice 3D — radius, height, turns. Pour montées/descentes",
  Wave: "Onde voyageante across les objets (stadium wave). Chaque objet oscille avec un délai",
  CustomTrajectory: "Équations custom x,y,z (cartesian/polar/spherical). Pour trajectoires sur-mesure",
  // Physics
  Bouncing: "Rebonds physiques dans un container (sphere/box) avec restitution",
  Avoidance: "Répulsion entre objets — évitement mutuel",
  Spring: "Ressort vers un point target (stiffness, damping)",
  Follow: "Steering : follow/pursue/evade/orbit/arrive autour d'une cible mobile (lookahead, anneau, décélération)",
  Swarm: "Boids — flocking avec separation/alignment/cohesion",
  VectorField: "Champ de vecteurs (vortex/sink/source/flow/noise) — objets advectés, steering inertiel, mouvement perpétuel organique",
  // Splines
  DrawSpline: "Spline Catmull-Rom depuis des points de contrôle JSON. Source — pas d'input",
  EvaluateSpline: "Évaluation arc-length uniforme d'une spline (vitesse constante)",
  TrimSpline: "Extrait un segment de spline (trim_start → trim_end, 0-1)",
  OffsetSpline: "Spline avec offset spatial (x,y,z)",
  // Falloffs
  TimeFalloff: "Enveloppe temporelle — influence qui varie avec le temps (start→end)",
  PointDistanceFalloff: "Influence basée sur la distance à un point (center, max_distance)",
  DirectionalFalloff: "Influence directionnelle — cone dans une direction",
  AudioAmplitudeFalloff: "Modulation par amplitude audio (band, min, max)",
  // Modifiers
  Scale: "Multiplie les positions par (x, y, z). Pour redimensionner",
  Rotate: "Rotation autour des axes (angleX, angleY, angleZ en radians)",
  Offset: "Translation (x, y, z). Pour décaler un mouvement",
  PhaseShift: "Décalage temporel par objet — chaque objet est en retard sur le précédent",
  Mirror: "Réfléchit les positions across un plan (xy/xz/yz). Pour setups symétriques",
  Clamp: "Constrain les positions dans une bounding box. Safety pour ne pas sortir du venue",
  LFO: "Ajoute une oscillation (sine/triangle/square/saw) à un axe. Effet de respiration",
  Jitter: "Ajoute du bruit organique smooth. Rend un mouvement moins mécanique",
  // Sources
  BPM: "Mouvement circulaire synchronisé au BPM détecté",
  AudioAmplitude: "Amplitude audio module le radius d'un cercle",
  AudioSpectrum: "Bande FFT du spectre audio → position",
  OSCInput: "Reçoit une valeur OSC (scalar→angle, array→XYZ) et la convertit en position",
  // Global (Post-process)
  Input: "Point d'entrée du graph global — représente les positions mergées de tous les moves",
  RadiusScale: "Scaling radial par rapport à l'origin (radius_scale). Global — appliqué après merge",
  HeightOffset: "Offset vertical post-merge (height_offset). Pour ajuster la hauteur globale",
  PerTrackDepth: "Profondeur par track — interpoler entre origin et position. Pour depth mapping",
  Barycenter: "Calcule l'origin depuis les positions des tracks .hol. Centre du groupe",
  AudioFalloff: "Module un paramètre (scale/height) par l'amplitude audio. Pour réactivité musicale",
  ManualPosition: "Override manuel de positions — lit les drag 3D. Pour positionnement à la main",
  Zone: "Région spatiale (sphere/box) qui tire les canaux des objets vers des valeurs cibles — gain/spread/etc. varient avec la position. Pass-through : ne modifie pas les positions",
  Velocity: "Modulation cinématique — speed/accel/jerk/angvel d'un objet → canal spatial. angvel = vitesse angulaire °/s autour du listener (borne perceptuelle). Pass-through : ne modifie pas les positions",
  MoveRef: "Référence un sub-graph (move) par ID. Source — produit les positions du move référencé. Double-clic pour éditer le sub-graph",
  Merge: "Node Merge — représente le MergeRuntime. Produit les positions mergées de tous les moves actifs. Strategy: override/crossfade/blend/priority",
};

/**
 * Retourne les types de nodes valides comme cible depuis un type source donné.
 * Utilisé pour le highlight visuel des connexions possibles au drag.
 */
export function getValidTargetTypes(from: NodeType): NodeType[] {
  const allTypes: NodeType[] = NODE_CATEGORIES.flatMap((c) => c.types);
  return allTypes.filter((to) => to !== from && isValidConnectionExported(from, to));
}

/**
 * Fusionne les params par défaut avec les params actuels d'un node.
 * Garantit que tous les params du schema sont présents, même si non-modifiés.
 * Utilisé avant la sauvegarde d'un cue pour éviter les valeurs manquantes.
 */
export function mergeDefaultParams(type: NodeType, currentParams: Record<string, any>): Record<string, any> {
  const defaults = getDefaultParams(type);
  return { ...defaults, ...currentParams };
}

/**
 * Prépare un graphe (nodes + edges) pour la sauvegarde :
 * fusionne les params par défaut dans chaque node.
 */
export function prepareGraphForSave(nodes: any[], edges: any[]) {
  return {
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        params: mergeDefaultParams(n.data?.type, n.data?.params ?? {}),
      },
    })),
    edges: [...edges],
  };
}
