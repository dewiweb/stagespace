/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore, makeNode, makeSimpleGraph } from './testHelpers';

beforeEach(() => {
  resetStore();
});

/// Autopatch — l'action store remplace une edge par deux, atomiquement.
describe('insertNodeOnEdge', () => {
  const splice = () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    const old = useGraphStore.getState().edges.find((e) => e.id === 'e-eng-1-out-1')!;
    const inserted = makeNode('scale-1', 'Scale', { factor: 1.5 });
    const edgeIn = {
      id: 'e-eng-1-scale-1-in', source: old.source, sourceHandle: old.sourceHandle,
      target: inserted.id, targetHandle: 'in',
    } as any;
    const edgeOut = {
      id: 'e-scale-1-out-1-out', source: inserted.id, sourceHandle: 'out',
      target: old.target, targetHandle: old.targetHandle,
    } as any;
    useGraphStore.getState().insertNodeOnEdge(inserted, old.id, edgeIn, edgeOut);
    return { inserted };
  };

  it('remplace l\'edge par source→node→target', () => {
    const { inserted } = splice();
    const s = useGraphStore.getState();
    expect(s.nodes.some((n) => n.id === inserted.id)).toBe(true);
    expect(s.edges.some((e) => e.id === 'e-eng-1-out-1')).toBe(false);
    const eIn = s.edges.find((e) => e.target === 'scale-1');
    const eOut = s.edges.find((e) => e.source === 'scale-1');
    expect(eIn?.source).toBe('eng-1');
    expect(eIn?.targetHandle).toBe('in');
    expect(eOut?.target).toBe('out-1');
    expect(eOut?.targetHandle).toBe('in');
    // Les autres edges sont préservées
    expect(s.edges).toHaveLength(4); // 3 - 1 + 2
  });

  it('atomique : une seule entrée d\'historique — undo restaure l\'edge originale', () => {
    // pushHistory snapshotne l'état AVANT l'action → le premier push sert de
    // baseline (undo exige historyIndex >= 1). On en pousse un avant le splice.
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    useGraphStore.getState().pushHistory(); // baseline
    splice();
    const s = useGraphStore.getState();
    s.undo();
    const restored = useGraphStore.getState();
    expect(restored.edges.some((e) => e.id === 'e-eng-1-out-1')).toBe(true);
    expect(restored.nodes.some((n) => n.id === 'scale-1')).toBe(false);
  });
});

/// Pin-to-Perform — `data.pinned` via updateNodeData (merge data, params
/// intacts), persisté dans le graphe du slot via auto-save.
describe('node pinned params', () => {
  it('updateNodeData écrit pinned sans toucher params', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    useGraphStore.getState().updateNodeData('eng-1', { pinned: ['radius', 'speed'] });
    const node = useGraphStore.getState().nodes.find((n) => n.id === 'eng-1')!;
    expect((node.data as any).pinned).toEqual(['radius', 'speed']);
    expect((node.data as any).params.radius).toBe(2.0);
  });

  it('unpin retire la clé ; pinned vide → undefined (pas de champ résiduel)', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    useGraphStore.getState().updateNodeData('eng-1', { pinned: ['radius'] });
    useGraphStore.getState().updateNodeData('eng-1', { pinned: undefined });
    const node = useGraphStore.getState().nodes.find((n) => n.id === 'eng-1')!;
    expect((node.data as any).pinned).toBeUndefined();
  });
});
