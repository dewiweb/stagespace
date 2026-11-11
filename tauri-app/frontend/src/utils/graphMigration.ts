import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';
import { isFrameNode } from './frameNode';
import nodeSpecs from '../types/generated/nodeSpecs.json';

/// Types valides + specs = le catalogue généré (source unique — ts-rs).
interface PortSpec { name: string; port_type: string; }
interface NodeSpec { node_type: string; inputs: PortSpec[]; outputs: PortSpec[]; }
const SPECS = new Map((nodeSpecs as NodeSpec[]).map((s) => [s.node_type, s]));
const VALID_TYPES = new Set(SPECS.keys());

/// Renommages/suppressions de types entre versions de graphes persistés.
/// `Input` a été absorbé par `Merge` lors du refactor des ports.
const TYPE_MIGRATIONS: Record<string, string> = {
  Input: 'Merge',
};

/// Les anciens graphes utilisaient des handles génériques 'output'/'input' ;
/// le nouveau schéma a des ports nommés par type (objects, duration, out, in).
function resolveSourceHandle(type: string | undefined, handle: string | null | undefined): string {
  if (!type) return handle ?? 'out';
  const outs = SPECS.get(type)?.outputs ?? [];
  if (outs.some((o) => o.name === handle)) return handle as string;
  // 'output' générique ou handle inconnu → le seul port de sortie, ou 'out'.
  if (outs.length === 1) return outs[0].name;
  return outs.find((o) => o.name === 'out')?.name ?? outs[0]?.name ?? 'out';
}

function resolveTargetHandle(
  targetType: string | undefined,
  handle: string | null | undefined,
  sourceType: string | undefined,
  sourceHandle: string,
): string {
  if (!targetType) return handle ?? 'in';
  const ins = SPECS.get(targetType)?.inputs ?? [];
  if (ins.some((i) => i.name === handle)) return handle as string;
  // Matcher par type de port : la sortie de la source dit quel canal viser
  // (Objects.objects→ObjectSet, Duration.duration→Duration, x.out→Positions).
  const srcPortType = (SPECS.get(sourceType as string)?.outputs ?? [])
    .find((o) => o.name === sourceHandle)?.port_type;
  if (srcPortType) {
    const match = ins.find((i) => i.port_type === srcPortType);
    if (match) return match.name;
  }
  if (ins.length === 1) return ins[0].name;
  return handle ?? 'in';
}

/// Normalise un graphe chargé du stockage : migre les types renommés,
/// drop les nodes devenus inconnus + leurs edges, et remappe les handles
/// génériques 'output'/'input' vers les ports typés du schéma actuel.
/// Retourne null si le graphe est irrécupérable.
export function migrateStoredGraph(
  parsed: { nodes: GraphNode[]; edges: Edge[] } | null,
  logTag: string,
): { nodes: GraphNode[]; edges: Edge[] } | null {
  if (!parsed?.nodes || !parsed?.edges) return null;

  const nodes: GraphNode[] = [];
  const dropped = new Set<string>();
  for (const n of parsed.nodes) {
    // Les frames sont des annotations UI — pas un NodeType backend, mais
    // persistantes dans le .hfg (le parser Rust les ignore : node_type
    // est Option<String>, validé au compile où elles sont filtrées).
    if (isFrameNode(n)) {
      nodes.push(n);
      continue;
    }
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

  const typeById = new Map(nodes.map((n) => [n.id, n.data?.type as string | undefined]));
  const edges: Edge[] = [];
  for (const e of parsed.edges) {
    if (!typeById.has(e.source) || !typeById.has(e.target)) continue;
    const sourceHandle = resolveSourceHandle(typeById.get(e.source), e.sourceHandle);
    const targetHandle = resolveTargetHandle(
      typeById.get(e.target), e.targetHandle,
      typeById.get(e.source), sourceHandle,
    );
    if (sourceHandle !== e.sourceHandle || targetHandle !== e.targetHandle) {
      console.warn(`[${logTag}] edge ${e.id}: handles remapped ${e.sourceHandle ?? '?'}→${sourceHandle} / ${e.targetHandle ?? '?'}→${targetHandle}`);
    }
    edges.push({ ...e, sourceHandle, targetHandle });
  }
  return { nodes, edges };
}
