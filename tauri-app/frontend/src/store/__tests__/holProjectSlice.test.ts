/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore, makeNode } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('toggleTrackSelection', () => {
  it('adds a track to the selection', () => {
    useGraphStore.setState({ selectedTrackIds: new Set([1, 2]) } as any);
    useGraphStore.getState().toggleTrackSelection(3);
    expect((useGraphStore.getState() as any).selectedTrackIds.has(3)).toBe(true);
    expect((useGraphStore.getState() as any).selectedTrackIds.has(1)).toBe(true);
  });

  it('removes a track from the selection', () => {
    useGraphStore.setState({ selectedTrackIds: new Set([1, 2, 3]) } as any);
    useGraphStore.getState().toggleTrackSelection(2);
    expect((useGraphStore.getState() as any).selectedTrackIds.has(2)).toBe(false);
    expect((useGraphStore.getState() as any).selectedTrackIds.has(1)).toBe(true);
  });

  it('syncs editing slot tracks', () => {
    const slot = { id: 'slot-1', trackIds: [1, 2], graphJson: null, name: 'M', templateId: 'c', movementId: null, isPreview: false, macros: {} as any, fadeDuration: 2 };
    useGraphStore.setState({
      selectedTrackIds: new Set([1, 2]),
      moveSlots: [slot],
      editingSlotId: 'slot-1',
    } as any);
    useGraphStore.getState().toggleTrackSelection(3);
    expect((useGraphStore.getState() as any).moveSlots[0].trackIds).toContain(3);
  });
});

describe('selectAllTracks', () => {
  it('selects all tracks from holProject', () => {
    const holProject = {
      tracks: [{ id: 10 }, { id: 20 }, { id: 30 }] as any,
    };
    useGraphStore.setState({ holProject, selectedTrackIds: new Set([10]) } as any);
    useGraphStore.getState().selectAllTracks();
    const ids = Array.from((useGraphStore.getState() as any).selectedTrackIds);
    expect(ids).toEqual([10, 20, 30]);
  });

  it('selects empty set when no holProject', () => {
    useGraphStore.setState({ holProject: null, selectedTrackIds: new Set([1]) } as any);
    useGraphStore.getState().selectAllTracks();
    expect((useGraphStore.getState() as any).selectedTrackIds.size).toBe(0);
  });
});

describe('deselectAllTracks', () => {
  it('clears all track selections', () => {
    useGraphStore.setState({ selectedTrackIds: new Set([1, 2, 3]) } as any);
    useGraphStore.getState().deselectAllTracks();
    expect((useGraphStore.getState() as any).selectedTrackIds.size).toBe(0);
  });
});

describe('getSelectedOscIds', () => {
  it('returns sorted array of selected track IDs', () => {
    useGraphStore.setState({ selectedTrackIds: new Set([5, 1, 3]) } as any);
    const ids = useGraphStore.getState().getSelectedOscIds();
    expect(ids).toEqual([1, 3, 5]);
  });

  it('returns empty array when nothing selected', () => {
    useGraphStore.setState({ selectedTrackIds: new Set() } as any);
    expect(useGraphStore.getState().getSelectedOscIds()).toEqual([]);
  });
});

describe('syncObjectsNode', () => {
  it('updates Objects node n_objects and track_ids', () => {
    useGraphStore.setState({
      nodes: [makeNode('obj-1', 'Objects', { n_objects: 2 })],
      selectedTrackIds: new Set([1, 2, 3]),
    } as any);
    useGraphStore.getState().syncObjectsNode();

    const obj = useGraphStore.getState().nodes.find((n: any) => (n.data as any)?.type === 'Objects');
    expect((obj!.data as any).params.n_objects).toBe(3);
    expect((obj!.data as any).params.track_ids).toEqual([1, 2, 3]);
  });

  it('creates Objects node if it does not exist', () => {
    useGraphStore.setState({
      nodes: [],
      selectedTrackIds: new Set([1, 2]),
    } as any);
    useGraphStore.getState().syncObjectsNode();

    const obj = useGraphStore.getState().nodes.find((n: any) => (n.data as any)?.type === 'Objects');
    expect(obj).toBeDefined();
    expect((obj!.data as any).params.n_objects).toBe(2);
  });

  it('does NOT create Objects node when selection is empty and no Objects node exists', () => {
    useGraphStore.setState({
      nodes: [],
      selectedTrackIds: new Set(),
    } as any);
    useGraphStore.getState().syncObjectsNode();
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });

  it('syncs n_objects on engine nodes', () => {
    useGraphStore.setState({
      nodes: [
        makeNode('obj-1', 'Objects', { n_objects: 2 }),
        makeNode('eng-1', 'Circular', { n_objects: 2, radius: 1 }),
        makeNode('eng-2', 'Spiral', { n_objects: 2, radius: 1 }),
      ],
      selectedTrackIds: new Set([1, 2, 3, 4]),
    } as any);
    useGraphStore.getState().syncObjectsNode();

    const eng1 = useGraphStore.getState().nodes.find((n: any) => n.id === 'eng-1');
    const eng2 = useGraphStore.getState().nodes.find((n: any) => n.id === 'eng-2');
    expect((eng1!.data as any).params.n_objects).toBe(4);
    expect((eng2!.data as any).params.n_objects).toBe(4);
  });

  it('does NOT trigger hot-swap', () => {
    useGraphStore.setState({
      nodes: [makeNode('obj-1', 'Objects', { n_objects: 2 })],
      selectedTrackIds: new Set([1, 2, 3]),
      isPlaying: true,
      movements: [{ id: 'mv-1', name: 'M', osc_ids: [1] }],
    } as any);

    useGraphStore.getState().syncObjectsNode();

    const calls = getInvokeCalls();
    expect(calls.filter((c) => c.cmd === 'update_move_graph_merged')).toHaveLength(0);
    expect(calls.filter((c) => c.cmd === 'update_graph')).toHaveLength(0);
  });
});

describe('setManualOscIds', () => {
  it('sets manual OSC IDs', () => {
    useGraphStore.getState().setManualOscIds([10, 20, 30]);
    expect((useGraphStore.getState() as any).manualOscIds).toEqual([10, 20, 30]);
  });
});

describe('manual positions', () => {
  it('setManualPosition sets a single position', () => {
    useGraphStore.getState().setManualPosition(0, [1, 2, 3]);
    expect((useGraphStore.getState() as any).manualPositions[0]).toEqual([1, 2, 3]);
  });

  it('setManualPositions replaces all positions', () => {
    useGraphStore.getState().setManualPositions({ 0: [1, 2, 3], 1: [4, 5, 6] });
    expect((useGraphStore.getState() as any).manualPositions[0]).toEqual([1, 2, 3]);
    expect((useGraphStore.getState() as any).manualPositions[1]).toEqual([4, 5, 6]);
  });

  it('resetManualPositions creates a circle', () => {
    useGraphStore.getState().resetManualPositions(4);
    const positions = (useGraphStore.getState() as any).manualPositions;
    expect(Object.keys(positions)).toHaveLength(4);
    // Check that positions are on a circle (radius for n<=4 is 1.5)
    for (let i = 0; i < 4; i++) {
      const [x, _y, z] = positions[i];
      const r = Math.sqrt(x * x + z * z);
      expect(r).toBeCloseTo(1.5, 5);
    }
  });
});
