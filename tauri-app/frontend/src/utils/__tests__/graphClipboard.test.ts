/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { snapshotSelection, cloneForPaste } from '../graphClipboard';
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
