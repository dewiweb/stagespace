/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock useAnimationStore with mutable state (must be top-level for dynamic import)
const mockAnimState = { activeMovementIds: [] as string[] };
vi.mock('../useAnimationStore', () => ({
  useAnimationStore: {
    getState: () => mockAnimState,
  },
}));

// Mock safeInvoke/safeListen — captures invoke calls instead of throwing
const invokeCalls: Array<{ cmd: string; args?: Record<string, any> }> = [];
vi.mock('../../utils/tauri', () => ({
  safeInvoke: async <T = any>(cmd: string, args?: Record<string, any>): Promise<T> => {
    invokeCalls.push({ cmd, args });
    return undefined as unknown as T;
  },
  safeListen: async () => () => {},
  checkTauri: () => true,
}));

import { useGraphStore } from '../useGraphStore';

function getInvokeCalls() { return invokeCalls; }
function clearInvokeCalls() { invokeCalls.length = 0; }

// Helper: create a minimal node
function makeNode(id: string, type: string, params: Record<string, any> = {}) {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { label: type, type, params },
  };
}

// Helper: create a minimal edge
function makeEdge(source: string, target: string) {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: 'output',
    targetHandle: 'input',
  };
}

// Helper: create a simple valid graph (Objects → Circular → Output)
function makeSimpleGraph(nObjects: number = 3) {
  return {
    nodes: [
      makeNode('obj-1', 'Objects', { n_objects: nObjects }),
      makeNode('dur-1', 'Duration', { duration: 4.0 }),
      makeNode('eng-1', 'Circular', { n_objects: nObjects, radius: 2.0 }),
      makeNode('out-1', 'Output', {}),
    ],
    edges: [
      makeEdge('obj-1', 'eng-1'),
      makeEdge('dur-1', 'eng-1'),
      makeEdge('eng-1', 'out-1'),
    ],
  };
}

beforeEach(() => {
  // Reset mock animation state
  mockAnimState.activeMovementIds = [];

  // Reset stores
  useGraphStore.setState({
    nodes: [],
    edges: [],
    editingSlotId: null,
    moveSlots: [],
    _history: [],
    _historyIndex: -1,
    canUndo: false,
    canRedo: false,
    isPlaying: false,
    movements: [],
  } as any);

  // Clear localStorage
  localStorage.clear();

  // Clear invoke calls
  clearInvokeCalls();
});

// Helper: setup a slot and load its graph into the editor
function setupEditingSlot(slotId: string, graph: ReturnType<typeof makeSimpleGraph>) {
  const slot = {
    id: slotId,
    name: `Move ${slotId}`,
    graphJson: graph,
    templateId: 'circle',
    trackIds: [1, 2, 3],
    movementId: null,
    isPreview: false,
    macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
    fadeDuration: 2.0,
  };
  useGraphStore.setState({
    moveSlots: [slot],
    editingSlotId: slotId,
    nodes: JSON.parse(JSON.stringify(graph.nodes)),
    edges: JSON.parse(JSON.stringify(graph.edges)),
  } as any);
  return slot;
}

describe('autoSaveToEditingSlot', () => {
  it('saves nodes/edges to the editing slot after addNode', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    // Add a node
    const newNode = makeNode('extra-1', 'Scale', { scale: 2.0 });
    useGraphStore.getState().addNode(newNode);

    // The slot's graphJson should now contain the new node
    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes).toHaveLength(5); // 4 original + 1 new
    expect(updatedSlot.graphJson.nodes.some((n: any) => n.id === 'extra-1')).toBe(true);
  });

  it('saves nodes/edges to the editing slot after removeNode', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    // Remove a node
    useGraphStore.getState().removeNode('eng-1');

    // The slot's graphJson should no longer contain the removed node
    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes.some((n: any) => n.id === 'eng-1')).toBe(false);
    // Edges to/from the removed node should also be gone
    expect(updatedSlot.graphJson.edges.some((e: any) => e.source === 'eng-1' || e.target === 'eng-1')).toBe(false);
  });

  it('saves to localStorage', () => {
    const graph = makeSimpleGraph(3);
    setupEditingSlot('slot-1', graph);

    useGraphStore.getState().addNode(makeNode('extra-1', 'Scale', { scale: 2.0 }));

    // localStorage should contain the updated slot
    const stored = JSON.parse(localStorage.getItem('stagespace-move-slots')!);
    expect(stored[0].graphJson.nodes).toHaveLength(5);
  });

  it('does NOT save when no slot is being edited', () => {
    const graph = makeSimpleGraph(3);
    const slot = {
      id: 'slot-1',
      name: 'Move 1',
      graphJson: graph,
      templateId: 'circle',
      trackIds: [1, 2, 3],
      movementId: null,
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };

    useGraphStore.setState({
      moveSlots: [slot],
      editingSlotId: null,
      nodes: JSON.parse(JSON.stringify(graph.nodes)),
      edges: JSON.parse(JSON.stringify(graph.edges)),
    } as any);

    useGraphStore.getState().addNode(makeNode('extra-1', 'Scale', { scale: 2.0 }));

    // The slot's graphJson should be unchanged
    const updatedSlot = (useGraphStore.getState() as any).moveSlots[0];
    expect(updatedSlot.graphJson.nodes).toHaveLength(4); // original count
  });
});

describe('updateGraphLive targeting', () => {
  it('hot-swaps ONLY the editing slot movement, not all active movements', async () => {
    const graph = makeSimpleGraph(3);
    const slotA = {
      id: 'slot-a',
      name: 'Move A',
      graphJson: graph,
      templateId: 'circle',
      trackIds: [1, 2, 3],
      movementId: 'mv-a',
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };
    const slotB = {
      id: 'slot-b',
      name: 'Move B',
      graphJson: makeSimpleGraph(3),
      templateId: 'circle',
      trackIds: [4, 5, 6],
      movementId: 'mv-b',
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };

    useGraphStore.setState({
      moveSlots: [slotA, slotB],
      editingSlotId: 'slot-a',
      nodes: JSON.parse(JSON.stringify(graph.nodes)),
      edges: JSON.parse(JSON.stringify(graph.edges)),
      movements: [
        { id: 'mv-a', name: 'Move A', osc_ids: [1, 2, 3] },
        { id: 'mv-b', name: 'Move B', osc_ids: [4, 5, 6] },
      ],
      isPlaying: false,
    } as any);

    // Set mock active movement IDs
    mockAnimState.activeMovementIds = ['mv-a', 'mv-b'];

    await useGraphStore.getState().updateGraphLive(0.3);

    const calls = getInvokeCalls();
    const hotSwapCalls = calls.filter((c) => c.cmd === 'update_move_graph_merged');

    // Should only hot-swap mv-a (the editing slot's movement), NOT mv-b
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
      movements: [{ id: 'mv-a', name: 'Move A', osc_ids: [1, 2, 3] }],
      isPlaying: false,
    } as any);

    mockAnimState.activeMovementIds = ['mv-a'];

    await useGraphStore.getState().updateGraphLive(0.3);

    const calls = getInvokeCalls();
    const hotSwapCalls = calls.filter((c) => c.cmd === 'update_move_graph_merged');
    expect(hotSwapCalls).toHaveLength(0);
  });
});

describe('selectSlotForEditing', () => {
  it('loads the slot graph into the editor', () => {
    const graph = makeSimpleGraph(5);
    const slot = {
      id: 'slot-1',
      name: 'Move 1',
      graphJson: graph,
      templateId: 'circle',
      trackIds: [1, 2, 3, 4, 5],
      movementId: null,
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };

    useGraphStore.setState({ moveSlots: [slot] } as any);

    useGraphStore.getState().selectSlotForEditing('slot-1');

    expect((useGraphStore.getState() as any).editingSlotId).toBe('slot-1');
    expect(useGraphStore.getState().nodes).toHaveLength(4);
    expect(useGraphStore.getState().edges).toHaveLength(3);
    // Should be a deep copy, not the same reference
    expect(useGraphStore.getState().nodes).not.toBe(graph.nodes);
  });

  it('resets undo/redo history on slot switch', () => {
    const slot1 = {
      id: 'slot-1',
      name: 'Move 1',
      graphJson: makeSimpleGraph(3),
      templateId: 'circle',
      trackIds: [1, 2, 3],
      movementId: null,
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };
    const slot2 = {
      id: 'slot-2',
      name: 'Move 2',
      graphJson: makeSimpleGraph(5),
      templateId: 'circle',
      trackIds: [4, 5, 6, 7, 8],
      movementId: null,
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };

    useGraphStore.setState({ moveSlots: [slot1, slot2] } as any);

    // Select slot 1 and push some history
    useGraphStore.getState().selectSlotForEditing('slot-1');
    useGraphStore.getState().pushHistory();
    useGraphStore.getState().pushHistory();
    expect((useGraphStore.getState() as any)._history.length).toBeGreaterThan(0);

    // Switch to slot 2 — history should be reset
    useGraphStore.getState().selectSlotForEditing('slot-2');
    expect((useGraphStore.getState() as any)._history).toHaveLength(0);
    expect((useGraphStore.getState() as any)._historyIndex).toBe(-1);
    expect((useGraphStore.getState() as any).canUndo).toBe(false);
    expect((useGraphStore.getState() as any).canRedo).toBe(false);
  });

  it('syncs selectedTrackIds with the slot tracks', () => {
    const slot = {
      id: 'slot-1',
      name: 'Move 1',
      graphJson: makeSimpleGraph(3),
      templateId: 'circle',
      trackIds: [10, 20, 30],
      movementId: null,
      isPreview: false,
      macros: { speed: 1, scale: 1, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
      fadeDuration: 2.0,
    };

    useGraphStore.setState({ moveSlots: [slot] } as any);
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
      movements: [{ id: 'mv-1', name: 'Move 1', osc_ids: [1, 2, 3] }],
    } as any);

    clearInvokeCalls();

    // Toggle a track selection — this calls syncObjectsNode internally
    useGraphStore.getState().toggleTrackSelection(6);

    // Objects node should be updated to 6 objects
    const objectsNode = useGraphStore.getState().nodes.find((n: any) => (n.data as any)?.type === 'Objects');
    expect((objectsNode!.data as any).params.n_objects).toBe(6);

    // NO hot-swap should have been triggered
    const calls = getInvokeCalls();
    const hotSwapCalls = calls.filter((c) => c.cmd === 'update_move_graph_merged');
    const updateGraphCalls = calls.filter((c) => c.cmd === 'update_graph');
    expect(hotSwapCalls).toHaveLength(0);
    expect(updateGraphCalls).toHaveLength(0);
  });
});
