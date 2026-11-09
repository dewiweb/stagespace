/// <reference types="vitest/globals" />
import { describe, expect, it, vi } from 'vitest';
import { migrateStoredGraph } from '../graphMigration';
import type { GraphNode } from '../../components/nodeParamSchema';
import type { Edge } from '@xyflow/react';

// Verrouille la migration des graphes persistés : type renommé, type
// inconnu (drop + edges), handles génériques → ports typés.
const node = (id: string, type: string): GraphNode =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { type, label: type, params: {} } }) as GraphNode;

const edge = (id: string, source: string, target: string, sourceHandle = 'output', targetHandle = 'input'): Edge =>
  ({ id, source, target, sourceHandle, targetHandle }) as Edge;

describe('migrateStoredGraph', () => {
  it('returns null for missing/empty graphs', () => {
    expect(migrateStoredGraph(null, 't')).toBeNull();
    expect(migrateStoredGraph({ nodes: [], edges: [] }, 't')).toBeNull();
  });

  it('migrates renamed type Input → Merge', () => {
    const res = migrateStoredGraph(
      { nodes: [node('n1', 'Input'), node('n2', 'Output')], edges: [edge('e1', 'n1', 'n2')] },
      't',
    );
    expect(res?.nodes[0].data.type).toBe('Merge');
  });

  it('drops unknown node types + their edges', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = migrateStoredGraph(
      {
        nodes: [node('a', 'Objects'), node('b', 'UnknownEngine'), node('c', 'Output')],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')],
      },
      't',
    );
    expect(res?.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(res?.edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('returns null when every node is unknown', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      migrateStoredGraph({ nodes: [node('a', 'Gone'), node('b', 'GoneToo')], edges: [] }, 't'),
    ).toBeNull();
  });

  it('remaps generic handles to typed ports (Objects→Circular→Output)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = migrateStoredGraph(
      {
        nodes: [node('o', 'Objects'), node('c', 'Circular'), node('out', 'Output')],
        edges: [edge('e1', 'o', 'c'), edge('e2', 'c', 'out')],
      },
      't',
    );
    expect(res?.edges[0].sourceHandle).toBe('objects'); // Objects: single typed out
    expect(res?.edges[0].targetHandle).toBe('objects'); // port_type ObjectSet matched
    expect(res?.edges[1].sourceHandle).toBe('out');
    expect(res?.edges[1].targetHandle).toBe('in');
  });

  it('matches target handle by port_type (Duration→Circular.duration)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = migrateStoredGraph(
      {
        nodes: [node('d', 'Duration'), node('c', 'Circular')],
        edges: [edge('e1', 'd', 'c')],
      },
      't',
    );
    expect(res?.edges[0].sourceHandle).toBe('duration');
    expect(res?.edges[0].targetHandle).toBe('duration'); // matched by Duration port_type, not 'objects'
  });

  it('keeps already-valid handles untouched', () => {
    const res = migrateStoredGraph(
      {
        nodes: [node('o', 'Objects'), node('c', 'Circular')],
        edges: [edge('e1', 'o', 'c', 'objects', 'objects')],
      },
      't',
    );
    expect(res?.edges[0].sourceHandle).toBe('objects');
    expect(res?.edges[0].targetHandle).toBe('objects');
  });
});
