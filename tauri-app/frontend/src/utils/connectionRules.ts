import type { NodeType } from '../store/useGraphStore';

/**
 * Règles de connexion — mirror exact du validateur Rust (validator.rs is_valid_connection)
 * Utilisé par React Flow pour empêcher visuellement les connexions invalides.
 *
 * IMPORTANT : Toute modification ici doit être reflétée dans validator.rs et vice-versa.
 */

// ─── Catégories de nodes ───

// Moteurs math + splines : acceptent Objects + Duration en input, peuvent aller vers Output/composites/modifiers
const ENGINE_TYPES: NodeType[] = [
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge',
  'Pendulum', 'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  // BPM et AudioAmplitude sont des engines dans le validateur Rust (pas des sources)
  'BPM', 'AudioAmplitude',
];

const PHYSICS_TYPES: NodeType[] = [
  'Bouncing', 'Spring', 'Follow', 'Swarm', 'Avoidance', 'VectorField',
];

// Falloffs "riches" : peuvent aller vers Output, composites, modifiers (comme les engines)
const FALLOFF_RICH_TYPES: NodeType[] = ['TimeFalloff', 'PointDistanceFalloff'];

// Falloffs "limités" : ne peuvent aller que vers Scale, Rotate, Offset
const FALLOFF_LIMITED_TYPES: NodeType[] = ['DirectionalFalloff', 'AudioAmplitudeFalloff'];

const MODIFIER_TYPES: NodeType[] = [
  'Scale', 'Rotate', 'Offset', 'PhaseShift',
  'Mirror', 'Clamp', 'LFO', 'Jitter',
  // Post-process nodes (graph global)
  'RadiusScale', 'HeightOffset', 'PerTrackDepth', 'Barycenter', 'AudioFalloff', 'ManualPosition',
  // Déclarations d'effets graph-natives (pass-through dans la chaîne)
  'Zone', 'Velocity',
];

// Modifiers qui peuvent recevoir des falloffs limités (DirectionalFalloff, AudioAmplitudeFalloff)
const FALLOFF_LIMITED_TARGETS: NodeType[] = ['Scale', 'Rotate', 'Offset'];

const COMPOSITE_TYPES: NodeType[] = ['Mix', 'Group', 'Sequence', 'Crossfade'];

// Sources pures : ne peuvent aller QUE vers les falloffs
const SOURCE_TYPES: NodeType[] = ['AudioSpectrum', 'OSCInput'];

// Composites que les modifiers peuvent cibler (PAS Sequence — Rust ne l'autorise pas)
const MODIFIER_COMPOSITE_TARGETS: NodeType[] = ['Mix', 'Group', 'Crossfade'];

const isEngine = (t: NodeType) => ENGINE_TYPES.includes(t);
const isPhysics = (t: NodeType) => PHYSICS_TYPES.includes(t);
const isFalloffRich = (t: NodeType) => FALLOFF_RICH_TYPES.includes(t);
const isFalloffLimited = (t: NodeType) => FALLOFF_LIMITED_TYPES.includes(t);
const isModifier = (t: NodeType) => MODIFIER_TYPES.includes(t);
const isComposite = (t: NodeType) => COMPOSITE_TYPES.includes(t);
const isSource = (t: NodeType) => SOURCE_TYPES.includes(t);

/**
 * Retourne true si une connexion from → to est valide.
 * Mirror EXACT de validator.rs::is_valid_connection
 */
export function isValidConnection(from: NodeType, to: NodeType): boolean {
  // Output n'a pas de sortie
  if (from === 'Output') return false;

  // Input (graph global) → post-process nodes + Output
  if (from === 'Input') {
    return isModifier(to) || to === 'Output';
  }

  // MoveRef : source qui produit des positions. Peut connecter vers post-process, Output,
  // composites — sauf Sequence (Rust ne l'autorise pas pour MoveRef).
  if (from === 'MoveRef') {
    return isModifier(to) || to === 'Output' || MODIFIER_COMPOSITE_TARGETS.includes(to);
  }

  // Merge : équivalent à Input (représente le MergeRuntime).
  if (from === 'Merge') {
    return isModifier(to) || to === 'Output';
  }

  // Objects → engines + physics + splines (pas DrawSpline qui est une source)
  if (from === 'Objects') {
    return isEngine(to) || isPhysics(to);
  }

  // Duration → engines + physics (le validateur Rust autorise les deux)
  if (from === 'Duration') {
    return isEngine(to) || isPhysics(to);
  }

  // DrawSpline : source de données spline → nodes spline (port 'spline')
  // + mêmes cibles qu'un engine (Output, composites, modifiers).
  if (from === 'DrawSpline') {
    return (
      to === 'EvaluateSpline' ||
      to === 'TrimSpline' ||
      to === 'OffsetSpline' ||
      to === 'Output' ||
      isComposite(to) ||
      isModifier(to)
    );
  }

  // Engines (math + splines + BPM + AudioAmplitude) → Output, composites, modifiers
  if (isEngine(from)) {
    return to === 'Output' || isComposite(to) || isModifier(to);
  }

  // Falloffs riches (TimeFalloff, PointDistanceFalloff) → Output, composites, modifiers
  if (isFalloffRich(from)) {
    return to === 'Output' || isComposite(to) || isModifier(to);
  }

  // Falloffs limités (DirectionalFalloff, AudioAmplitudeFalloff) → Scale, Rotate, Offset uniquement
  if (isFalloffLimited(from)) {
    return FALLOFF_LIMITED_TARGETS.includes(to);
  }

  // Physics → Output, composites (pas modifiers)
  if (isPhysics(from)) {
    return to === 'Output' || isComposite(to);
  }

  // Modifiers → Output, Mix, Group, Crossfade, autres modifiers (PAS Sequence)
  if (isModifier(from)) {
    return to === 'Output' || MODIFIER_COMPOSITE_TARGETS.includes(to) || isModifier(to);
  }

  // Composites → Output, autres composites
  if (isComposite(from)) {
    return to === 'Output' || isComposite(to);
  }

  // Sources pures (AudioSpectrum, OSCInput) → falloffs uniquement
  if (isSource(from)) {
    return isFalloffRich(to) || isFalloffLimited(to);
  }

  return false;
}

/**
 * Retourne les ports d'entrée valides pour un type de node.
 * Mirror de validator.rs::has_input_port
 */
export function getInputPorts(type: NodeType): string[] {
  switch (type) {
    // Sources pures / terminaux sans entrée
    case 'Objects':
    case 'Duration':
    case 'AudioSpectrum':
    case 'OSCInput':
    case 'Input':
    case 'MoveRef':
    case 'Merge':
      return [];

    // Engines + physics + falloffs + BPM/AudioAmplitude : input + duration
    case 'Circular': case 'Elliptical': case 'Spiral': case 'Lissajous': case 'Figure8':
    case 'Linear': case 'Oscillation': case 'Formation': case 'PerlinNoise': case 'Converge':
    case 'Pendulum': case 'RoseCurve': case 'Helix': case 'Wave': case 'CustomTrajectory':
    case 'Bouncing': case 'Spring': case 'Follow': case 'Swarm': case 'Avoidance': case 'VectorField':
    case 'BPM': case 'AudioAmplitude':
    case 'DrawSpline':
    case 'TimeFalloff': case 'PointDistanceFalloff': case 'DirectionalFalloff': case 'AudioAmplitudeFalloff':
      return ['input', 'duration'];

    // Splines eval/trim/offset : input (trajectoire) + spline (DrawSpline) + duration
    case 'EvaluateSpline': case 'TrimSpline': case 'OffsetSpline':
      return ['input', 'duration', 'spline'];

    // Modifiers, Output : une seule entrée
    case 'Scale': case 'Rotate': case 'Offset': case 'PhaseShift':
    case 'Mirror': case 'Clamp': case 'LFO': case 'Jitter':
    case 'RadiusScale': case 'HeightOffset': case 'PerTrackDepth':
    case 'Barycenter': case 'AudioFalloff': case 'ManualPosition':
    case 'Zone': case 'Velocity':
    case 'Output':
      return ['input'];

    // Composites binaires : 2 entrées (A et B)
    case 'Mix': case 'Group': case 'Sequence': case 'Crossfade':
      return ['input_a', 'input_b'];

    default:
      return [];
  }
}

/**
 * Retourne les ports de sortie valides pour un type de node.
 * Mirror de validator.rs::has_output_port
 */
function getOutputPorts(type: NodeType): string[] {
  switch (type) {
    case 'Output':
      return []; // Output n'a pas de sortie

    case 'Objects':
    case 'Duration':
      return ['output'];

    // Engines, physics, falloffs, modifiers, composites, sources, splines
    default:
      return ['output'];
  }
}

/**
 * Retourne true si le node est une source (pas d'input).
 */
export function isSourceNode(type: NodeType): boolean {
  return getInputPorts(type).length === 0;
}

/**
 * Retourne true si le node est un terminal (pas d'output).
 */
export function isTerminalNode(type: NodeType): boolean {
  return getOutputPorts(type).length === 0;
}

/**
 * Retourne true si le node est un composite binaire (2 inputs).
 */
export function isBinaryComposite(type: NodeType): boolean {
  return type === 'Mix' || type === 'Group' || type === 'Sequence' || type === 'Crossfade';
}
