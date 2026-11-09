import React, { useCallback, useEffect } from 'react';
import { applyNodeChanges, applyEdgeChanges, MarkerType, type Connection, type Edge, type Node } from '@xyflow/react';

/// Factorise les handlers d'un graphe "standalone" (hors store sub) —
/// le pattern global/signal était dupliqué à l'identique dans NodeEditor
/// (S1) : applyNodeChanges → set, applyEdgeChanges → set, connect →
/// edge typée + flag, push débouncé quand le graphe est le tab actif.
///
/// `active` = le graphe est affiché — le push backend ne part que si la
/// surface le montre (sinon les nodes ne sont pas éditables).
export function useStandaloneGraph(opts: {
  nodes: Node[];
  edges: Edge[];
  setNodes: (n: Node[]) => void;
  setEdges: (e: Edge[]) => void;
  pushGraph: () => void;
  active: boolean;
  connectedThisDrop: React.MutableRefObject<boolean>;
}) {
  const { nodes, edges, setNodes, setEdges, pushGraph, active, connectedThisDrop } = opts;

  const onNodesChange = useCallback(
    (changes: Parameters<typeof applyNodeChanges>[0]) => {
      setNodes(applyNodeChanges(changes, nodes));
    },
    [nodes, setNodes],
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof applyEdgeChanges>[0]) => {
      setEdges(applyEdgeChanges(changes, edges));
    },
    [edges, setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      connectedThisDrop.current = true;
      // id avec handles — `${source}-${target}` seul collisionne quand
      // deux connexions relient les mêmes nodes sur des ports différents.
      const newEdge = {
        ...connection,
        id: `${connection.source}.${connection.sourceHandle ?? ''}-${connection.target}.${connection.targetHandle ?? ''}`,
        markerEnd: { type: MarkerType.ArrowClosed },
      };
      // Même sémantique que le store sub : un port d'entrée ne prend
      // qu'une edge — re-câbler dans un input occupé remplace l'existante.
      setEdges([
        ...edges.filter(
          (e) =>
            !(
              e.target === connection.target &&
              (e.targetHandle ?? null) === (connection.targetHandle ?? null)
            ),
        ),
        newEdge as Edge,
      ]);
    },
    [edges, setEdges, connectedThisDrop],
  );

  // Auto-push quand le graphe change (debounce) — seulement si le tab
  // est actif (sinon les nodes n'ont pas été édités via cette surface).
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => pushGraph(), 300);
    return () => clearTimeout(timer);
  }, [nodes, edges, active, pushGraph]);

  return { onNodesChange, onEdgesChange, onConnect };
}
