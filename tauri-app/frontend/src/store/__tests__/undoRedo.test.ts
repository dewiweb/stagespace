/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore, makeNode, makeSimpleGraph } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('pushHistory', () => {
  it('creates a snapshot of the current graph', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);

    useGraphStore.getState().pushHistory();

    const history = (useGraphStore.getState() as any)._history;
    expect(history).toHaveLength(1);
    expect(history[0].nodes).toHaveLength(4);
    expect(history[0].edges).toHaveLength(3);
  });

  it('creates a deep copy (not a reference)', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({ nodes: graph.nodes, edges: graph.edges } as any);

    useGraphStore.getState().pushHistory();

    const history = (useGraphStore.getState() as any)._history;
    expect(history[0].nodes).not.toBe(graph.nodes);
  });

  it('limits to 50 entries', () => {
    useGraphStore.setState({ nodes: [], edges: [] } as any);

    for (let i = 0; i < 60; i++) {
      useGraphStore.getState().pushHistory();
    }

    const history = (useGraphStore.getState() as any)._history;
    expect(history.length).toBeLessThanOrEqual(50);
  });

  it('truncates redo history when pushing after undo', () => {
    // Push 3 snapshots
    useGraphStore.setState({ nodes: [makeNode('n1', 'Objects')], edges: [] } as any);
    useGraphStore.getState().pushHistory();
    useGraphStore.setState({ nodes: [makeNode('n1', 'Objects'), makeNode('n2', 'Output')], edges: [] } as any);
    useGraphStore.getState().pushHistory();
    useGraphStore.setState({ nodes: [makeNode('n1', 'Objects'), makeNode('n2', 'Output'), makeNode('n3', 'Scale')], edges: [] } as any);
    useGraphStore.getState().pushHistory();

    // Undo twice
    useGraphStore.getState().undo();
    useGraphStore.getState().undo();

    expect((useGraphStore.getState() as any)._historyIndex).toBe(0);

    // Push a new snapshot — should truncate the redo history
    useGraphStore.setState({ nodes: [makeNode('n4', 'Circular')], edges: [] } as any);
    useGraphStore.getState().pushHistory();

    const history = (useGraphStore.getState() as any)._history;
    expect(history).toHaveLength(2); // snapshot 0 + new snapshot
    expect((useGraphStore.getState() as any).canRedo).toBe(false);
  });
});

describe('undo', () => {
  it('restores previous graph state', () => {
    const graph1 = makeSimpleGraph(3);
    const graph2 = makeSimpleGraph(5);

    useGraphStore.setState({ nodes: graph1.nodes, edges: graph1.edges } as any);
    useGraphStore.getState().pushHistory(); // history[0] = graph1
    useGraphStore.setState({ nodes: graph2.nodes, edges: graph2.edges } as any);
    useGraphStore.getState().pushHistory(); // history[1] = graph2, index=1

    // Undo → index goes from 1 to 0, restores graph1 (n_objects=3)
    useGraphStore.getState().undo();

    const obj = useGraphStore.getState().nodes.find((n: any) => (n.data as any)?.type === 'Objects');
    expect((obj!.data as any).params.n_objects).toBe(3);
  });

  it('does nothing when at history start', () => {
    useGraphStore.setState({ nodes: [], edges: [] } as any);
    useGraphStore.getState().pushHistory();

    const beforeState = useGraphStore.getState().nodes;
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toBe(beforeState);
  });

  it('sets canRedo to true after undo', () => {
    const graph1 = makeSimpleGraph(3);
    const graph2 = makeSimpleGraph(5);
    useGraphStore.setState({ nodes: graph1.nodes, edges: graph1.edges } as any);
    useGraphStore.getState().pushHistory();
    useGraphStore.setState({ nodes: graph2.nodes, edges: graph2.edges } as any);
    useGraphStore.getState().pushHistory();

    useGraphStore.getState().undo();
    expect((useGraphStore.getState() as any).canRedo).toBe(true);
  });
});

describe('redo', () => {
  it('restores next graph state after undo', () => {
    const graph1 = makeSimpleGraph(3);
    const graph2 = makeSimpleGraph(5);

    useGraphStore.setState({ nodes: graph1.nodes, edges: graph1.edges } as any);
    useGraphStore.getState().pushHistory(); // history[0] = graph1
    useGraphStore.setState({ nodes: graph2.nodes, edges: graph2.edges } as any);
    useGraphStore.getState().pushHistory(); // history[1] = graph2, index=1

    // Undo → index 0 (graph1), redo → index 1 (graph2)
    useGraphStore.getState().undo();
    useGraphStore.getState().redo();

    // After redo, we should be back at graph2 (n_objects=5)
    const obj = useGraphStore.getState().nodes.find((n: any) => (n.data as any)?.type === 'Objects');
    expect((obj!.data as any).params.n_objects).toBe(5);
  });

  it('does nothing when at history end', () => {
    useGraphStore.setState({ nodes: [], edges: [] } as any);
    useGraphStore.getState().pushHistory();

    useGraphStore.getState().redo();
    // No change
    expect((useGraphStore.getState() as any)._historyIndex).toBe(0);
  });
});

describe('undo/redo interaction with slot switch', () => {
  it('undo after slot switch does NOT restore a different slot graph', () => {
    const graph1 = makeSimpleGraph(3);
    const graph2 = makeSimpleGraph(5);

    // Setup two slots
    useGraphStore.setState({
      moveSlots: [
        { id: 'slot-1', name: 'M1', graphJson: graph1, templateId: 'c', trackIds: [1], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 },
        { id: 'slot-2', name: 'M2', graphJson: graph2, templateId: 'c', trackIds: [2], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 },
      ],
    } as any);

    // Edit slot 1 and push history
    useGraphStore.getState().selectSlotForEditing('slot-1');
    useGraphStore.getState().pushHistory();
    expect((useGraphStore.getState() as any)._history.length).toBeGreaterThan(0);

    // Switch to slot 2 — history should be reset
    useGraphStore.getState().selectSlotForEditing('slot-2');
    expect((useGraphStore.getState() as any)._history).toHaveLength(0);

    // Undo should do nothing (no history for this slot)
    const nodesBefore = useGraphStore.getState().nodes;
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toBe(nodesBefore);
  });
});
