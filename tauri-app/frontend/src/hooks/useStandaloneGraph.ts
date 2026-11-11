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
  /// Undo/redo du store standalone (historique burst-fusionnée côté store).
  undo: () => void;
  redo: () => void;
}) {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    pushGraph,
    active,
    connectedThisDrop,
    undo,
    redo,
  } = opts;

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

  // Drag du endpoint d'une edge vers une autre cible — remplace l'edge
  // (même règle "un input = une edge" que onConnect).
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      setEdges([
        ...edges.filter(
          (e) =>
            e.id !== oldEdge.id &&
            !(
              e.target === connection.target &&
              (e.targetHandle ?? null) === (connection.targetHandle ?? null)
            ),
        ),
        {
          ...connection,
          id: `${connection.source}.${connection.sourceHandle ?? ''}-${connection.target}.${connection.targetHandle ?? ''}`,
          markerEnd: { type: MarkerType.ArrowClosed },
        } as Edge,
      ]);
    },
    [edges, setEdges],
  );

  // Undo/redo — document-level (bubbling avant le listener window de
  // useLiveShortcuts : le preventDefault le fait passer). Sans effet
  // quand le tab n'est pas actif — le store sub garde ses propres
  // raccourcis.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, undo, redo]);

  // Auto-push quand le graphe change (debounce) — seulement si le tab
  // est actif (sinon les nodes n'ont pas été édités via cette surface).
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => pushGraph(), 300);
    return () => clearTimeout(timer);
  }, [nodes, edges, active, pushGraph]);

  return { onNodesChange, onEdgesChange, onConnect, onReconnect };
}
