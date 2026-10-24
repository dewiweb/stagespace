/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore, mockAnimState, getInvokeCalls, clearInvokeCalls,
  resetStore, makeNode, makeSimpleGraph, setupEditingSlot,
} from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('autoSaveToEditingSlot', () => {
  it('saves nodes/edges to the editing slot after addNode', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    const newNode = makeNode('extra-1', 'Scale', { scale: 2.0 });
    useGraphStore.getState().addNode(newNode);

    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes).toHaveLength(5);
    expect(updatedSlot.graphJson.nodes.some((n: any) => n.id === 'extra-1')).toBe(true);
  });

  it('saves nodes/edges to the editing slot after removeNode', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    useGraphStore.getState().removeNode('eng-1');

    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes.some((n: any) => n.id === 'eng-1')).toBe(false);
    expect(updatedSlot.graphJson.edges.some((e: any) => e.source === 'eng-1' || e.target === 'eng-1')).toBe(false);
  });

  it('saves to localStorage', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    useGraphStore.getState().addNode(makeNode('extra-1', 'Scale', { scale: 2.0 }));

    const stored = JSON.parse(localStorage.getItem('stagespace-move-slots')!);
    expect(stored[0].graphJson.nodes).toHaveLength(5);
  });

  it('does NOT save when no slot is being edited', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({
      moveSlots: [{ id: 'slot-1', name: 'M', graphJson: graph, templateId: 'c', trackIds: [1], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 }],
      editingSlotId: null,
      nodes: JSON.parse(JSON.stringify(graph.nodes)),
      edges: JSON.parse(JSON.stringify(graph.edges)),
    } as any);

    useGraphStore.getState().addNode(makeNode('extra-1', 'Scale', { scale: 2.0 }));

    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes).toHaveLength(4);
  });
});

describe('updateGraphLive targeting', () => {
  it('hot-swaps ONLY the editing slot movement, not all active movements', async () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({
      moveSlots: [
        { id: 'slot-a', name: 'A', graphJson: graph, templateId: 'c', trackIds: [1], movementId: 'mv-a', isPreview: false, macros: {} as any, fadeDuration: 2 },
        { id: 'slot-b', name: 'B', graphJson: graph, templateId: 'c', trackIds: [2], movementId: 'mv-b', isPreview: false, macros: {} as any, fadeDuration: 2 },
      ],
      editingSlotId: 'slot-a',
      nodes: JSON.parse(JSON.stringify(graph.nodes)),
      edges: JSON.parse(JSON.stringify(graph.edges)),
      movements: [
        { id: 'mv-a', name: 'A', osc_ids: [1] },
        { id: 'mv-b', name: 'B', osc_ids: [2] },
      ],
      isPlaying: false,
    } as any);

    mockAnimState.activeMovementIds = ['mv-a', 'mv-b'];

    await useGraphStore.getState().updateGraphLive(0.3);

    const hotSwapCalls = getInvokeCalls().filter((c) => c.cmd === 'update_move_graph_merged');
    expect(hotSwapCalls).toHaveLength(1);
    expect(hotSwapCalls[0].args?.movementId).toBe('mv-a');
  });

  it('does NOT hot-swap when no slot is being edited', async () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({
      moveSlots: [],
      editingSlotId: null,
      nodes: JSON.parse(JSON.stringify(graph.nodes)),
      edges: JSON.parse(JSON.stringify(graph.edges)),
      movements: [{ id: 'mv-a', name: 'A', osc_ids: [1] }],
      isPlaying: false,
    } as any);

    mockAnimState.activeMovementIds = ['mv-a'];

    await useGraphStore.getState().updateGraphLive(0.3);

    const hotSwapCalls = getInvokeCalls().filter((c) => c.cmd === 'update_move_graph_merged');
    expect(hotSwapCalls).toHaveLength(0);
  });
});

describe('selectSlotForEditing', () => {
  it('loads the slot graph into the editor', () => {
    const graph = makeSimpleGraph(5);
    useGraphStore.setState({
      moveSlots: [{ id: 'slot-1', name: 'M', graphJson: graph, templateId: 'c', trackIds: [1,2,3,4,5], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 }],
    } as any);

    useGraphStore.getState().selectSlotForEditing('slot-1');

    expect((useGraphStore.getState() as any).editingSlotId).toBe('slot-1');
    expect(useGraphStore.getState().nodes).toHaveLength(4);
    expect(useGraphStore.getState().edges).toHaveLength(3);
    expect(useGraphStore.getState().nodes).not.toBe(graph.nodes);
  });

  it('resets undo/redo history on slot switch', () => {
    useGraphStore.setState({
      moveSlots: [
        { id: 'slot-1', name: 'M1', graphJson: makeSimpleGraph(3), templateId: 'c', trackIds: [1], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 },
        { id: 'slot-2', name: 'M2', graphJson: makeSimpleGraph(5), templateId: 'c', trackIds: [2], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 },
      ],
    } as any);

    useGraphStore.getState().selectSlotForEditing('slot-1');
    useGraphStore.getState().pushHistory();
    useGraphStore.getState().pushHistory();
    expect((useGraphStore.getState() as any)._history.length).toBeGreaterThan(0);

    useGraphStore.getState().selectSlotForEditing('slot-2');
    // Baseline : l'entrée 0 = le graphe du slot 2 (premier edit undoable),
    // mais rien à undo tant qu'on est sur la baseline.
    expect((useGraphStore.getState() as any)._history).toHaveLength(1);
    expect((useGraphStore.getState() as any)._historyIndex).toBe(0);
    expect((useGraphStore.getState() as any).canUndo).toBe(false);
    expect((useGraphStore.getState() as any).canRedo).toBe(false);
  });

  it('syncs selectedTrackIds with the slot tracks', () => {
    useGraphStore.setState({
      moveSlots: [{ id: 'slot-1', name: 'M', graphJson: makeSimpleGraph(3), templateId: 'c', trackIds: [10, 20, 30], movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 }],
    } as any);
    useGraphStore.getState().selectSlotForEditing('slot-1');

    const trackIds = Array.from((useGraphStore.getState() as any).selectedTrackIds);
    expect(trackIds).toEqual([10, 20, 30]);
  });
});

describe('syncObjectsNode (no hot-swap)', () => {
  it('updates Objects node n_objects without triggering hot-swap', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({
      nodes: graph.nodes,
      edges: graph.edges,
      selectedTrackIds: new Set([1, 2, 3, 4, 5]),
      isPlaying: true,
      movements: [{ id: 'mv-1', name: 'M', osc_ids: [1] }],
    } as any);

    clearInvokeCalls();
    useGraphStore.getState().toggleTrackSelection(6);

    const objectsNode = useGraphStore.getState().nodes.find((n: any) => n.data.type === 'Objects');
    expect((objectsNode!.data as any).params.n_objects).toBe(6);

    const calls = getInvokeCalls();
    expect(calls.filter((c) => c.cmd === 'update_move_graph_merged')).toHaveLength(0);
    expect(calls.filter((c) => c.cmd === 'update_graph')).toHaveLength(0);
  });
});
