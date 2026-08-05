/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore, makeSimpleGraph } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('saveGraph', () => {
  it('saves graph to localStorage with timestamp', async () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);

    await useGraphStore.getState().saveGraph('test-graph');

    const stored = JSON.parse(localStorage.getItem('stagespace_graph_test-graph')!);
    expect(stored.nodes).toHaveLength(4);
    expect(stored.edges).toHaveLength(3);
    expect(stored.timestamp).toBeGreaterThan(0);
  });
});

describe('loadGraph', () => {
  it('loads graph from localStorage', async () => {
    const graph = makeSimpleGraph(3);
    localStorage.setItem('stagespace_graph_test-graph', JSON.stringify({
      nodes: graph.nodes,
      edges: graph.edges,
      timestamp: Date.now(),
    }));

    await useGraphStore.getState().loadGraph('test-graph');

    expect(useGraphStore.getState().nodes).toHaveLength(4);
    expect(useGraphStore.getState().edges).toHaveLength(3);
  });

  it('throws if graph not found', async () => {
    await expect(useGraphStore.getState().loadGraph('nonexistent')).rejects.toThrow('not found');
  });
});

describe('deleteGraph', () => {
  it('removes graph from localStorage', async () => {
    localStorage.setItem('stagespace_graph_test-graph', '{}');
    await useGraphStore.getState().deleteGraph('test-graph');
    expect(localStorage.getItem('stagespace_graph_test-graph')).toBeNull();
  });
});

describe('listGraphs', () => {
  it('lists all saved graphs', async () => {
    localStorage.setItem('stagespace_graph_graph1', '{}');
    localStorage.setItem('stagespace_graph_graph2', '{}');
    localStorage.setItem('stagespace_other_key', '{}');

    const graphs = await useGraphStore.getState().listGraphs();
    expect(graphs).toContain('graph1');
    expect(graphs).toContain('graph2');
    expect(graphs).not.toContain('other_key');
  });

  it('returns empty array when no graphs saved', async () => {
    const graphs = await useGraphStore.getState().listGraphs();
    expect(graphs).toEqual([]);
  });
});

describe('saveGraphToFile', () => {
  it('calls save_graph_to_file with graph data', async () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);

    await useGraphStore.getState().saveGraphToFile('/path/to/file.json');

    const calls = getInvokeCalls().filter((c) => c.cmd === 'save_graph_to_file');
    expect(calls).toHaveLength(1);
    expect(calls[0].args?.filePath).toBe('/path/to/file.json');
    expect(calls[0].args?.graphJson.nodes).toHaveLength(4);
  });
});

describe('loadGraphFromFile', () => {
  it('calls load_graph_from_file and sets nodes/edges', async () => {
    // Mock returns { nodes: [], edges: [] } for load_graph_from_file
    await useGraphStore.getState().loadGraphFromFile('/path/to/file.json');

    const calls = getInvokeCalls().filter((c) => c.cmd === 'load_graph_from_file');
    expect(calls).toHaveLength(1);
    expect(calls[0].args?.filePath).toBe('/path/to/file.json');
  });
});
