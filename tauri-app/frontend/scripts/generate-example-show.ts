/**
 * Génère examples/full-feature-show.hfg — un show .hfg v2 complet qui
 * exerce l'ensemble des features : slots multi-engines, setlist, cues,
 * graphe global (Zone/Velocity), Spatial FX manuels, tracks manuelles,
 * mappings OSC IN et macros.
 *
 * Usage : npx vite-node scripts/generate-example-show.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE_PRESETS } from '../src/utils/shapePresets';
import { isValidConnection, getInputPorts } from '../src/utils/connectionRules';
import type { Node, Edge } from 'reactflow';

const OUT = fileURLToPath(new URL('../../../examples/full-feature-show.hfg', import.meta.url));

// ─── Helpers ───

const preset = (id: string, nObjects: number): { nodes: Node[]; edges: Edge[] } => {
  const p = SHAPE_PRESETS.find((sp) => sp.id === id);
  if (!p) throw new Error(`preset '${id}' not found`);
  return p.build(nObjects);
};

let globalCounter = 0;
const gNode = (type: string, position: { x: number; y: number }, params: Record<string, unknown> = {}): Node => ({
  id: `${type.toLowerCase()}-global-demo-${globalCounter++}`,
  type: 'custom',
  position,
  data: { label: type, type, params },
});

const gEdge = (from: Node, to: Node): Edge => ({
  id: `${from.id}-${to.id}`,
  source: from.id,
  target: to.id,
  sourceHandle: 'output',
  targetHandle: 'input',
});

// ─── Validation (mêmes règles que shapePresets.test.ts + arité) ───

const nodeType = (n: Node) => (n.data as { type: string }).type;

function validateGraph(name: string, nodes: Node[], edges: Edge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const usedInputs = new Map<string, Set<string>>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!src || !dst) throw new Error(`${name}: edge ${e.id} references missing node`);
    const from = nodeType(src) as Parameters<typeof isValidConnection>[0];
    const to = nodeType(dst) as Parameters<typeof isValidConnection>[0];
    if (!isValidConnection(from, to)) {
      throw new Error(`${name}: invalid connection ${from} -> ${to}`);
    }
    const inPorts = getInputPorts(to);
    const sh = e.sourceHandle ?? 'output';
    const th = e.targetHandle ?? 'input';
    if (sh !== 'output') throw new Error(`${name}: bad source port '${sh}' on ${from}`);
    if (!inPorts.includes(th)) throw new Error(`${name}: bad target port '${th}' on ${to}`);
    const key = `${e.target}`;
    const used = usedInputs.get(key) ?? new Set<string>();
    if (used.has(th)) throw new Error(`${name}: port '${th}' of ${to} fed twice`);
    used.add(th);
    usedInputs.set(key, used);
  }
}

// ─── Slot graphs (depuis les presets — graphes déjà éprouvés) ───

const orbitGraph = preset('circle', 4);
const spiralGraph = preset('spiral', 2);
const pursuitGraph = preset('pursuit', 2);
const bassGraph = preset('bass-pulse', 4);
const splineGraph = preset('spline-evaluate', 4);

validateGraph('slot-orbit', orbitGraph.nodes, orbitGraph.edges);
validateGraph('slot-spiral', spiralGraph.nodes, spiralGraph.edges);
validateGraph('slot-pursuit', pursuitGraph.nodes, pursuitGraph.edges);
validateGraph('slot-bass', bassGraph.nodes, bassGraph.edges);
validateGraph('slot-spline', splineGraph.nodes, splineGraph.edges);

const defaultMacros = () => ({
  speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0,
});

const assignments = (trackIds: number[]) =>
  trackIds.map((tid) => ({ track_id: tid, depth: 1.0, phase_offset: 0 }));

const slots = [
  {
    id: 'slot-orbit', name: 'Orbit Ensemble', graphJson: orbitGraph,
    templateId: 'circle', trackIds: [1, 2, 3, 4], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 1.0, fadeOut: 1.0, phaseSpread: 0.25,
    assignments: assignments([1, 2, 3, 4]), audioMods: [],
  },
  {
    id: 'slot-spiral', name: 'Spiral Counterpoint', graphJson: spiralGraph,
    templateId: 'spiral', trackIds: [5, 6], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'ping_pong',
    fadeIn: 1.5, fadeOut: 1.5, phaseSpread: 0.5,
    assignments: assignments([5, 6]), audioMods: [],
  },
  {
    id: 'slot-pursuit', name: 'Pursuit', graphJson: pursuitGraph,
    templateId: 'pursuit', trackIds: [7, 8], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([7, 8]), audioMods: [],
  },
  {
    id: 'slot-bass', name: 'Bass Pulse', graphJson: bassGraph,
    templateId: 'bass-pulse', trackIds: [1, 2, 3, 4], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([1, 2, 3, 4]),
    audioMods: [{
      source: 'amplitude_bass', target: 'speed',
      amount: 2.0, base_value: 1.0, smoothing: 0.4,
    }],
  },
  {
    id: 'slot-spline', name: 'Spline Travel', graphJson: splineGraph,
    templateId: 'spline-evaluate', trackIds: [5, 6, 7, 8], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'oneshot', direction: 'forward',
    fadeIn: 1.0, fadeOut: 1.0, phaseSpread: 0,
    assignments: assignments([5, 6, 7, 8]), audioMods: [],
  },
];

// ─── Graphe global : chaîne Input → post-process → Output, avec nodes
//     Zone + Velocity câblés dans la chaîne (effets extraits par le backend,
//     transform identité dans la chaîne elle-même). ───

const gInput = gNode('Input', { x: 50, y: 250 });
const gManual = gNode('ManualPosition', { x: 210, y: 250 });
const gRadius = gNode('RadiusScale', { x: 380, y: 250 }, { radius_scale: 1.0 });
const gHeight = gNode('HeightOffset', { x: 550, y: 250 }, { height_offset: 0.0 });
const gDepth = gNode('PerTrackDepth', { x: 720, y: 250 }, { depths: [] });
const gScale = gNode('Scale', { x: 890, y: 250 }, { scale: 1.0 });
const gRotate = gNode('Rotate', { x: 1060, y: 250 }, { yaw: 0, pitch: 0, roll: 0 });
const gOffset = gNode('Offset', { x: 1230, y: 250 }, { x: 0, y: 0, z: 0 });
const gZone = gNode('Zone', { x: 1400, y: 250 }, {
  shape: 'sphere', center: [0, 0, 0], radius: 2.5, falloff: 0.8,
  channels: { spread: 1 }, enabled: true,
});
const gVel = gNode('Velocity', { x: 1570, y: 250 }, {
  source: 'speed', channel: 'spread', scale: 0.12, offset: 0,
  min: 0, max: 1, listener: [0, 0, 0],
});
const gOutput = gNode('Output', { x: 1740, y: 250 });

const globalNodes = [gInput, gManual, gRadius, gHeight, gDepth, gScale, gRotate, gOffset, gZone, gVel, gOutput];
const globalEdges = [
  gEdge(gInput, gManual), gEdge(gManual, gRadius), gEdge(gRadius, gHeight),
  gEdge(gHeight, gDepth), gEdge(gDepth, gScale), gEdge(gScale, gRotate),
  gEdge(gRotate, gOffset), gEdge(gOffset, gZone), gEdge(gZone, gVel),
  gEdge(gVel, gOutput),
];
validateGraph('global', globalNodes, globalEdges);
const globalGraph = { nodes: globalNodes, edges: globalEdges };

// ─── Cues : snapshots cohérents — jamais deux moves sur la même track ───

const macroSnapshot = { speed: 1, scale: 1, shift_x: 0, shift_y: 0, shift_z: 0, yaw: 0, pitch: 0, roll: 0 };
const spatialMacroSnapshot = { radius_scale: 1, height_offset: 0 };

const trackIndex = (oscId: number) => oscId - 1; // manualOscIds = [1..8] → index = id-1
const moveSnap = (slot: (typeof slots)[number], mvId: string) => ({
  id: mvId,
  name: slot.name,
  graph_json: slot.graphJson,
  osc_ids: slot.trackIds,
  track_indices: slot.trackIds.map(trackIndex),
  is_preview: false,
  origin: null,
  duration: 4.0,
  loop_mode: slot.loopMode === 'oneshot' ? 'oneshot' : 'loop',
  direction: slot.direction,
  animation_state: null,
  fade_in: slot.fadeIn,
  fade_out: slot.fadeOut,
});

const cues = [
  {
    id: 'cue-ouverture', name: 'Ouverture', description: 'Orbite seule — les 4 premières tracks',
    graph: orbitGraph, timestamp: 0,
    macros: macroSnapshot,
    track_indices: [],
    fade_duration: 3.0,
    cue_number: '1',
    global_graph: globalGraph,
    active_move_ids: ['mv-orbit'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [moveSnap(slots[0], 'mv-orbit')],
  },
  {
    id: 'cue-ensemble', name: 'Ensemble', description: 'Orbite + spirale + poursuite — les 8 tracks',
    graph: orbitGraph, timestamp: 0,
    macros: macroSnapshot,
    track_indices: [],
    fade_duration: 2.0,
    cue_number: '2',
    global_graph: globalGraph,
    active_move_ids: ['mv-orbit', 'mv-spiral', 'mv-pursuit'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: { 0: { gain: -1.5 } },
    channel_modulations: [{
      object: null, source: 'Speed', channel: 'Spread',
      scale: 0.15, offset: 0, min: 0, max: 1, listener: [0, 0, 0],
    }],
    osc_mappings: null,
    zones: [{
      shape: { shape: 'sphere', center: [0, 0, 0], radius: 2.5 },
      falloff: 0.8,
      channels: { spread: 1 },
      objects: null,
      enabled: true,
    }],
    moves: [
      moveSnap(slots[0], 'mv-orbit'),
      moveSnap(slots[1], 'mv-spiral'),
      moveSnap(slots[2], 'mv-pursuit'),
    ],
  },
  {
    id: 'cue-bass', name: 'Bass Drop', description: 'Bass Pulse seul — réactif audio sur tracks 1-4',
    graph: bassGraph, timestamp: 0,
    macros: { ...macroSnapshot, speed: 1.2 },
    track_indices: [],
    fade_duration: 1.0,
    cue_number: '3',
    global_graph: globalGraph,
    active_move_ids: ['mv-bass'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [moveSnap(slots[3], 'mv-bass')],
  },
  {
    id: 'cue-superposition', name: 'Superposition',
    description: 'Orbit + Bass Pulse sur les mêmes tracks 1-4 — exerce la résolution de conflit du merge (stratégie Override : le fade effectif le plus haut gagne)',
    graph: orbitGraph, timestamp: 0,
    macros: macroSnapshot,
    track_indices: [],
    fade_duration: 2.0,
    cue_number: '4',
    global_graph: globalGraph,
    active_move_ids: ['mv-orbit', 'mv-bass'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [moveSnap(slots[0], 'mv-orbit'), moveSnap(slots[3], 'mv-bass')],
  },
];

// ─── Enveloppe .hfg v2 ───

const envelope = {
  format: 'stagespace-show',
  version: 2,
  savedAt: 0,
  // Graphe édité = le slot en cours d'édition (Orbit Ensemble)
  nodes: orbitGraph.nodes,
  edges: orbitGraph.edges,
  globalGraph,
  slots,
  setlistOrder: slots.map((s) => s.id),
  currentSetlistIndex: -1,
  editingSlotId: 'slot-orbit',
  cues,
  osc: {
    oscAddress: '127.0.0.1',
    oscPort: 9000,
    oscProfile: 'holophonix',
    oscInPort: 8001,
  },
  spatialFx: {
    zones: [
      {
        shape: { shape: 'sphere', center: [0, 0, 0], radius: 2.5 },
        falloff: 0.8,
        channels: { spread: 1 },
        objects: null,
        enabled: true,
      },
      {
        shape: { shape: 'box', min: [-6, -1, -6], max: [-2, 3, 6] },
        falloff: 1.0,
        channels: { gain: -3 },
        objects: null,
        enabled: true,
      },
    ],
    modulations: [
      {
        object: null, source: 'Speed', channel: 'Spread',
        scale: 0.15, offset: 0, min: 0, max: 1, listener: [0, 0, 0],
      },
      {
        object: null, source: 'AngularSpeed', channel: 'Presence',
        scale: 0.1, offset: 0.2, min: null, max: 1, listener: [0, 0, 0],
      },
    ],
    objectChannels: {
      0: { gain: -1.5 },
      7: { presence: 0.8 },
    },
    kinematicSmoothing: 0.5,
  },
  tracks: {
    holProject: null,
    manualOscIds: [1, 2, 3, 4, 5, 6, 7, 8],
    // Positions initiales : deux rangées de 4 (index = position dans manualOscIds)
    manualPositions: {
      0: [-3, 0, -1], 1: [-1, 0, -1], 2: [1, 0, -1], 3: [3, 0, -1],
      4: [-3, 0, 1], 5: [-1, 0, 1], 6: [1, 0, 1], 7: [3, 0, 1],
    },
    selectedTrackIds: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  oscMappings: [
    {
      address: '/stagespace/macro/scale',
      destination: { kind: 'macro', name: 'scale' },
      transform: { scale: 1, offset: 0, min: 0, max: 4, smooth: 0.3, deadzone: 0 },
      enabled: true,
    },
    {
      address: '/track/*/spread',
      destination: { kind: 'channel', channel: 'Spread', object: '*' },
      transform: { scale: 1, offset: 0, min: 0, max: 1, smooth: 0.2, deadzone: 0.01 },
      enabled: true,
    },
  ],
  macros: {
    speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0,
    yaw: 0, pitch: 0, roll: 0, radius_scale: 1, height_offset: 0,
  },
};

// ─── Sanity checks sur l'enveloppe ───

const slotIds = new Set(slots.map((s) => s.id));
for (const s of slots) {
  const objects = s.graphJson.nodes.find((n) => nodeType(n) === 'Objects');
  const nObjects = (objects?.data as { params: { n_objects: number } }).params.n_objects;
  if (nObjects !== s.trackIds.length) {
    throw new Error(`${s.id}: n_objects=${nObjects} != trackIds.length=${s.trackIds.length}`);
  }
}
for (const c of cues) {
  for (const mv of c.moves) {
    if (mv.track_indices.length !== mv.osc_ids.length) {
      throw new Error(`${c.id}/${mv.id}: track_indices/osc_ids mismatch`);
    }
  }
  // Plusieurs moves peuvent partager des tracks — le MergeRuntime résout
  // le conflit (Override/Crossfade/Blend/Priority). On log juste l'overlap
  // pour que ce soit un choix assumé dans le fixture.
  const used = new Set<number>();
  for (const mv of c.moves) {
    for (const ti of mv.track_indices) {
      if (used.has(ti)) console.log(`  note: ${c.id} — track ${ti} driven by multiple moves (merge resolution)`);
      used.add(ti);
    }
  }
}
for (const so of envelope.setlistOrder) {
  if (!slotIds.has(so)) throw new Error(`setlistOrder references unknown slot '${so}'`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(envelope, null, 2));
console.log(`Wrote ${OUT} (${slots.length} slots, ${cues.length} cues, ${globalNodes.length} global nodes)`);
