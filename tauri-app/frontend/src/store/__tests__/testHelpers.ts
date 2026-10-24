/// <reference types="vitest/globals" />

// Mocks are in src/test/setup.ts (applied globally via vitest config)
// This file just provides test helpers and re-exports.

import { useGraphStore } from '../useGraphStore';
import type { GraphNode } from "../../components/nodeParamSchema";
import type { NodeType } from "../../types/generated/NodeType";
import { mockAnimState, getInvokeCalls, clearInvokeCalls, setInvokeResponse } from '../../test/setup';

export { useGraphStore, mockAnimState, getInvokeCalls, clearInvokeCalls, setInvokeResponse };

export function resetStore() {
  mockAnimState.activeMovementIds = [];
  // Vider l'objet mutable des positions avant de reset le store
  useGraphStore.getState().clearMovementPositions?.();
  useGraphStore.setState({
    nodes: [],
    edges: [],
    editingSlotId: null,
    moveSlots: [],
    pendingPlays: [],
    setlistOrder: [],
    currentSetlistIndex: -1,
    _history: [],
    _historyIndex: -1,
    _lastRemovalPushAt: 0,
    canUndo: false,
    canRedo: false,
    isPlaying: false,
    audioListening: false,
    audioState: { bpm: null, amplitude: null, spectrum: null },
    status: 'idle',
    movements: [],
    savedGraphs: {},
    selectedTrackIds: new Set<number>(),
    holProject: null,
    manualOscIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    macros: { speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0, radius_scale: 1.0, height_offset: 0 },
    drawMode: false,
    drawnPoints: [],
    oscAddress: '127.0.0.1',
    oscPort: 9999,
    oscProfile: 'holophonix',
    plugins: [],
    pluginErrors: [],
    pluginsDir: null,
    pluginsLoaded: false,
  } as any);
  localStorage.clear();
  clearInvokeCalls();
}

export function makeNode(id: string, type: NodeType, params: Record<string, any> = {}): GraphNode {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { label: type, type, params },
  };
}

export function makeEdge(source: string, target: string) {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: 'output',
    targetHandle: 'input',
  };
}

export function makeSimpleGraph(nObjects: number = 3) {
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

export function makeSlot(overrides: Partial<any> = {}): any {
  return {
    id: 'slot-test',
    name: 'Test Move',
    graphJson: makeSimpleGraph(3),
    templateId: 'circle',
    trackIds: [1, 2, 3],
    movementId: null,
    isPreview: false,
    macros: { speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 },
    fadeDuration: 2.0,
    fadeIn: 0.5,
    fadeOut: 0.5,
    phaseSpread: 0,
    assignments: [],
    audioMods: [],
    ...overrides,
  };
}

export function setupEditingSlot(slotId: string, graph: ReturnType<typeof makeSimpleGraph>) {
  const slot = makeSlot({ id: slotId, graphJson: graph });
  useGraphStore.setState({
    moveSlots: [slot],
    editingSlotId: slotId,
    nodes: JSON.parse(JSON.stringify(graph.nodes)),
    edges: JSON.parse(JSON.stringify(graph.edges)),
  } as any);
  return slot;
}
