import type { NodeType } from '../store/useGraphStore';
import type { NodeSpec } from '../types/generated/NodeSpec';
import type { NodeCategory } from '../types/generated/NodeCategory';
import type { PluginKind } from '../types/generated/PluginKind';
import SPECS_JSON from '../types/generated/nodeSpecs.json';

/**
 * Règles de connexion — dérivées du catalogue déclaratif Rust (node_spec.rs),
 * sérialisé dans `types/generated/nodeSpecs.json` par `npm run contracts`.
 * La logique ci-dessous est le mirror structurel de `NodeSpec::can_feed` /
 * `feeds_modifier` / `feeds_composite` — les *données* ne sont plus dupliquées.
 */

export const NODE_SPECS: NodeSpec[] = SPECS_JSON as unknown as NodeSpec[];
const SPEC_BY_TYPE = new Map<NodeType, NodeSpec>(NODE_SPECS.map((s) => [s.node_type, s]));

/// Spec d'un type de node — le catalogue couvre tous les variants de NodeType.
export function specOf(type: NodeType): NodeSpec {
  const s = SPEC_BY_TYPE.get(type);
  if (!s) throw new Error(`Missing NodeSpec for ${type}`);
  return s;
}

const catIs = (to: NodeSpec, c: NodeCategory) => to.category === c;
const COMPOSITE_NON_SEQ: NodeType[] = ['Mix', 'Group', 'Crossfade'];

function canFeedTrajectory(to: NodeSpec): boolean {
  return to.node_type === 'Output' || catIs(to, 'Composite') || catIs(to, 'Modifier');
}

/// Mirror de NodeSpec::can_feed (validator Rust).
function canFeed(from: NodeSpec, to: NodeSpec): boolean {
  switch (from.feeds) {
    case 'Terminal':
      return false;
    case 'EngineInputs':
      return to.inputs.includes('duration');
    case 'Trajectory':
      return canFeedTrajectory(to);
    case 'SplineAndTrajectory':
      return to.inputs.includes('spline') || canFeedTrajectory(to);
    case 'TrajectoryComposites':
      return to.node_type === 'Output' || catIs(to, 'Composite');
    case 'BasicModifiers':
      return to.falloff_target;
    case 'ModifierChain':
    case 'MoveRefChain':
      return (
        to.node_type === 'Output' ||
        catIs(to, 'Modifier') ||
        catIs(to, 'PostProcess') ||
        COMPOSITE_NON_SEQ.includes(to.node_type)
      );
    case 'Composites':
      return to.node_type === 'Output' || catIs(to, 'Composite');
    case 'PostProcess':
      return to.node_type === 'Output' || catIs(to, 'Modifier') || catIs(to, 'PostProcess');
    case 'Signal':
      // Domaine signal (modulation) — scalaires f64 entre nodes Signal
      // uniquement. Aucun edge vers trajectoire/modifier/post-process.
      return catIs(to, 'Signal');
  }
}

/// Mirror de NodeSpec::feeds_modifier — pour cibles Plugin kind=modifier.
function feedsModifier(t: NodeType): boolean {
  const s = specOf(t);
  switch (s.feeds) {
    case 'Trajectory':
    case 'SplineAndTrajectory':
    case 'BasicModifiers':
    case 'MoveRefChain':
      return true;
    case 'ModifierChain':
      return s.category === 'Modifier';
    default:
      return false;
  }
}

/// Mirror de NodeSpec::feeds_composite — pour cibles Plugin kind=composite.
function feedsComposite(t: NodeType): boolean {
  const s = specOf(t);
  switch (s.feeds) {
    case 'Trajectory':
    case 'SplineAndTrajectory':
    case 'TrajectoryComposites':
    case 'Composites':
    case 'MoveRefChain':
      return true;
    case 'ModifierChain':
      return s.category === 'Modifier';
    default:
      return false;
  }
}

/**
 * Retourne true si une connexion from → to est valide.
 * Mirror de validator.rs::is_valid_connection — la matrice vit dans le
 * catalogue Rust, le frontend n'évalue que les règles.
 */
export function isValidConnection(
  from: NodeType,
  to: NodeType,
  toPluginKind?: PluginKind,
): boolean {
  // Plugin WASM cible : le kind du manifeste détermine qui peut l'alimenter
  // (mirror de validator.rs). Kind inconnu → superset permissif.
  if (to === 'Plugin') {
    if (toPluginKind === 'engine') return from === 'Objects' || from === 'Duration';
    if (toPluginKind === 'modifier') return feedsModifier(from);
    if (toPluginKind === 'composite') return feedsComposite(from);
    return from === 'Objects' || from === 'Duration' || feedsComposite(from);
  }

  return canFeed(specOf(from), specOf(to));
}

/**
 * Explains why a from → to connection is refused, for user feedback.
 * Returns null when the connection is valid.
 */
export function connectionRejectionReason(
  from: NodeType,
  to: NodeType,
  toPluginKind?: PluginKind,
): string | null {
  if (isValidConnection(from, to, toPluginKind)) return null;

  if (from === 'Output') return 'Output is a terminal — it has no output port.';

  if (to === 'Plugin' && toPluginKind === 'engine')
    return 'Plugin engines only accept Objects / Duration inputs.';
  if (to === 'Plugin' && toPluginKind === 'modifier' && !feedsModifier(from))
    return `Plugin modifiers take one trajectory input — ${from} can't feed one.`;
  if (to === 'Plugin' && toPluginKind === 'composite' && !feedsComposite(from))
    return `Plugin composites take two trajectory inputs — ${from} can't feed one.`;

  const feeds = specOf(from).feeds;

  if (feeds === 'EngineInputs')
    return `${from} only feeds engines, physics and falloffs.`;

  if (feeds === 'PostProcess')
    return `${from} (global graph) feeds modifiers / post-process and Output only.`;

  if (from === 'MoveRef' && to === 'Sequence')
    return 'MoveRef cannot feed Sequence — use Mix, Group or Crossfade.';

  if (feeds === 'BasicModifiers')
    return `${from} only feeds Scale / Rotate / Offset.`;

  if (feeds === 'TrajectoryComposites' && specOf(to).category === 'Modifier')
    return 'Physics nodes feed Output or composites — not modifiers.';

  if ((feeds === 'ModifierChain' || feeds === 'MoveRefChain') && to === 'Sequence')
    return 'Modifiers cannot feed Sequence — use Mix, Group or Crossfade.';

  if (feeds === 'SplineAndTrajectory')
    return 'DrawSpline feeds spline nodes, Output, composites and modifiers.';

  return `${from} cannot connect to ${to}.`;
}

/**
 * Port-level rejection — isValidConnection is type-only; the editor also
 * gates by target handle (duration port, spline port…).
 */
export function portRejectionReason(from: NodeType, targetPort: string | null | undefined): string | null {
  if (from === 'Duration' && targetPort !== 'duration')
    return 'Duration can only connect to a duration port.';
  if (from === 'Objects' && targetPort !== 'input' && targetPort !== 'input_a' && targetPort !== 'input_b')
    return 'Objects can only connect to a trajectory input port.';
  return null;
}

/**
 * Autopatch (inspiration plugdata) : insertion d'un node sur une edge existante
 * — `A → B` + palette click sur `M` devient `A → M → B`. La règle compose les
 * specs : M doit accepter une entrée trajectoire sur 'input', être
 * alimentable par A, et pouvoir alimenter B. Retourne null si le splice est
 * valide, sinon une explication (EN) pour le toast.
 */
export function spliceRejectionReason(
  from: NodeType,
  to: NodeType,
  inserted: NodeType,
  insertedPluginKind: PluginKind | undefined,
  targetHandle: string | null | undefined,
  toPluginKind?: PluginKind,
): string | null {
  if (targetHandle === 'duration' || targetHandle === 'spline')
    return `a ${targetHandle} connection can't take an inserted node.`;
  // Composites (2 entrées) : 'input' est un alias legacy d'input_a — insérer
  // sur une seule edge laisserait input_b pendante → graphe invalide.
  if (isBinaryComposite(inserted) || insertedPluginKind === 'composite')
    return `${inserted} needs two inputs — connect its A/B ports manually.`;
  if (!getInputPorts(inserted, insertedPluginKind).includes('input'))
    return `${inserted} can't be inserted mid-chain — it has no trajectory input port.`;
  if (!isValidConnection(from, inserted, insertedPluginKind))
    return `${from} can't feed ${inserted}.`;
  if (!isValidConnection(inserted, to, toPluginKind))
    return `${inserted} can't feed ${to}.`;
  return null;
}

/**
 * Retourne les ports d'entrée valides pour un type de node —
 * `NodeSpec::inputs` (Plugin : superset restreint par le kind du manifeste,
 * mirror de validator.rs::has_input_port).
 */
export function getInputPorts(type: NodeType, pluginKind?: PluginKind): string[] {
  if (type === 'Plugin') {
    if (pluginKind === 'engine') return ['input', 'duration'];
    if (pluginKind === 'modifier') return ['input'];
    if (pluginKind === 'composite') return ['input', 'input_a', 'input_b'];
    return ['input', 'input_a', 'input_b', 'duration'];
  }
  return [...specOf(type).inputs];
}

/**
 * Retourne les ports de sortie valides pour un type de node —
 * `NodeSpec::outputs` (Output est le seul terminal).
 */
function getOutputPorts(type: NodeType): string[] {
  return [...specOf(type).outputs];
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
 * Retourne true si le node est un composite binaire natif (2 inputs A/B) —
 * par catégorie : le superset de ports de Plugin contient input_a/b sans
 * que le node soit forcément composite (le kind du manifeste décide).
 */
export function isBinaryComposite(type: NodeType): boolean {
  return specOf(type).category === 'Composite';
}
