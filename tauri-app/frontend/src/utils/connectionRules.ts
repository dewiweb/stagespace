import type { NodeType } from '../store/useGraphStore';
import type { NodeSpec } from '../types/generated/NodeSpec';
import type { PortDef } from '../types/generated/PortDef';
import type { PluginKind } from '../types/generated/PluginKind';
import SPECS_JSON from '../types/generated/nodeSpecs.json';

/**
 * Règles de connexion — dérivées du catalogue déclaratif Rust (node_spec.rs),
 * sérialisé dans `types/generated/nodeSpecs.json` par `npm run contracts`.
 *
 * Modèle : chaque port est typé (`PortDef.port_type`). La règle unique :
 *
 *   edge valide ⟺ out_port.port_type === in_port.port_type
 *
 * Le kind du manifeste Plugin restreint le superset ABI à runtime
 * (engine → objects+duration, modifier → in, composite → a+b), mirror
 * de `NodeSpec::plugin_input_ports`.
 */

export const NODE_SPECS: NodeSpec[] = SPECS_JSON as unknown as NodeSpec[];

/// Couleur Tailwind du handle par type de port — la sémantique de l'edge
/// se lit sur la couleur : Positions (trajectoires), carriers ObjectSet/
/// Duration, géométrie Spline, domaine Signal. Source unique — handles
/// (CustomNode) et légende (NodeEditor) la partagent.
export const PORT_COLORS: Record<PortDef['port_type'], string> = {
  Positions: '!bg-gray-400',
  ObjectSet: '!bg-cyan-500',
  Duration: '!bg-yellow-500',
  Spline: '!bg-emerald-500',
  Signal: '!bg-orange-400',
};
const SPEC_BY_TYPE = new Map<NodeType, NodeSpec>(NODE_SPECS.map((s) => [s.node_type, s]));

/// Spec d'un type de node — le catalogue couvre tous les variants de NodeType.
export function specOf(type: NodeType): NodeSpec {
  const s = SPEC_BY_TYPE.get(type);
  if (!s) throw new Error(`Missing NodeSpec for ${type}`);
  return s;
}

/// Ports d'entrée effectifs d'un node — le kind du manifeste restreint le
/// superset Plugin (mirror de NodeSpec::plugin_input_ports).
export function effectiveInputPorts(type: NodeType, pluginKind?: PluginKind): PortDef[] {
  if (type === 'Plugin') {
    const port = (name: string, port_type: PortDef['port_type'], required = false): PortDef => ({
      name,
      port_type,
      required,
      label: name,
    });
    if (pluginKind === 'engine')
      return [port('objects', 'ObjectSet'), port('duration', 'Duration')];
    if (pluginKind === 'modifier') return [port('in', 'Positions', true)];
    if (pluginKind === 'composite')
      return [port('a', 'Positions', true), port('b', 'Positions', true)];
    return [
      port('objects', 'ObjectSet'),
      port('duration', 'Duration'),
      port('in', 'Positions'),
      port('a', 'Positions'),
      port('b', 'Positions'),
    ];
  }
  return specOf(type).inputs;
}

/// Port de sortie par nom — tous les nodes natifs déclarent leurs sorties.
function outputPortOf(type: NodeType, name: string): PortDef | undefined {
  return specOf(type).outputs.find((p) => p.name === name);
}

/**
 * Retourne true si la connexion `from.out[fromPort] → to.in[toPort]` est
 * valide : les deux ports existent et portent le même type.
 */
export function isValidConnection(
  from: NodeType,
  to: NodeType,
  fromPort?: string,
  toPort?: string,
  toPluginKind?: PluginKind,
): boolean {
  const outs = specOf(from).outputs;
  const ins = effectiveInputPorts(to, toPluginKind);
  const out = fromPort !== undefined ? outs.find((p) => p.name === fromPort) : undefined;
  const inp = toPort !== undefined ? ins.find((p) => p.name === toPort) : undefined;
  // Port explicite mais inexistant → invalide.
  if ((fromPort !== undefined && !out) || (toPort !== undefined && !inp)) return false;
  // Égalité de type sur la paire effective — le côté non spécifié est
  // "n'importe quel port de type compatible".
  return outs.some((o) =>
    ins.some(
      (i) =>
        i.port_type === o.port_type &&
        (out === undefined || o === out) &&
        (inp === undefined || i === inp),
    ),
  );
}

/**
 * Explique pourquoi une connexion est refusée — message orienté type de port.
 * Retourne null quand la connexion est valide.
 */
export function connectionRejectionReason(
  from: NodeType,
  to: NodeType,
  fromPort?: string,
  toPort?: string,
  toPluginKind?: PluginKind,
): string | null {
  const fp = fromPort ?? specOf(from).outputs[0]?.name;
  const tp = toPort ?? effectiveInputPorts(to, toPluginKind)[0]?.name;

  const out = fp ? outputPortOf(from, fp) : undefined;
  if (fp && !out) return `${from} has no output port '${fp}'.`;
  if (!fp) return `${from} is a terminal — it has no output port.`;

  const inputs = effectiveInputPorts(to, toPluginKind);
  const inp = tp ? inputs.find((p) => p.name === tp) : undefined;
  if (tp && !inp) return `${to} has no input port '${tp}'.`;
  if (!tp) return `${to} takes no input.`;

  if (out!.port_type !== inp!.port_type) {
    return `Port type mismatch: ${from}.${fp} is ${out!.port_type}, ${to}.${tp} expects ${inp!.port_type}.`;
  }
  return null;
}

/**
 * Autopatch (inspiration plugdata) : insertion d'un node sur une edge
 * existante — `A → B` + palette click sur `M` devient `A → M → B`.
 * M doit avoir un port d'entrée du même type que la sortie de A et une
 * sortie du même type que l'entrée de B. Retourne null si le splice est
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
  const toInputs = effectiveInputPorts(to, toPluginKind);
  const toPort = targetHandle ?? toInputs[0]?.name;
  const toPortDef = toInputs.find((p) => p.name === toPort);
  if (!toPortDef) return `${to} has no input port '${toPort}'.`;

  // Ports non-Positions (objects/duration/spline/signal) : pas de splice —
  // un node inséré y casserait la sémantique carrier/spécialisée.
  if (toPortDef.port_type !== 'Positions') {
    return `a ${toPort} connection can't take an inserted node.`;
  }

  const insInputs = effectiveInputPorts(inserted, insertedPluginKind);
  // L'inséré doit accepter le type de la sortie source sur un port non requis
  // binaire — un composite binaire (a+b) laisserait un port pendante.
  const hasSinglePosInput = insInputs.filter((p) => p.port_type === 'Positions').length === 1;
  if (!hasSinglePosInput) {
    return `${inserted} can't be inserted mid-chain — it needs a single Positions input.`;
  }
  const insOut = specOf(inserted).outputs.find((p) => p.port_type === toPortDef.port_type);
  if (!insOut) {
    return `${inserted} can't feed ${to} — no ${toPortDef.port_type} output.`;
  }
  if (!isValidConnection(from, inserted, undefined, insInputs.find((p) => p.port_type === 'Positions')!.name, insertedPluginKind)) {
    return `${from} can't feed ${inserted}.`;
  }
  if (!isValidConnection(inserted, to, insOut.name, toPort, toPluginKind)) {
    return `${inserted} can't feed ${to}.`;
  }
  return null;
}

/// Type de port d'une sortie par handleId — `null` → première sortie
/// (React Flow passe handleId null sur certains nodes mono-port).
export function outputPortType(type: NodeType, handleId: string | null): PortDef['port_type'] | undefined {
  const outs = specOf(type).outputs;
  return outs.find((p) => p.name === handleId)?.port_type ?? (handleId === null ? outs[0]?.port_type : undefined);
}

/// Type de port d'une entrée par handleId — `null` → première entrée.
export function inputPortType(
  type: NodeType,
  handleId: string | null,
  pluginKind?: PluginKind,
): PortDef['port_type'] | undefined {
  const ins = effectiveInputPorts(type, pluginKind);
  return ins.find((p) => p.name === handleId)?.port_type ?? (handleId === null ? ins[0]?.port_type : undefined);
}

/// Premier port d'entrée du node acceptant `portType` — cible de
/// l'auto-connect après un wire-drop → quick-add.
export function firstInputPortOf(
  type: NodeType,
  portType: PortDef['port_type'],
  pluginKind?: PluginKind,
): PortDef | undefined {
  return effectiveInputPorts(type, pluginKind).find((p) => p.port_type === portType);
}

/// Premier port de sortie du node produisant `portType` — source de
/// l'auto-connect après un back-drag depuis une entrée.
export function firstOutputPortOf(type: NodeType, portType: PortDef['port_type']): PortDef | undefined {
  return specOf(type).outputs.find((p) => p.port_type === portType);
}

/**
 * Retourne les ports d'entrée valides pour un type de node —
 * `NodeSpec::inputs` (Plugin : superset restreint par le kind du manifeste).
 */
export function getInputPorts(type: NodeType, pluginKind?: PluginKind): PortDef[] {
  return effectiveInputPorts(type, pluginKind);
}

/**
 * Retourne les ports de sortie valides pour un type de node.
 */
export function getOutputPorts(type: NodeType): PortDef[] {
  return [...specOf(type).outputs];
}

/**
 * Retourne true si le node est une source (pas d'input).
 */
export function isSourceNode(type: NodeType): boolean {
  return specOf(type).inputs.length === 0;
}

/**
 * Retourne true si le node est un terminal (pas d'output).
 */
export function isTerminalNode(type: NodeType): boolean {
  return specOf(type).outputs.length === 0;
}

/**
 * Retourne true si le node est un composite binaire natif (2 inputs a/b).
 */
export function isBinaryComposite(type: NodeType): boolean {
  return specOf(type).category === 'Composite';
}

/// Types de ports présents dans un graphe (pour la légende) — union des
/// inputs/outputs des nodes, ordre fixe PORT_COLORS.
export function portTypesInGraph(nodeTypes: (NodeType | string | undefined)[]): PortDef['port_type'][] {
  const present = new Set<PortDef['port_type']>();
  for (const t of nodeTypes) {
    if (!t) continue;
    const spec = SPEC_BY_TYPE.get(t as NodeType);
    if (!spec) continue;
    for (const p of [...spec.inputs, ...spec.outputs]) {
      present.add(p.port_type);
    }
  }
  return (Object.keys(PORT_COLORS) as PortDef['port_type'][]).filter((k) => present.has(k));
}
