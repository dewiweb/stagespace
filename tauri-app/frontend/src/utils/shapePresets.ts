import type { Node, Edge } from 'reactflow';
import { MarkerType } from 'reactflow';

export interface ShapePreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'basic' | 'modifier' | 'composite' | 'spline' | 'physics' | 'audio';
  build: (nObjects: number) => { nodes: Node[]; edges: Edge[] };
}

let idCounter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now()}-${idCounter++}`;

const makeNode = (
  type: string,
  position: { x: number; y: number },
  params: Record<string, any> = {},
): Node => ({
  id: uid(type),
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const makeEdge = (from: string, to: string, fromPort = 'output', toPort = 'input'): Edge => ({
  id: `e-${from}-${to}-${fromPort}-${toPort}`,
  source: from,
  target: to,
  sourceHandle: fromPort,
  targetHandle: toPort,
  markerEnd: { type: MarkerType.ArrowClosed },
});

// ─── Helpers pour les patterns courants ───

const baseFlow = (
  engineType: string,
  engineParams: Record<string, any>,
  nObjects: number,
  duration: number = 4.0,
  extraNodes: { type: string; position: { x: number; y: number }; params?: Record<string, any> }[] = [],
  extraEdges: { from: string; to: string; fromPort?: string; toPort?: string }[] = [],
): { nodes: Node[]; edges: Edge[] } => {
  const objects = makeNode('Objects', { x: 50, y: 250 }, { n_objects: nObjects });
  const durationNode = makeNode('Duration', { x: 50, y: 80 }, { duration });
  const engine = makeNode(engineType, { x: 300, y: 180 }, engineParams);
  const output = makeNode('Output', { x: 750, y: 180 });

  const nodes = [objects, durationNode, engine, output];
  const edges = [
    makeEdge(objects.id, engine.id, 'output', 'input'),
    makeEdge(durationNode.id, engine.id, 'output', 'duration'),
  ];

  // Insert extra nodes between engine and output
  let prevId = engine.id;
  const spacing = 180;
  extraNodes.forEach((extra, i) => {
    const node = makeNode(extra.type, { x: 480 + i * spacing, y: 180 }, extra.params ?? {});
    nodes.push(node);
    edges.push(makeEdge(prevId, node.id, 'output', 'input'));
    prevId = node.id;
  });
  edges.push(makeEdge(prevId, output.id, 'output', 'input'));

  // Add extra edges (e.g. for composites)
  extraEdges.forEach((e) => {
    edges.push(makeEdge(e.from, e.to, e.fromPort ?? 'output', e.toPort ?? 'input'));
  });

  return { nodes, edges };
};

const binaryComposite = (
  compositeType: string,
  compositeParams: Record<string, any>,
  engineAType: string,
  engineAParams: Record<string, any>,
  engineBType: string,
  engineBParams: Record<string, any>,
  nObjects: number,
  duration: number = 4.0,
): { nodes: Node[]; edges: Edge[] } => {
  const objects = makeNode('Objects', { x: 50, y: 300 }, { n_objects: nObjects });
  const durationNode = makeNode('Duration', { x: 50, y: 120 }, { duration });
  const engineA = makeNode(engineAType, { x: 300, y: 80 }, engineAParams);
  const engineB = makeNode(engineBType, { x: 300, y: 320 }, engineBParams);
  const composite = makeNode(compositeType, { x: 580, y: 200 }, compositeParams);
  const output = makeNode('Output', { x: 820, y: 200 });

  return {
    nodes: [objects, durationNode, engineA, engineB, composite, output],
    edges: [
      makeEdge(objects.id, engineA.id, 'output', 'input'),
      makeEdge(objects.id, engineB.id, 'output', 'input'),
      makeEdge(durationNode.id, engineA.id, 'output', 'duration'),
      makeEdge(durationNode.id, engineB.id, 'output', 'duration'),
      makeEdge(engineA.id, composite.id, 'output', 'input_a'),
      makeEdge(engineB.id, composite.id, 'output', 'input_b'),
      makeEdge(composite.id, output.id, 'output', 'input'),
    ],
  };
};

// ─── PRESETS ───

export const SHAPE_PRESETS: ShapePreset[] = [

  // ═══════════════ BASIC ═══════════════

  {
    id: 'circle',
    name: 'Circle',
    icon: '◯',
    description: 'Circular orbit around center',
    category: 'basic',
    build: (n) => baseFlow('Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true }, n),
  },
  {
    id: 'elliptical',
    name: 'Ellipse',
    icon: '⬭',
    description: 'Elliptical orbit with independent axes',
    category: 'basic',
    build: (n) => baseFlow('Elliptical', { n_objects: n, a: 3.0, b: 1.5, speed: 1.0, plane: 'xz', phase_offset: true }, n),
  },
  {
    id: 'spiral',
    name: 'Spiral',
    icon: '🌀',
    description: 'Spiral that expands/contracts over time',
    category: 'basic',
    build: (n) => baseFlow('Spiral', { n_objects: n, radius: 0.5, speed: 1.0, expansion: 1.0, plane: 'xz', phase_offset: true }, n, 6.0),
  },
  {
    id: 'figure8',
    name: 'Figure 8',
    icon: '∞',
    description: 'Lemniscate / figure-8 pattern',
    category: 'basic',
    build: (n) => baseFlow('Figure8', { n_objects: n, scale: 2.5, speed: 1.0, plane: 'xz', phase_offset: true }, n),
  },
  {
    id: 'lissajous',
    name: 'Lissajous',
    icon: '✦',
    description: 'Lissajous curve (3:2 harmonic ratio)',
    category: 'basic',
    build: (n) => baseFlow('Lissajous', { n_objects: n, a: 3.0, b: 2.0, delta: 1.5708, scale: 2.0, phase_offset: true }, n, 8.0),
  },
  {
    id: 'helix',
    name: 'Helix',
    icon: '🧬',
    description: '3D helix with vertical movement',
    category: 'basic',
    build: (n) => baseFlow('Helix', { n_objects: n, radius: 2.0, height: 3.0, turns: 2.0, speed: 1.0, phase_offset: true }, n, 6.0),
  },
  {
    id: 'rose',
    name: 'Rose',
    icon: '✿',
    description: 'Rose curve with 4 petals',
    category: 'basic',
    build: (n) => baseFlow('RoseCurve', { n_objects: n, radius: 2.5, n_petals: 4, speed: 1.0, plane: 'xy', phase_offset: true }, n, 8.0),
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: '─',
    description: 'Linear interpolation back-and-forth',
    category: 'basic',
    build: (n) => baseFlow('Linear', { n_objects: n, start: [-2.5, 0, 0], end: [2.5, 0, 0] }, n),
  },
  {
    id: 'wave',
    name: 'Wave',
    icon: '〰',
    description: 'Traveling wave across objects (stadium wave)',
    category: 'basic',
    build: (n) => baseFlow('Wave', { n_objects: n, amplitude: 1.5, frequency: 1.0, speed: 1.0, axis: 'y', spread: 4.0, phase_offset: true }, n, 4.0),
  },
  {
    id: 'oscillation',
    name: 'Oscillation',
    icon: '∿',
    description: 'Sinusoidal sway on one axis — gentle periodic breathing',
    category: 'basic',
    build: (n) => baseFlow('Oscillation', { n_objects: n, amplitude: 1.5, frequency: 1.0, axis: 'y', phase_offset: true }, n),
  },
  {
    id: 'pendulum',
    name: 'Pendulum',
    icon: '◠',
    description: 'Gravity swing with damping — natural decelerating arc',
    category: 'basic',
    build: (n) => baseFlow('Pendulum', { n_objects: n, length: 2.0, gravity: 9.81, initial_angle: 0.7, damping: 0.03, phase_offset: true }, n, 6.0),
  },
  {
    id: 'perlin',
    name: 'Perlin Drift',
    icon: '≈',
    description: 'Perlin noise wander — organic non-repeating drift',
    category: 'basic',
    build: (n) => baseFlow('PerlinNoise', { n_objects: n, intensity: 1.2, smoothness: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'formation',
    name: 'Formation',
    icon: '▦',
    description: 'Static grid formation with slow rotation — held positions',
    category: 'basic',
    build: (n) => baseFlow('Formation', { n_objects: n, shape: 'grid', radius: 2.0, rotate: 0.15, elevation: 0.0 }, n),
  },
  {
    id: 'orbit-fade-in',
    name: 'Orbit Fade-In',
    icon: '◎',
    description: 'Orbit radius grows from center over time — eased intro effect',
    category: 'basic',
    build: (n) => baseFlow('TimeFalloff', { start_time: 0.0, end_time: 2.5, radius: 2.5, curve: 'ease_out', plane: 'xz' }, n, 6.0),
  },
  {
    id: 'gravity-well',
    name: 'Gravity Well',
    icon: '◉',
    description: 'Eccentric orbit — collapses toward origin opposite the attractor point',
    category: 'basic',
    build: (n) => baseFlow('PointDistanceFalloff', { center: [2.0, 0, 0], max_distance: 4.0, radius: 2.0, curve: 'ease_in_out', plane: 'xz' }, n, 5.0),
  },

  // ═══════════════ MODIFIERS ═══════════════

  {
    id: 'circle-rotate',
    name: 'Circle + Rotate',
    icon: '↻',
    description: 'Circle with rotation modifier — tilted orbit',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'Rotate', position: { x: 480, y: 180 }, params: { angleX: 0.5, angleY: 0, angleZ: 0.3 } }],
    ),
  },
  {
    id: 'circle-offset',
    name: 'Circle + Offset',
    icon: '⇄',
    description: 'Circle shifted in space — off-center orbit',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 1.5, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'Offset', position: { x: 480, y: 180 }, params: { x: 2.0, y: 0, z: 1.0 } }],
    ),
  },
  {
    id: 'circle-scale',
    name: 'Circle + Scale',
    icon: '⤢',
    description: 'Circle scaled non-uniformly — stretched orbit',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 1.5, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'Scale', position: { x: 480, y: 180 }, params: { x: 1.5, y: 1.0, z: 0.5 } }],
    ),
  },
  {
    id: 'circle-lfo',
    name: 'Circle + LFO',
    icon: '∿',
    description: 'Circle with LFO breathing effect on Y axis',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'LFO', position: { x: 480, y: 180 }, params: { waveform: 'sine', frequency: 0.5, amplitude: 0.8, axis: 'y', phase: 0 } }],
    ),
  },
  {
    id: 'circle-mirror',
    name: 'Circle + Mirror',
    icon: '⇋',
    description: 'Circle mirrored across XZ plane — symmetrical Y',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xy', phase_offset: true }, n, 4.0,
      [{ type: 'Mirror', position: { x: 480, y: 180 }, params: { plane: 'xz', offset: 0.0 } }],
    ),
  },
  {
    id: 'circle-phaseshift',
    name: 'Circle + PhaseShift',
    icon: '⇶',
    description: 'Circle with phase shift — wave-like cascade between objects',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: false }, n, 4.0,
      [{ type: 'PhaseShift', position: { x: 480, y: 180 }, params: { shift: 0.1 } }],
    ),
  },
  {
    id: 'circle-jitter',
    name: 'Circle + Jitter',
    icon: '✲',
    description: 'Circle with organic noise — less mechanical movement',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'Jitter', position: { x: 480, y: 180 }, params: { intensity: 0.3, frequency: 2.0, seed: 42 } }],
    ),
  },
  {
    id: 'circle-clamp',
    name: 'Circle + Clamp',
    icon: '⬚',
    description: 'Circle constrained to a bounding box — safety for venue limits',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 3.0, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [{ type: 'Clamp', position: { x: 480, y: 180 }, params: { min_x: -2, max_x: 2, min_y: -2, max_y: 2, min_z: -2, max_z: 2 } }],
    ),
  },
  {
    id: 'modifier-chain',
    name: 'Modifier Chain',
    icon: '🔗',
    description: 'Circle → Rotate → Offset → Output — chained modifiers',
    category: 'modifier',
    build: (n) => baseFlow('Circular',
      { n_objects: n, radius: 1.5, speed: 1.0, plane: 'xz', phase_offset: true }, n, 4.0,
      [
        { type: 'Rotate', position: { x: 480, y: 180 }, params: { angleX: 0.3, angleY: 0, angleZ: 0.2 } },
        { type: 'Offset', position: { x: 660, y: 180 }, params: { x: 1.5, y: 0.5, z: 0 } },
      ],
    ),
  },
  {
    id: 'side-sweep',
    name: 'Side Sweep',
    icon: '◐',
    description: 'One-sided motion — objects on the +X side animate, others hold; tilted',
    category: 'modifier',
    build: (n) => baseFlow('DirectionalFalloff',
      { direction: [1, 0, 0], max_distance: 3.0, radius: 2.0, curve: 'ease_in_out', plane: 'xz' }, n, 4.0,
      [{ type: 'Rotate', position: { x: 480, y: 180 }, params: { angleX: 0, angleY: 0, angleZ: 0.35 } }],
    ),
  },

  // ═══════════════ COMPOSITES ═══════════════

  {
    id: 'mix-circle-figure8',
    name: 'Mix: Circle + Fig8',
    icon: '⊕',
    description: 'Blend circle and figure-8 with Mix node (50% each)',
    category: 'composite',
    build: (n) => binaryComposite('Mix', { blend: 0.5 },
      'Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Figure8', { n_objects: n, scale: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      n, 4.0,
    ),
  },
  {
    id: 'mix-circle-spiral',
    name: 'Mix: Circle + Spiral',
    icon: '⊕',
    description: 'Blend circle and spiral — orbit that breathes',
    category: 'composite',
    build: (n) => binaryComposite('Mix', { blend: 0.3 },
      'Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Spiral', { n_objects: n, radius: 0.5, speed: 1.0, expansion: 1.0, plane: 'xz', phase_offset: true },
      n, 6.0,
    ),
  },
  {
    id: 'sequence-circle-spiral',
    name: 'Sequence: Circle→Spiral',
    icon: '→',
    description: 'Circle for 4s, then spiral — temporal chaining (hard cut)',
    category: 'composite',
    build: (n) => binaryComposite('Sequence', {},
      'Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Spiral', { n_objects: n, radius: 0.5, speed: 1.0, expansion: 1.0, plane: 'xz', phase_offset: true },
      n, 4.0,
    ),
  },
  {
    id: 'crossfade-circle-spiral',
    name: 'Crossfade: Circle⇄Spiral',
    icon: '⇆',
    description: 'Circle then spiral with 1s smooth crossfade transition',
    category: 'composite',
    build: (n) => binaryComposite('Crossfade', { fade_duration: 1.0 },
      'Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Spiral', { n_objects: n, radius: 0.5, speed: 1.0, expansion: 1.0, plane: 'xz', phase_offset: true },
      n, 4.0,
    ),
  },
  {
    id: 'group-circle-linear',
    name: 'Group: Circle + Linear',
    icon: '⊞',
    description: 'First half on circle, second half on linear — partition tracks',
    category: 'composite',
    build: (n) => binaryComposite('Group', {},
      'Circular', { n_objects: Math.ceil(n / 2), radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Linear', { n_objects: Math.floor(n / 2), start: [-2, 0, 0], end: [2, 0, 0] },
      n, 4.0,
    ),
  },
  {
    id: 'mix-order-chaos',
    name: 'Mix: Order + Chaos',
    icon: '⊕',
    description: 'Blend a stable orbit with flocking — controlled disorder (70% circle)',
    category: 'composite',
    build: (n) => binaryComposite('Mix', { blend: 0.7 },
      'Circular', { n_objects: n, radius: 2.0, speed: 1.0, plane: 'xz', phase_offset: true },
      'Swarm', { n_objects: n, separation: 0.3, alignment: 0.5, cohesion: 0.3, max_speed: 0.4, seed: 42 },
      n, 8.0,
    ),
  },
  {
    id: 'crossfade-pursuit-orbit',
    name: 'Crossfade: Pursuit⇄Orbit',
    icon: '⇆',
    description: 'Chase then settle into circling — pursuit crossfades to orbit',
    category: 'composite',
    build: (n) => binaryComposite('Crossfade', { fade_duration: 1.5 },
      'Follow', { n_objects: n, mode: 'pursue', speed: 1.5, distance: 0.4, lookahead: 0.5, responsiveness: 0.12,
        target_radius: 1.5, target_speed: 0.5, init_radius: 1.0, bounds: 3.0, containment: 0.5, seed: 42 },
      'Follow', { n_objects: n, mode: 'orbit', speed: 1.2, distance: 1.5, orbit_speed: 0.6, orbit_dir: 1, responsiveness: 0.15,
        target_radius: 1.2, target_speed: 0.5, init_radius: 0.8, bounds: 3.0, containment: 0.5, seed: 42 },
      n, 8.0,
    ),
  },

  // ═══════════════ SPLINES ═══════════════

  {
    id: 'spline-evaluate',
    name: 'Spline Path',
    icon: ' spline',
    description: 'Objects follow a Catmull-Rom spline through control points',
    category: 'spline',
    build: (n) => {
      const objects = makeNode('Objects', { x: 50, y: 250 }, { n_objects: n });
      const duration = makeNode('Duration', { x: 50, y: 80 }, { duration: 6.0 });
      const drawSpline = makeNode('DrawSpline', { x: 300, y: 50 }, {
        n_objects: n,
        points: '[[-2,0,0],[-1,1,0],[0,0.5,0],[1,1,0],[2,0,0]]',
      });
      const evalSpline = makeNode('EvaluateSpline', { x: 550, y: 180 }, {
        n_objects: n,
        closed: false,
        tension: 0.5,
        speed: 1.0,
        phase_offset: true,
      });
      const output = makeNode('Output', { x: 800, y: 180 });
      return {
        nodes: [objects, duration, drawSpline, evalSpline, output],
        edges: [
          makeEdge(objects.id, evalSpline.id, 'output', 'input'),
          makeEdge(duration.id, evalSpline.id, 'output', 'duration'),
          makeEdge(drawSpline.id, evalSpline.id, 'output', 'spline'),
          makeEdge(evalSpline.id, output.id, 'output', 'input'),
        ],
      };
    },
  },
  {
    id: 'spline-trim',
    name: 'Spline Trim',
    icon: '✂',
    description: 'Follow only a section of the drawn path (15%–85%)',
    category: 'spline',
    build: (n) => {
      const objects = makeNode('Objects', { x: 50, y: 250 }, { n_objects: n });
      const duration = makeNode('Duration', { x: 50, y: 80 }, { duration: 6.0 });
      const drawSpline = makeNode('DrawSpline', { x: 300, y: 50 }, {
        n_objects: n,
        points: '[[-2,0,0],[-1,1,0],[0,0.5,0],[1,1,0],[2,0,0]]',
      });
      const trimSpline = makeNode('TrimSpline', { x: 550, y: 180 }, {
        n_objects: n,
        trim_start: 0.15,
        trim_end: 0.85,
        speed: 1.0,
        phase_offset: true,
      });
      const output = makeNode('Output', { x: 800, y: 180 });
      return {
        nodes: [objects, duration, drawSpline, trimSpline, output],
        edges: [
          makeEdge(objects.id, trimSpline.id, 'output', 'input'),
          makeEdge(duration.id, trimSpline.id, 'output', 'duration'),
          makeEdge(drawSpline.id, trimSpline.id, 'output', 'spline'),
          makeEdge(trimSpline.id, output.id, 'output', 'input'),
        ],
      };
    },
  },
  {
    id: 'spline-offset',
    name: 'Spline Offset',
    icon: '⧉',
    description: 'Drawn path shifted in space — parallel trajectory',
    category: 'spline',
    build: (n) => {
      const objects = makeNode('Objects', { x: 50, y: 250 }, { n_objects: n });
      const duration = makeNode('Duration', { x: 50, y: 80 }, { duration: 6.0 });
      const drawSpline = makeNode('DrawSpline', { x: 300, y: 50 }, {
        n_objects: n,
        points: '[[-2,0,0],[-1,1,0],[0,0.5,0],[1,1,0],[2,0,0]]',
      });
      const offsetSpline = makeNode('OffsetSpline', { x: 550, y: 180 }, {
        n_objects: n,
        offset_x: 0.0,
        offset_y: 0.8,
        offset_z: 0.0,
        speed: 1.0,
        phase_offset: true,
      });
      const output = makeNode('Output', { x: 800, y: 180 });
      return {
        nodes: [objects, duration, drawSpline, offsetSpline, output],
        edges: [
          makeEdge(objects.id, offsetSpline.id, 'output', 'input'),
          makeEdge(duration.id, offsetSpline.id, 'output', 'duration'),
          makeEdge(drawSpline.id, offsetSpline.id, 'output', 'spline'),
          makeEdge(offsetSpline.id, output.id, 'output', 'input'),
        ],
      };
    },
  },

  // ═══════════════ PHYSICS ═══════════════

  {
    id: 'swarm',
    name: 'Swarm',
    icon: '🐦',
    description: 'Boids flocking — separation, alignment, cohesion',
    category: 'physics',
    build: (n) => baseFlow('Swarm',
      { n_objects: n, separation: 0.3, alignment: 0.5, cohesion: 0.3, max_speed: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'bouncing',
    name: 'Bouncing',
    icon: '⚽',
    description: 'Bouncing objects in a spherical container',
    category: 'physics',
    build: (n) => baseFlow('Bouncing',
      { n_objects: n, container: 'sphere', container_size: 2.5, restitution: 0.95, gravity: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'spring',
    name: 'Spring',
    icon: '🌀',
    description: 'Spring physics pulling objects toward a target point',
    category: 'physics',
    build: (n) => baseFlow('Spring',
      { n_objects: n, target: [0, 1, 0], stiffness: 3.0, damping_coef: 0.5, seed: 42 }, n, 6.0),
  },
  {
    id: 'vectorfield',
    name: 'Vector Field',
    icon: '〰',
    description: 'Objects advected by a procedural vector field (vortex/sink/flow/noise) — perpetual organic drift',
    category: 'physics',
    build: (n) => baseFlow('VectorField',
      { n_objects: n, field: 'vortex', strength: 0.5, center: [0, 0, 0], radius: 0.6,
        swirl: 0, direction: [1, 0, 0], noise_scale: 1.5, wander: 0.15,
        responsiveness: 0.08, max_speed: 1.0, bounds: 2.5, containment: 0.5,
        init: 'circle', init_radius: 1.2, z_init: 0, z_drift: 0, seed: 42 }, n, 8.0),
  },
  {
    id: 'converge',
    name: 'Converge',
    icon: '⊙',
    description: 'Objects converge from outer radius to center with easing',
    category: 'physics',
    build: (n) => baseFlow('Converge',
      { n_objects: n, start_radius: 3.0, end_radius: 0.5, easing: 'ease_in_out' }, n, 4.0),
  },
  {
    id: 'orbit-target',
    name: 'Orbit Target',
    icon: '🛰',
    description: 'Objects orbit a roaming target — satellite ring chasing a leader',
    category: 'physics',
    build: (n) => baseFlow('Follow',
      { n_objects: n, mode: 'orbit', speed: 1.2, distance: 1.5, orbit_speed: 0.6, orbit_dir: 1,
        responsiveness: 0.15, target_radius: 1.2, target_speed: 0.5, target_z: 0,
        init_radius: 0.8, bounds: 3.0, containment: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'pursuit',
    name: 'Pursuit',
    icon: '🎯',
    description: 'Pack chases a moving target with anticipation (lookahead)',
    category: 'physics',
    build: (n) => baseFlow('Follow',
      { n_objects: n, mode: 'pursue', speed: 1.5, distance: 0.4, lookahead: 0.5,
        responsiveness: 0.12, target_radius: 1.5, target_speed: 0.5, target_z: 0,
        init_radius: 1.0, bounds: 3.0, containment: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'evade',
    name: 'Evade',
    icon: '💨',
    description: 'Objects flee a roaming target inside bounds — scatter and regroup',
    category: 'physics',
    build: (n) => baseFlow('Follow',
      { n_objects: n, mode: 'evade', speed: 1.4, distance: 0.3, lookahead: 0.4,
        responsiveness: 0.15, target_radius: 1.5, target_speed: 0.4, target_z: 0,
        init_radius: 1.0, bounds: 2.5, containment: 0.6, seed: 42 }, n, 8.0),
  },
  {
    id: 'arrive',
    name: 'Arrive',
    icon: '📍',
    description: 'Glide to the target and settle — soft landing, no overshoot',
    category: 'physics',
    build: (n) => baseFlow('Follow',
      { n_objects: n, mode: 'arrive', speed: 1.8, distance: 0.25, arrive_radius: 0.8,
        responsiveness: 0.12, target_radius: 1.5, target_speed: 0.4, target_z: 0,
        init_radius: 1.2, bounds: 3.0, containment: 0.5, seed: 42 }, n, 8.0),
  },
  {
    id: 'avoidance',
    name: 'Avoidance',
    icon: '🧲',
    description: 'Mutual repulsion inside a container — self-organizing spread',
    category: 'physics',
    build: (n) => baseFlow('Avoidance',
      { n_objects: n, repulsion_radius: 0.6, repulsion_strength: 1.5, damping: 0.9,
        container_size: 2.0, seed: 42 }, n, 8.0),
  },

  // ═══════════════ AUDIO ═══════════════

  {
    id: 'bpm-circle',
    name: 'BPM Sync',
    icon: '🎵',
    description: 'Circle synchronized to detected BPM',
    category: 'audio',
    build: (n) => baseFlow('BPM',
      { n_objects: n, bpm: 120, radius: 2.0, plane: 'xz' }, n, 4.0),
  },
  {
    id: 'audio-amplitude',
    name: 'Audio Reactive',
    icon: '🔊',
    description: 'Circle whose radius reacts to audio amplitude',
    category: 'audio',
    build: (n) => baseFlow('AudioAmplitude',
      { n_objects: n, amplitude: 0.5, radius: 1.5, band: 'rms', plane: 'xz' }, n, 4.0),
  },
  {
    id: 'bass-pulse',
    name: 'Bass Pulse',
    icon: '💓',
    description: 'Orbit radius breathes with the bass band — tilted audio-driven pulse',
    category: 'audio',
    build: (n) => baseFlow('AudioAmplitudeFalloff',
      { band: 'bass', min_val: 0.15, max_val: 1.0, curve: 'ease_out', radius: 2.5, plane: 'xz' }, n, 4.0,
      [{ type: 'Rotate', position: { x: 480, y: 180 }, params: { angleX: 0.25, angleY: 0, angleZ: 0 } }],
    ),
  },
];
