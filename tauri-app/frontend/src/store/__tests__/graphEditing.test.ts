/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore, makeNode, makeEdge, makeSimpleGraph } from './testHelpers';

beforeEach(() => {
  resetStore();
});

/// addNodesAndEdges — wire-drop→quick-add auto-connect, paste, duplicate.
/// Atomique : une seule entrée d'historique pour nodes+edges.
describe('addNodesAndEdges', () => {
  it('ajoute nodes et edges en une opération', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    const scale = makeNode('scale-1', 'Scale', { factor: 1.5 });
    const edge = makeEdge('eng-1', 'scale-1', 'out', 'in') as any;
    useGraphStore.getState().addNodesAndEdges([scale], [edge]);
    const s = useGraphStore.getState();
    expect(s.nodes.some((n) => n.id === 'scale-1')).toBe(true);
    expect(s.edges.some((e) => e.target === 'scale-1' && e.source === 'eng-1')).toBe(true);
  });

  it('un input occupé → l\'edge existante est remplacée', () => {
    const graph = makeSimpleGraph(3);
    // Une 2e source Positions alimente out-1.in déjà occupé par eng-1.
    const eng2 = makeNode('eng-2', 'Lissajous', {});
    useGraphStore.setState({
      nodes: [...graph.nodes, eng2],
      edges: graph.edges,
    } as any);
    useGraphStore.getState().addNodesAndEdges(
      [],
      [makeEdge('eng-2', 'out-1', 'out', 'in') as any],
    );
    const s = useGraphStore.getState();
    const incoming = s.edges.filter((e) => e.target === 'out-1' && e.targetHandle === 'in');
    expect(incoming).toHaveLength(1);
    expect(incoming[0].source).toBe('eng-2');
  });

  it('atomique : une entrée d\'historique — undo restaure nodes+edges', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);
    useGraphStore.getState().pushHistory(); // baseline
    useGraphStore.getState().addNodesAndEdges(
      [makeNode('scale-1', 'Scale', {})],
      [makeEdge('eng-1', 'scale-1', 'out', 'in') as any],
    );
    useGraphStore.getState().undo();
    const s = useGraphStore.getState();
    expect(s.nodes.some((n) => n.id === 'scale-1')).toBe(false);
    expect(s.edges).toHaveLength(graph.edges.length);
  });
});

/// reconnectEdge — drag du endpoint d'une edge vers une autre cible.
describe('reconnectEdge', () => {
  it('remplace l\'edge par la nouvelle connexion', () => {
    const graph = makeSimpleGraph(3);
    const out2 = makeNode('out-2', 'Output', {});
    useGraphStore.setState({
      nodes: [...graph.nodes, out2],
      edges: graph.edges,
    } as any);
    const old = graph.edges.find((e) => e.id === 'e-eng-1-out-1')!;
    useGraphStore.getState().reconnectEdge(old.id, {
      source: 'eng-1', sourceHandle: 'out', target: 'out-2', targetHandle: 'in',
    });
    const s = useGraphStore.getState();
    expect(s.edges.some((e) => e.id === old.id)).toBe(false);
    expect(s.edges.some((e) => e.source === 'eng-1' && e.target === 'out-2')).toBe(true);
  });

  it('reconnect sur un input occupé remplace l\'edge qui y était', () => {
    const graph = makeSimpleGraph(3);
    const eng2 = makeNode('eng-2', 'Spiral', {});
    const out2 = makeNode('out-2', 'Output', {});
    const e2orig = { ...makeEdge('eng-2', 'out-2', 'out', 'in'), id: 'e-eng-2-out-2' } as any;
    useGraphStore.setState({
      nodes: [...graph.nodes, eng2, out2],
      edges: [...graph.edges, e2orig],
    } as any);
    useGraphStore.getState().reconnectEdge('e-eng-2-out-2', {
      source: 'eng-2', sourceHandle: 'out', target: 'out-1', targetHandle: 'in',
    });
    const s = useGraphStore.getState();
    const incoming = s.edges.filter((e) => e.target === 'out-1' && e.targetHandle === 'in');
    expect(incoming).toHaveLength(1);
    expect(incoming[0].source).toBe('eng-2');
    expect(s.edges.some((e) => e.id === 'e-eng-2-out-2')).toBe(false);
  });

  it('atomique : undo restaure l\'edge originale', () => {
    const graph = makeSimpleGraph(3);
    const out2 = makeNode('out-2', 'Output', {});
    useGraphStore.setState({
      nodes: [...graph.nodes, out2],
      edges: graph.edges,
    } as any);
    useGraphStore.getState().pushHistory(); // baseline
    const old = graph.edges.find((e) => e.id === 'e-eng-1-out-1')!;
    useGraphStore.getState().reconnectEdge(old.id, {
      source: 'eng-1', sourceHandle: 'out', target: 'out-2', targetHandle: 'in',
    });
    useGraphStore.getState().undo();
    const s = useGraphStore.getState();
    expect(s.edges.some((e) => e.id === 'e-eng-1-out-1')).toBe(true);
    expect(s.edges.some((e) => e.target === 'out-2')).toBe(false);
  });
});
