import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';
import nodeSpecs from '../types/generated/nodeSpecs.json';

/// Types valides = le catalogue généré (source unique — ts-rs).
const VALID_TYPES = new Set(nodeSpecs.map((s: { node_type: string }) => s.node_type));

/// Renommages/suppressions de types entre versions de graphes persistés.
/// `Input` a été absorbé par `Merge` lors du refactor des ports.
const TYPE_MIGRATIONS: Record<string, string> = {
  Input: 'Merge',
};

/// Normalise un graphe chargé du stockage : migre les types renommés,
/// drop les nodes devenus inconnus + leurs edges. Retourne null si le
/// graphe est irrécupérable (tous les nodes drop).
export function migrateStoredGraph(
  parsed: { nodes: GraphNode[]; edges: Edge[] } | null,
  logTag: string,
): { nodes: GraphNode[]; edges: Edge[] } | null {
  if (!parsed?.nodes || !parsed?.edges) return null;

  const nodes: GraphNode[] = [];
  const dropped = new Set<string>();
  for (const n of parsed.nodes) {
    const t = n.data?.type as string | undefined;
    const migrated = t ? TYPE_MIGRATIONS[t] ?? t : t;
    if (t && migrated !== t) {
      console.warn(`[${logTag}] node ${n.id}: type '${t}' migrated → '${migrated}'`);
      nodes.push({ ...n, data: { ...n.data, type: migrated } } as GraphNode);
    } else if (t && !VALID_TYPES.has(t)) {
      console.warn(`[${logTag}] node ${n.id}: unknown type '${t}' dropped`);
      dropped.add(n.id);
    } else {
      nodes.push(n);
    }
  }
  if (nodes.length === 0) return null;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = parsed.edges.filter(
    (e: Edge) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  return { nodes, edges };
}
