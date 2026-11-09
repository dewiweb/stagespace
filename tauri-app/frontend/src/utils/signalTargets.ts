/// Cibles des sinks SignalOut — macros + params modulables des nodes du
/// graphe du move (scope per-move). Les valeurs `param:<node_id>:<key>`
/// utilisent l'id React Flow : le parser backend le propage en `__fe_id`,
/// ce qui rend la cible stable à travers les recompiles.
import type { GraphNode } from '../components/nodeParamSchema';
import { NODE_SPECS } from './connectionRules';
import type { NodeType } from '../types/generated/NodeType';

/// Macros ciblables (mêmes clés que le backend `macro_with_deltas` +
/// `speed` en scope per-move).
export const MACRO_TARGETS = [
  'speed',
  'scale',
  'shift_x',
  'shift_y',
  'shift_z',
  'yaw',
  'pitch',
  'roll',
  'radius_scale',
  'height_offset',
] as const;

function shortId(id: string): string {
  // "scale-1719…-3" → suffixe court pour la lisibilité du label.
  const tail = id.split('-').pop() ?? id;
  return tail === id ? id.slice(0, 8) : `#${tail}`;
}

export interface SignalTargetOption {
  value: string;
  label: string;
}

/// Options du select `target` d'un SignalOut dans le contexte modulation
/// d'un move : macros + `param:<node_id>:<key>` pour chaque param
/// modulable de chaque node du graphe du move + `param:<Type>:<key>`
/// (type-wide) quand plusieurs instances du type existent.
export function signalTargetOptions(moveNodes: GraphNode[]): SignalTargetOption[] {
  const opts: SignalTargetOption[] = MACRO_TARGETS.map((m) => ({
    value: m,
    label: `Macro · ${m}`,
  }));
  const byType = new Map<string, GraphNode[]>();
  for (const n of moveNodes) {
    const t = n.data.type as NodeType | undefined;
    if (!t) continue;
    const list = byType.get(t) ?? [];
    list.push(n);
    byType.set(t, list);
  }
  for (const n of moveNodes) {
    const t = n.data.type as NodeType | undefined;
    const spec = t && NODE_SPECS.find((s) => s.node_type === t);
    if (!spec) continue;
    for (const p of spec.params) {
      if (!p.modulable) continue;
      opts.push({
        value: `param:${n.id}:${p.key}`,
        label: `${t} · ${p.label} (${shortId(n.id)})`,
      });
    }
  }
  for (const [t, nodes] of byType) {
    if (nodes.length < 2) continue;
    const spec = NODE_SPECS.find((s) => s.node_type === t);
    if (!spec) continue;
    for (const p of spec.params) {
      if (!p.modulable) continue;
      opts.push({
        value: `param:${t}:${p.key}`,
        label: `All ${t} · ${p.label}`,
      });
    }
  }
  return opts;
}

/// Clés des params de `node` ciblés par un SignalOut du graphe signal —
/// utilisé pour l'indicateur "modulé" sur les rows de params du sub-graph.
export function modulatedParamKeys(
  node: GraphNode,
  signalNodes: GraphNode[],
): Set<string> {
  const out = new Set<string>();
  const type = node.data.type;
  for (const n of signalNodes) {
    if (n.data.type !== 'SignalOut') continue;
    const target = n.data.params?.target;
    if (typeof target !== 'string' || !target.startsWith('param:')) continue;
    const rest = target.slice('param:'.length);
    const sep = rest.indexOf(':');
    if (sep < 0) continue;
    const seg = rest.slice(0, sep);
    const key = rest.slice(sep + 1);
    if (seg === node.id || seg === type) out.add(key);
  }
  return out;
}

/// Nettoie les cibles SignalOut qui référencent des nodes supprimés :
/// `param:<id>:<key>` → "" (sink inerte). Les cibles type-wide restent
/// valides tant qu'il reste une instance (le backend valide à la compile).
/// Retourne les nodes (inchangés si rien à nettoyer) + le nombre de
/// cibles effacées.
export function clearTargetsForRemovedNodes(
  signalNodes: GraphNode[],
  removedIds: Set<string>,
): { nodes: GraphNode[]; cleared: number } {
  let cleared = 0;
  const nodes = signalNodes.map((n) => {
    if (n.data.type !== 'SignalOut') return n;
    const target = n.data.params?.target;
    if (typeof target !== 'string' || !target.startsWith('param:')) return n;
    const seg = target.slice('param:'.length).split(':')[0];
    if (!removedIds.has(seg)) return n;
    cleared += 1;
    return {
      ...n,
      data: { ...n.data, params: { ...n.data.params, target: '' } },
    };
  });
  return { nodes, cleared };
}
