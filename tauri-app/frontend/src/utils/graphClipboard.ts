import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../components/nodeParamSchema';

/// Clipboard module-level — la copie survit au switch de tab (sub/global/
/// signal) comme dans un patcher : copier une chaîne d'un graphe, coller
/// dans un autre. Pas de localStorage : la payload est éphémère, session.
export interface GraphClipboardPayload {
  nodes: GraphNode[];
  edges: Edge[];
}

let clipboard: GraphClipboardPayload | null = null;

export function writeGraphClipboard(payload: GraphClipboardPayload): void {
  clipboard = payload;
}

export function readGraphClipboard(): GraphClipboardPayload | null {
  return clipboard;
}

/// Snapshot sérialisé de la sélection — nodes + edges internes uniquement
/// (une edge vers un node hors sélection ne se colle pas). `issueMessages`
/// est un décor injecté par le polling diagnostics — jamais persisté.
export function snapshotSelection(nodes: GraphNode[], edges: Edge[]): GraphClipboardPayload {
  const sel = nodes.filter((n) => n.selected);
  const ids = new Set(sel.map((n) => n.id));
  return {
    nodes: sel.map((n) =>
      JSON.parse(JSON.stringify({ ...n, selected: false, data: { ...n.data, issueMessages: undefined } })),
    ),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => JSON.parse(JSON.stringify({ ...e, selected: false }))),
  };
}

/// Clone la payload avec des ids frais et un offset visuel — remap des
/// références d'edges. Retourne null sur payload vide.
export function cloneForPaste(
  payload: GraphClipboardPayload,
  stamp: number,
): GraphClipboardPayload | null {
  if (payload.nodes.length === 0) return null;
  const idMap = new Map<string, string>();
  const nodes = payload.nodes.map((n, i) => {
    const nid = `${n.data.type}-${stamp}-${i}`;
    idMap.set(n.id, nid);
    return {
      ...JSON.parse(JSON.stringify(n)),
      id: nid,
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      selected: true,
    } as GraphNode;
  });
  const edges = payload.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}.${e.sourceHandle ?? ''}-${idMap.get(e.target)}.${e.targetHandle ?? ''}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      selected: false,
    }));
  return { nodes, edges };
}
