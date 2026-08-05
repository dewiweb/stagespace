/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore, makeSimpleGraph, makeNode, makeEdge } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('setMovementPositions', () => {
  it('stores positions by movementId', () => {
    const positions = [{ index: 0, x: 1, y: 2, z: 3 }];
    useGraphStore.getState().setMovementPositions('mv-1', positions);
    expect((useGraphStore.getState() as any).movementPositions['mv-1']).toEqual(positions);
  });

  it('replaces positions for the same movementId', () => {
    useGraphStore.getState().setMovementPositions('mv-1', [{ index: 0, x: 1, y: 2, z: 3 }]);
    useGraphStore.getState().setMovementPositions('mv-1', [{ index: 0, x: 10, y: 20, z: 30 }]);
    expect((useGraphStore.getState() as any).movementPositions['mv-1'][0].x).toBe(10);
  });

  it('does not affect other movements', () => {
    useGraphStore.getState().setMovementPositions('mv-1', [{ index: 0, x: 1, y: 2, z: 3 }]);
    useGraphStore.getState().setMovementPositions('mv-2', [{ index: 0, x: 10, y: 20, z: 30 }]);
    expect((useGraphStore.getState() as any).movementPositions['mv-1'][0].x).toBe(1);
    expect((useGraphStore.getState() as any).movementPositions['mv-2'][0].x).toBe(10);
  });
});

describe('stopMovement', () => {
  it('calls deactivate_move and cleans up positions + savedGraphs', async () => {
    useGraphStore.setState({
      movementPositions: { 'mv-1': [{ index: 0, x: 1, y: 2, z: 3 }] },
      savedGraphs: { 'mv-1': { nodes: [], edges: [], trackIndices: [], name: 'test' } },
    } as any);

    await useGraphStore.getState().stopMovement('mv-1');

    const calls = getInvokeCalls().filter((c) => c.cmd === 'deactivate_move');
    expect(calls).toHaveLength(1);
    expect(calls[0].args?.movementId).toBe('mv-1');
    expect((useGraphStore.getState() as any).movementPositions['mv-1']).toBeUndefined();
    expect((useGraphStore.getState() as any).savedGraphs['mv-1']).toBeUndefined();
  });
});

describe('stopMovementWithFade', () => {
  it('calls deactivate_move with fade duration', async () => {
    await useGraphStore.getState().stopMovementWithFade('mv-1', 2.5);

    const calls = getInvokeCalls().filter((c) => c.cmd === 'deactivate_move');
    expect(calls).toHaveLength(1);
    expect(calls[0].args?.fadeDuration).toBe(2.5);
  });

  it('cleans up positions and savedGraphs', async () => {
    useGraphStore.setState({
      movementPositions: { 'mv-1': [{ index: 0, x: 1, y: 2, z: 3 }] },
      savedGraphs: { 'mv-1': { nodes: [], edges: [], trackIndices: [], name: 'test' } },
    } as any);

    await useGraphStore.getState().stopMovementWithFade('mv-1', 1.0);

    expect((useGraphStore.getState() as any).movementPositions['mv-1']).toBeUndefined();
    expect((useGraphStore.getState() as any).savedGraphs['mv-1']).toBeUndefined();
  });
});

describe('stopAllMovements', () => {
  it('calls deactivate_all_moves and clears all positions + savedGraphs', async () => {
    useGraphStore.setState({
      movementPositions: {
        'mv-1': [{ index: 0, x: 1, y: 2, z: 3 }],
        'mv-2': [{ index: 0, x: 4, y: 5, z: 6 }],
      },
      savedGraphs: {
        'mv-1': { nodes: [], edges: [], trackIndices: [], name: 'a' },
        'mv-2': { nodes: [], edges: [], trackIndices: [], name: 'b' },
      },
    } as any);

    await useGraphStore.getState().stopAllMovements();

    const calls = getInvokeCalls().filter((c) => c.cmd === 'deactivate_all_moves');
    expect(calls).toHaveLength(1);
    expect((useGraphStore.getState() as any).movementPositions).toEqual({});
    expect((useGraphStore.getState() as any).savedGraphs).toEqual({});
  });
});

describe('refreshMovements', () => {
  it('calls list_active_moves and sets movements', async () => {
    // The mock returns [] for list_active_moves
    await useGraphStore.getState().refreshMovements();

    const calls = getInvokeCalls().filter((c) => c.cmd === 'list_active_moves');
    expect(calls).toHaveLength(1);
    expect((useGraphStore.getState() as any).movements).toEqual([]);
  });
});

describe('loadMovementGraph', () => {
  it('loads a saved graph into the editor', () => {
    const graph = makeSimpleGraph(3);
    useGraphStore.setState({
      savedGraphs: {
        'mv-1': {
          nodes: graph.nodes,
          edges: graph.edges,
          trackIndices: [0, 1, 2],
          name: 'test',
        },
      },
    } as any);

    useGraphStore.getState().loadMovementGraph('mv-1');

    expect(useGraphStore.getState().nodes).toHaveLength(4);
    expect(useGraphStore.getState().edges).toHaveLength(3);
    // Should be a deep copy, not the same reference
    expect(useGraphStore.getState().nodes).not.toBe(graph.nodes);
  });

  it('does nothing if movement not in savedGraphs', () => {
    useGraphStore.getState().loadMovementGraph('nonexistent');
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });
});
