import type { Node } from '@xyflow/react';

/// Nodes « frame » — décoration UI pure (annotation + regroupement
/// visuel, pattern patcher). Le NodeType Rust est un enum fermé :
/// `data.type === 'Frame'` ferait échouer build_graph_from_json → les
/// frames doivent être filtrés de TOUT payload backend (sérialisation,
/// diagnose, push global/signal). Côté canvas ils vivent comme nodes RF
/// ordinaires (drag, resize via NodeResizer, undo, clipboard, delete) —
/// sans handles, donc jamais câblables.
export const FRAME_NODE_TYPE = 'frame';
export const FRAME_DATA_TYPE = 'Frame';

export function isFrameNode(n: Pick<Node, 'type' | 'data'>): boolean {
  return n.type === FRAME_NODE_TYPE || n.data?.type === FRAME_DATA_TYPE;
}

/// Retire les frames + leurs (hypothétiques) edges d'un graphe avant tout
/// envoi au backend. `prepareGraphForSave`, les push standalone et le
/// diagnose passent tous par ici.
export function stripFrames<N extends { id: string; type?: string; data?: { type?: string } }, E extends { source: string; target: string }>(
  nodes: N[],
  edges: E[],
): { nodes: N[]; edges: E[] } {
  const kept = nodes.filter((n) => !isFrameNode(n as Pick<Node, 'type' | 'data'>));
  const ids = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}
