/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { snapshotSelection, cloneForPaste, serializeGraphClipboard, parseGraphClipboard, serializeSplineClipboard, parseSplineClipboard, serializePositionClipboard, parsePositionClipboard, serializeClipboard } from '../graphClipboard';
import { makeNode, makeEdge, makeSimpleGraph } from '../../store/__tests__/testHelpers';
import type { GraphNode } from '../../components/nodeParamSchema';
import type { Edge } from '@xyflow/react';

describe('snapshotSelection', () => {
  it('ne garde que les nodes sélectionnés et les edges internes', () => {
    const graph = makeSimpleGraph(3);
    const nodes: GraphNode[] = [
      { ...graph.nodes[0], selected: true },
      { ...graph.nodes[2], selected: true },
      graph.nodes[1], // dur-1 non sélectionné
      graph.nodes[3], // out-1 non sélectionné
    ];
    const snap = snapshotSelection(nodes, graph.edges as Edge[]);
    expect(snap.nodes).toHaveLength(2);
    // obj→eng interne, dur→eng et eng→out ne le sont pas
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].id).toBe('e-obj-1-eng-1');
  });

  it('strip le décor issueMessages et la sélection', () => {
    const n = {
      ...makeNode('n1', 'Circular', {}),
      selected: true,
      data: { label: 'Circular', type: 'Circular' as const, params: {}, issueMessages: ['boom'] },
    };
    const snap = snapshotSelection([n], []);
    expect(snap.nodes[0].selected).toBe(false);
    expect((snap.nodes[0].data as Record<string, unknown>).issueMessages).toBeUndefined();
  });
});

describe('cloneForPaste', () => {
  const payload = () => {
    const a = { ...makeNode('a', 'Circular', {}), selected: true, position: { x: 10, y: 20 } };
    const b = { ...makeNode('b', 'Output', {}), selected: true, position: { x: 300, y: 20 } };
    const e = { ...makeEdge('a', 'b', 'out', 'in'), id: 'e-a-b' };
    return { nodes: [a, b] as GraphNode[], edges: [e] as Edge[] };
  };

  it('nouveaux ids, offset +24, edges remappées', () => {
    const clip = cloneForPaste(payload(), 1000)!;
    expect(clip.nodes).toHaveLength(2);
    expect(clip.nodes[0].id).not.toBe('a');
    expect(clip.nodes[0].position).toEqual({ x: 34, y: 44 });
    expect(clip.edges).toHaveLength(1);
    expect(clip.edges[0].source).toBe(clip.nodes[0].id);
    expect(clip.edges[0].target).toBe(clip.nodes[1].id);
    // Le type/paramètres sont préservés — le clone est fonctionnel.
    expect(clip.nodes[0].data.type).toBe('Circular');
    // Les collés arrivent sélectionnés (retour visuel du patch).
    expect(clip.nodes.every((n) => n.selected)).toBe(true);
  });

  it('edge vers un node hors payload ignorée', () => {
    const p = payload();
    p.edges.push({ ...makeEdge('a', 'ghost', 'out', 'in'), id: 'e-a-ghost' });
    const clip = cloneForPaste(p, 1)!;
    expect(clip.edges).toHaveLength(1);
  });

  it('payload vide → null', () => {
    expect(cloneForPaste({ nodes: [], edges: [] }, 1)).toBeNull();
  });
});

describe('clipboard système — enveloppe JSON', () => {
  const graph = makeSimpleGraph(3);
  const payload = { nodes: graph.nodes, edges: graph.edges as Edge[] };

  it('serialize → parse round-trip graphe', () => {
    const parsed = parseGraphClipboard(serializeGraphClipboard(payload));
    expect(parsed?.nodes).toHaveLength(payload.nodes.length);
    expect(parsed?.edges).toHaveLength(payload.edges.length);
  });

  it('rejette les textes hors format / mauvaise version / JSON cassé', () => {
    expect(parseGraphClipboard('hello world')).toBeNull();
    expect(parseGraphClipboard('{"app":"stagespace","v":99,"kind":"graph","payload":{"nodes":[]}}')).toBeNull();
    expect(parseGraphClipboard('{"app":"other","v":1,"kind":"graph","payload":{"nodes":[]}}')).toBeNull();
    // kind mismatch : une payload spline passée au parser graphe
    expect(parseGraphClipboard(serializeSplineClipboard({ points: [[0,0,0],[1,1,1]], closed: false }))).toBeNull();
  });

  it('rejette les payloads structurellement invalides', () => {
    const bad = serializeClipboard('graph', { nodes: [{ id: 1 }] });
    expect(parseGraphClipboard(bad)).toBeNull();
    const noNodes = serializeClipboard('graph', { nodes: [] });
    expect(parseGraphClipboard(noNodes)).toBeNull();
  });

  it('spline : round-trip + validation', () => {
    const spl = { points: [[0, 0, 0], [1, 0, 1], [2, 0, 0]] as [number, number, number][], closed: true };
    const parsed = parseSplineClipboard(serializeSplineClipboard(spl));
    expect(parsed?.closed).toBe(true);
    expect(parsed?.points).toHaveLength(3);
    expect(parseSplineClipboard('junk')).toBeNull();
    expect(parseSplineClipboard(serializeClipboard('spline', { points: [[0, 0, 0]], closed: false }))).toBeNull(); // <2 pts
    expect(parseSplineClipboard(serializeClipboard('spline', { points: [[0, 'x', 0], [1, 1, 1]], closed: false }))).toBeNull(); // NaN
  });

  it('position : round-trip + validation', () => {
    const parsed = parsePositionClipboard(serializePositionClipboard([1.5, -2, 0.25]));
    expect(parsed).toEqual([1.5, -2, 0.25]);
    expect(parsePositionClipboard('junk')).toBeNull();
    expect(parsePositionClipboard(serializeClipboard('position', { pos: [1, 2] }))).toBeNull();
  });
});
