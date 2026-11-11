import { MarkerType, type Node, type Edge } from '@xyflow/react';
import type { NodeType } from '../store/useGraphStore';
import type { GraphNode } from '../components/nodeParamSchema';
import type { PluginKind } from '../types/generated/PluginKind';
import { inputPortType, outputPortType } from './connectionRules';

/// « Recoudre » la chaîne à la suppression (sémantique plugdata) : un
/// node retiré qui avait exactement UNE edge entrante et UNE edge
/// sortante laisse ses deux voisins recâblés — si et seulement si les
/// types de port correspondent (sinon la reconnexion serait invalide).
///
/// Les suppressions multi-nodes et les nodes à >1 voisin d'un côté sont
/// ambigus → pas de heal. Les nodes sans edge (frames, isolés) passent
/// naturellement à travers.
export function healEdgesForRemoval(
  removedIds: Set<string>,
  nodes: Node[],
  edges: Edge[],
  pluginKindOf: (n: GraphNode | undefined) => PluginKind | undefined,
): Edge[] {
  const heals: Edge[] = [];
  for (const id of removedIds) {
    const incoming = edges.filter(
      (e) => e.target === id && !removedIds.has(e.source),
    );
    const outgoing = edges.filter(
      (e) => e.source === id && !removedIds.has(e.target),
    );
    if (incoming.length !== 1 || outgoing.length !== 1) continue;
    const [ein, eout] = [incoming[0], outgoing[0]];
    const src = nodes.find((n) => n.id === ein.source);
    const dst = nodes.find((n) => n.id === eout.target);
    if (!src || !dst) continue;
    const outT = outputPortType(
      src.data.type as NodeType,
      ein.sourceHandle ?? 'out',
    );
    const inT = inputPortType(
      dst.data.type as NodeType,
      eout.targetHandle ?? 'in',
      pluginKindOf(dst as GraphNode),
    );
    if (!outT || outT !== inT) continue;
    heals.push({
      id: `${ein.source}.${ein.sourceHandle ?? ''}-${eout.target}.${eout.targetHandle ?? ''}`,
      source: ein.source,
      sourceHandle: ein.sourceHandle,
      target: eout.target,
      targetHandle: eout.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  }
  return heals;
}
