/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore,
  getInvokeCalls,
  resetStore,
  makeSimpleGraph,
  makeSlot,
  setInvokeResponse,
} from './testHelpers';
import { useCuelistStore } from '../useCuelistStore';

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

// ─── Show file v2 (format stagespace-show) ───

describe('saveGraphToFile v2 — show complet', () => {
  it('saves slots, cues, osc config and spatial fx in the envelope', async () => {
    const slot = makeSlot({ id: 'slot-a', name: 'Circle A' });
    useGraphStore.setState({
      nodes: makeSimpleGraph(2).nodes,
      edges: makeSimpleGraph(2).edges,
      moveSlots: [slot],
      setlistOrder: ['slot-a'],
      editingSlotId: 'slot-a',
      oscAddress: '10.0.0.5',
      oscPort: 7000,
      oscProfile: 'iem',
      oscInPort: 8123,
      zones: [
        {
          shape: { shape: 'sphere', center: [0, 0, 0], radius: 2 },
          falloff: 1.5,
          channels: { gain: 0.5 },
          objects: null,
          enabled: true,
        },
      ],
      kinematicSmoothing: 0.7,
    } as any);
    useCuelistStore.setState({
      cues: [{ id: 'cue-1', name: 'Opening' } as any],
    });

    await useGraphStore.getState().saveGraphToFile('/tmp/show.hfg');

    const call = getInvokeCalls().find((c) => c.cmd === 'save_graph_to_file');
    const env = call?.args?.graphJson;
    expect(env.format).toBe('stagespace-show');
    expect(env.version).toBe(2);
    expect(env.slots).toHaveLength(1);
    expect(env.slots[0].id).toBe('slot-a');
    expect(env.cues).toHaveLength(1);
    expect(env.osc).toEqual({
      oscAddress: '10.0.0.5',
      oscPort: 7000,
      oscProfile: 'iem',
      oscInPort: 8123,
    });
    expect(env.spatialFx.zones).toHaveLength(1);
    expect(env.spatialFx.kinematicSmoothing).toBe(0.7);
    expect(env.tracks.manualOscIds.length).toBeGreaterThan(0);
  });
});

describe('loadGraphFromFile v2 — restore complet', () => {
  it('restores slots, cues and osc config from a v2 show file', async () => {
    const slot = makeSlot({ id: 'slot-b', name: 'Spiral B' });
    const graph = makeSimpleGraph(4);
    setInvokeResponse('load_graph_from_file', {
      format: 'stagespace-show',
      version: 2,
      savedAt: 123,
      nodes: graph.nodes,
      edges: graph.edges,
      slots: [slot],
      setlistOrder: ['slot-b'],
      editingSlotId: 'slot-b',
      cues: [{ id: 'cue-x', name: 'Finale' }],
      osc: { oscAddress: '192.168.1.10', oscPort: 8000, oscProfile: 'holophonix', oscInPort: 9000 },
      tracks: {
        holProject: null,
        manualOscIds: [1, 2, 3],
        manualPositions: { 1: [0, 0, 0] },
        selectedTrackIds: [1, 2],
      },
    });

    await useGraphStore.getState().loadGraphFromFile('/tmp/show.hfg');

    const s = useGraphStore.getState();
    expect(s.nodes).toHaveLength(4);
    expect(s.moveSlots).toHaveLength(1);
    expect(s.moveSlots[0].name).toBe('Spiral B');
    expect(s.editingSlotId).toBe('slot-b');
    expect(s.oscAddress).toBe('192.168.1.10');
    expect(s.manualOscIds).toEqual([1, 2, 3]);
    expect(Array.from(s.selectedTrackIds)).toEqual([1, 2]);
    expect(useCuelistStore.getState().cues[0]?.name).toBe('Finale');
    // Config OSC poussée au backend
    const oscPush = getInvokeCalls().find((c) => c.cmd === 'set_osc_output');
    expect(oscPush?.args?.address).toBe('192.168.1.10');
    // Slots persistés
    expect(localStorage.getItem('stagespace-move-slots')).not.toBeNull();
  });

  it('refuses to load a show while playback is active', async () => {
    useGraphStore.setState({ movements: [{ id: 'mv-1' }] } as any);
    await expect(
      useGraphStore.getState().loadGraphFromFile('/tmp/show.hfg'),
    ).rejects.toThrow('playback');
  });

  it('still loads legacy v0/v1 graph-only files', async () => {
    const graph = makeSimpleGraph(2);
    // v1 enveloppe
    setInvokeResponse('load_graph_from_file', {
      format: 'stagespace-graph',
      version: 1,
      nodes: graph.nodes,
      edges: graph.edges,
    });
    await useGraphStore.getState().loadGraphFromFile('/tmp/old.hfg');
    expect(useGraphStore.getState().nodes).toHaveLength(4);

    // v0 brut
    setInvokeResponse('load_graph_from_file', { nodes: graph.nodes, edges: graph.edges });
    await useGraphStore.getState().loadGraphFromFile('/tmp/older.hfg');
    expect(useGraphStore.getState().nodes).toHaveLength(4);
  });

  it('rejects files newer than the supported version', async () => {
    setInvokeResponse('load_graph_from_file', {
      format: 'stagespace-show',
      version: 99,
      nodes: [],
      edges: [],
    });
    await expect(
      useGraphStore.getState().loadGraphFromFile('/tmp/future.hfg'),
    ).rejects.toThrow('newer than supported');
  });
});
