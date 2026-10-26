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
import { isValidConnection, getInputPorts, getOutputPorts, specOf } from '../src/utils/connectionRules';
import type { NodeType } from '../src/store/useGraphStore';
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

const gEdge = (from: Node, to: Node): Edge => {
  // Ports résolus par correspondance de type — même règle que le validator.
  const outPorts = getOutputPorts(nodeType(from) as NodeType);
  const inPorts = getInputPorts(nodeType(to) as NodeType);
  for (const op of outPorts) {
    const ip = inPorts.find((p) => p.port_type === op.port_type);
    if (ip) {
      return {
        id: `${from.id}-${to.id}`,
        source: from.id,
        target: to.id,
        sourceHandle: op.name,
        targetHandle: ip.name,
      };
    }
  }
  throw new Error(`no compatible port ${nodeType(from)} -> ${nodeType(to)}`);
};

// ─── Validation (mêmes règles que shapePresets.test.ts + arité) ───

const nodeType = (n: Node) => (n.data as { type: string }).type;

function validateGraph(name: string, nodes: Node[], edges: Edge[], scope: 'sub' | 'global' = 'sub') {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const usedInputs = new Map<string, Set<string>>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!src || !dst) throw new Error(`${name}: edge ${e.id} references missing node`);
    const from = nodeType(src) as Parameters<typeof isValidConnection>[0];
    const to = nodeType(dst) as Parameters<typeof isValidConnection>[0];
    const sh = e.sourceHandle ?? 'out';
    const th = e.targetHandle ?? 'in';
    if (!isValidConnection(from, to, sh, th)) {
      throw new Error(`${name}: invalid connection ${from}.${sh} -> ${to}.${th}`);
    }
    const inPorts = getInputPorts(to);
    if (!inPorts.some((p) => p.name === th))
      throw new Error(`${name}: bad target port '${th}' on ${to}`);
    const key = `${e.target}`;
    const used = usedInputs.get(key) ?? new Set<string>();
    if (used.has(th)) throw new Error(`${name}: port '${th}' of ${to} fed twice`);
    used.add(th);
    usedInputs.set(key, used);
  }
  for (const n of nodes) validateParams(name, n, scope);
}

// ─── Validation des paramètres contre le NodeSpec (anti-dérive) ───
//
// Clés volontairement hors-ParamSpec : elles sont lues par le backend mais
// ne sont pas des params éditables — l'allowlist rend la dérive visible au
// lieu de la laisser pourrir en silence dans le .hfg.
const EXTRA_PARAMS_SUB = new Set(['n_objects']); // fallback resolve_n_objects_depth
const EXTRA_PARAMS_GLOBAL: Record<string, Set<string>> = {
  // Graphe global : Rotate documente yaw/pitch/roll en degrés (convention
  // macros) et Scale accepte `scale` uniforme — voir post_process_compiler.
  Rotate: new Set(['yaw', 'pitch', 'roll']),
  Scale: new Set(['scale']),
};

function validateParams(label: string, n: Node, scope: 'sub' | 'global') {
  const type = nodeType(n) as NodeType;
  const spec = specOf(type); // throw si type inconnu — dérive de catalogue
  const declared = new Set(spec.params.map((p) => p.key));
  const allowed = new Set(EXTRA_PARAMS_SUB);
  if (scope === 'global') {
    for (const k of EXTRA_PARAMS_GLOBAL[type] ?? []) allowed.add(k);
  }
  for (const key of Object.keys(n.data.params ?? {})) {
    if (!declared.has(key) && !allowed.has(key)) {
      throw new Error(
        `${label}: param '${key}' on ${type} not in NodeSpec — stale key or missing ParamSpec`,
      );
    }
  }
}

// ─── Slot graphs (depuis les presets — graphes déjà éprouvés) ───

const orbitGraph = preset('circle', 4);
const spiralGraph = preset('spiral', 2);
const pursuitGraph = preset('pursuit', 2);
const bassGraph = preset('bass-pulse', 4);
const splineGraph = preset('spline-evaluate', 4);
const crossfadeGraph = preset('crossfade-pursuit-orbit', 2);
// ── Complexité étendue : chaque catégorie du moteur est exercée ──
const mixGraph = preset('mix-order-chaos', 2);          // Mix + Swarm (physics)
const sequenceGraph = preset('sequence-circle-spiral', 2); // Sequence temporelle
const fadeinGraph = preset('orbit-fade-in', 2);          // TimeFalloff
const gravityGraph = preset('gravity-well', 2);          // PointDistanceFalloff
const sweepGraph = preset('side-sweep', 2);              // DirectionalFalloff + Rotate
const chainGraph = preset('modifier-chain', 2);          // Rotate → Offset
const bpmGraph = preset('bpm-circle', 2);                // Source BPM (audio)
const vectorGraph = preset('vectorfield', 2);            // VectorField (exotique)
const groupGraph = preset('group-circle-linear', 4);     // Group : partition de tracks

const slotGraphs: [string, { nodes: Node[]; edges: Edge[] }][] = [
  ['slot-orbit', orbitGraph], ['slot-spiral', spiralGraph], ['slot-pursuit', pursuitGraph],
  ['slot-bass', bassGraph], ['slot-spline', splineGraph], ['slot-crossfade', crossfadeGraph],
  ['slot-mix', mixGraph], ['slot-sequence', sequenceGraph], ['slot-fadein', fadeinGraph],
  ['slot-gravity', gravityGraph], ['slot-sidesweep', sweepGraph], ['slot-chain', chainGraph],
  ['slot-bpm', bpmGraph], ['slot-vectorfield', vectorGraph], ['slot-group', groupGraph],
];
for (const [name, g] of slotGraphs) validateGraph(name, g.nodes, g.edges);

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
  {
    // Composite Crossfade + deux modes Follow (pursue → orbit) — démontre la
    // composition de trajectoires, cœur du moteur nodal. Partage tracks 7-8
    // avec Pursuit : le merge résout le conflit si les deux tournent.
    id: 'slot-crossfade', name: 'Pursuit⇄Orbit', graphJson: crossfadeGraph,
    templateId: 'crossfade-pursuit-orbit', trackIds: [7, 8], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.5,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([7, 8]), audioMods: [],
  },
  // ── Complexité étendue : une catégorie du moteur par slot ──
  {
    // Mix composite : blend Circular (70%) + Swarm (boids) — layers + physics
    id: 'slot-mix', name: 'Order + Chaos', graphJson: mixGraph,
    templateId: 'mix-order-chaos', trackIds: [1, 2], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 1.0, fadeOut: 1.0, phaseSpread: 0,
    assignments: assignments([1, 2]), audioMods: [],
  },
  {
    // Sequence composite : Circle 4s puis Spiral — chaînage temporel
    id: 'slot-sequence', name: 'Circle→Spiral', graphJson: sequenceGraph,
    templateId: 'sequence-circle-spiral', trackIds: [3, 4], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'backward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([3, 4]), audioMods: [],
  },
  {
    // TimeFalloff : orbite qui s'ouvre depuis le centre — intro temporelle
    id: 'slot-fadein', name: 'Orbit Fade-In', graphJson: fadeinGraph,
    templateId: 'orbit-fade-in', trackIds: [5, 6], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.5,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([5, 6]), audioMods: [],
  },
  {
    // PointDistanceFalloff : orbite excentrique qui s'effondre loin
    // de l'attracteur — falloff spatial
    id: 'slot-gravity', name: 'Gravity Well', graphJson: gravityGraph,
    templateId: 'gravity-well', trackIds: [7, 8], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.5,
    loopMode: 'loop', direction: 'ping_pong',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([7, 8]), audioMods: [],
  },
  {
    // DirectionalFalloff + Rotate : seul le côté +X bouge — falloff orienté
    id: 'slot-sidesweep', name: 'Side Sweep', graphJson: sweepGraph,
    templateId: 'side-sweep', trackIds: [1, 2], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([1, 2]), audioMods: [],
  },
  {
    // Chaîne de modifiers : Circle → Rotate → Offset — transform pipeline
    id: 'slot-chain', name: 'Modifier Chain', graphJson: chainGraph,
    templateId: 'modifier-chain', trackIds: [3, 4], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0.5,
    assignments: assignments([3, 4]), audioMods: [],
  },
  {
    // Source BPM : cercle synchronisé au tempo détecté (audio → moteur)
    id: 'slot-bpm', name: 'BPM Circle', graphJson: bpmGraph,
    templateId: 'bpm-circle', trackIds: [5, 6], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 1.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 0.5, fadeOut: 0.5, phaseSpread: 0,
    assignments: assignments([5, 6]), audioMods: [],
  },
  {
    // VectorField : champ de vecteurs → mouvement — l'engine le plus
    // exotique du catalogue
    id: 'slot-vectorfield', name: 'Vector Field', graphJson: vectorGraph,
    templateId: 'vectorfield', trackIds: [7, 8], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 1.0, fadeOut: 1.0, phaseSpread: 0,
    assignments: assignments([7, 8]), audioMods: [],
  },
  {
    // Group : partitionne les tracks — moitié cercle, moitié linéaire.
    // Le composite qui gère des n_objects différents par branche.
    id: 'slot-group', name: 'Split Ensemble', graphJson: groupGraph,
    templateId: 'group-circle-linear', trackIds: [1, 2, 3, 4], movementId: null,
    isPreview: false, macros: defaultMacros(), fadeDuration: 2.0,
    loopMode: 'loop', direction: 'forward',
    fadeIn: 1.0, fadeOut: 1.0, phaseSpread: 0,
    assignments: assignments([1, 2, 3, 4]), audioMods: [],
  },
];

// ─── Graphe global : chaîne Input → post-process → Output, avec nodes
//     Zone + Velocity câblés dans la chaîne (effets extraits par le backend,
//     transform identité dans la chaîne elle-même). ───

// Merge en tête de chaîne (source équivalente à Input) — son param
// `strategy` est lu par le backend et appliqué au MergeRuntime :
// 'crossfade' fait que le cue Superposition blende les moves plutôt
// que de laisser le dernier activé tout écraser (override).
const gInput = gNode('Merge', { x: 50, y: 250 }, { strategy: 'crossfade' });
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
validateGraph('global', globalNodes, globalEdges, 'global');
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
    schema_version: 1,
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
    schema_version: 1,
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
    schema_version: 1,
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
    schema_version: 1,
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
  {
    id: 'cue-layers', name: 'Layers',
    schema_version: 1,
    description: 'Mix + Sequence + TimeFalloff — les trois composites en un cue',
    graph: mixGraph, timestamp: 0,
    macros: macroSnapshot,
    track_indices: [],
    fade_duration: 2.5,
    cue_number: '5',
    global_graph: globalGraph,
    active_move_ids: ['mv-mix', 'mv-sequence', 'mv-fadein'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [
      moveSnap(slots[6], 'mv-mix'),
      moveSnap(slots[7], 'mv-sequence'),
      moveSnap(slots[8], 'mv-fadein'),
    ],
  },
  {
    id: 'cue-fields', name: 'Fields',
    schema_version: 1,
    description: 'DirectionalFalloff + Modifier Chain + PointDistance — falloffs spatiaux et transforms',
    graph: sweepGraph, timestamp: 0,
    macros: macroSnapshot,
    track_indices: [],
    fade_duration: 2.0,
    cue_number: '6',
    global_graph: globalGraph,
    active_move_ids: ['mv-sidesweep', 'mv-chain', 'mv-gravity'],
    per_track_depths: [],
    manual_positions: {},
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    osc_mappings: null,
    zones: null,
    moves: [
      moveSnap(slots[10], 'mv-sidesweep'),
      moveSnap(slots[11], 'mv-chain'),
      moveSnap(slots[9], 'mv-gravity'),
    ],
  },
  {
    id: 'cue-finale', name: 'Finale',
    schema_version: 1,
    description: 'BPM Circle + Vector Field — audio source et engine exotique. ' +
      'Snapshot complet : per_track_depths, manual_positions et osc_mappings restaurés',
    graph: bpmGraph, timestamp: 0,
    macros: { ...macroSnapshot, speed: 1.1 },
    track_indices: [],
    fade_duration: 3.0,
    cue_number: '7',
    global_graph: globalGraph,
    active_move_ids: ['mv-bpm', 'mv-vectorfield'],
    // Profondeur par track dégressive — exerce PerTrackDepth + restore cue
    per_track_depths: [1.0, 0.9, 0.8, 0.7, 1.0, 0.9, 0.8, 0.7],
    // Un objet repositionné manuellement (drag 3D) capturé dans le cue
    manual_positions: { 2: [1.5, 0.0, -1.0] },
    spatial_macros: spatialMacroSnapshot,
    object_channels: null,
    channel_modulations: null,
    // Mapping OSC IN restauré au recall — macro yaw (speed est exclu des
    // macros OSC IN : per-move, pas global — voir MacroTarget)
    osc_mappings: [
      {
        address: '/stagespace/macro/yaw',
        destination: { kind: 'macro', name: 'yaw' },
        transform: { scale: 1, offset: 0, min: -3.14, max: 3.14, smooth: 0.3, deadzone: 0 },
        enabled: true,
      },
    ],
    zones: null,
    moves: [
      moveSnap(slots[12], 'mv-bpm'),
      moveSnap(slots[13], 'mv-vectorfield'),
    ],
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
      {
        // Modulation par-objet (index 2 = 3e track) : les à-coups (jerk) de
        // cet objet seul creusent son gain — règle ciblée, pas globale.
        object: 2, source: 'Jerk', channel: 'Gain',
        scale: -0.4, offset: 0, min: -6, max: 0, listener: [0, 0, 0],
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
    {
      // Position manuelle par OSC : array [x,y,z] → position de l'objet 0
      // (démontre la destination 'position' — override direct du mix)
      address: '/track/1/position',
      destination: { kind: 'position', object: 0 },
      transform: { scale: 1, offset: 0, min: -10, max: 10, smooth: 0.1, deadzone: 0 },
      enabled: true,
    },
    {
      // Handler passif : la dernière valeur reçue est exposée sous le nom
      // 'fader_master' (lisible par les nodes OSCInput / future logique)
      address: '/controller/fader1',
      destination: { kind: 'handler', name: 'fader_master' },
      transform: { scale: 1, offset: 0, min: 0, max: 1, smooth: 0, deadzone: 0.005 },
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
