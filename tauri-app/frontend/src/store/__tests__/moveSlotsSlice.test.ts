/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore, makeSlot, makeSimpleGraph } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('addMoveSlot', () => {
  it('creates a new slot with default values', () => {
    useGraphStore.setState({ manualOscIds: [1, 2, 3], holProject: null } as any);
    useGraphStore.getState().addMoveSlot();

    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe('Move 1');
    expect(slots[0].templateId).toBe('circle');
    expect(slots[0].trackIds).toEqual([1, 2, 3]);
    // graphJson est construit à la création (slot self-contained : le GO
    // n'a pas besoin de rebuilder le template — la setlist rejoue le graphe
    // exact qui était affiché).
    expect(slots[0].graphJson).not.toBeNull();
    expect(slots[0].graphJson.nodes.length).toBeGreaterThan(0);
    expect(slots[0].movementId).toBeNull();
    expect(slots[0].isPreview).toBe(false);
    expect(slots[0].macros.speed).toBe(1.0);
    expect(slots[0].fadeDuration).toBe(2.0);
  });

  it('uses holProject tracks when available', () => {
    const holProject = {
      tracks: [{ id: 10 }, { id: 20 }, { id: 30 }] as any,
    };
    useGraphStore.setState({ holProject, manualOscIds: [1, 2, 3] } as any);
    useGraphStore.getState().addMoveSlot();

    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots[0].trackIds).toEqual([10, 20, 30]);
  });

  it('auto-selects the new slot for editing', () => {
    useGraphStore.getState().addMoveSlot();

    const slots = (useGraphStore.getState() as any).moveSlots;
    expect((useGraphStore.getState() as any).editingSlotId).toBe(slots[0].id);
  });

  it('persists to localStorage', () => {
    useGraphStore.getState().addMoveSlot();
    const stored = JSON.parse(localStorage.getItem('stagespace-move-slots')!);
    expect(stored).toHaveLength(1);
  });
});

describe('removeMoveSlot', () => {
  it('removes the slot from moveSlots', () => {
    const slot = makeSlot({ id: 'slot-1' });
    useGraphStore.setState({ moveSlots: [slot] } as any);
    useGraphStore.getState().removeMoveSlot('slot-1');
    expect((useGraphStore.getState() as any).moveSlots).toHaveLength(0);
  });

  it('removes from setlistOrder', () => {
    const slot = makeSlot({ id: 'slot-1' });
    useGraphStore.setState({ moveSlots: [slot], setlistOrder: ['slot-1'] } as any);
    useGraphStore.getState().removeMoveSlot('slot-1');
    expect((useGraphStore.getState() as any).setlistOrder).toHaveLength(0);
  });

  it('deselects editingSlotId if it was the removed slot', () => {
    const slot = makeSlot({ id: 'slot-1' });
    useGraphStore.setState({ moveSlots: [slot], editingSlotId: 'slot-1' } as any);
    useGraphStore.getState().removeMoveSlot('slot-1');
    expect((useGraphStore.getState() as any).editingSlotId).toBeNull();
  });

  it('keeps editingSlotId if it was a different slot', () => {
    const slot1 = makeSlot({ id: 'slot-1' });
    const slot2 = makeSlot({ id: 'slot-2' });
    useGraphStore.setState({ moveSlots: [slot1, slot2], editingSlotId: 'slot-2' } as any);
    useGraphStore.getState().removeMoveSlot('slot-1');
    expect((useGraphStore.getState() as any).editingSlotId).toBe('slot-2');
  });

  it('resets currentSetlistIndex to -1 when setlist becomes shorter than index', () => {
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'a' }), makeSlot({ id: 'b' }), makeSlot({ id: 'c' })],
      setlistOrder: ['a', 'b', 'c'],
      currentSetlistIndex: 2,
    } as any);
    // Remove 'c' (the last item) — newSetlist has length 2, index 2 >= 2 → -1
    useGraphStore.getState().removeMoveSlot('c');
    expect((useGraphStore.getState() as any).currentSetlistIndex).toBe(-1);
  });

  it('keeps currentSetlistIndex when removing item after it', () => {
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'a' }), makeSlot({ id: 'b' }), makeSlot({ id: 'c' })],
      setlistOrder: ['a', 'b', 'c'],
      currentSetlistIndex: 1,
    } as any);
    // Remove 'c' (after index 1) — newSetlist has length 2, index 1 < 2 → stays 1
    useGraphStore.getState().removeMoveSlot('c');
    expect((useGraphStore.getState() as any).currentSetlistIndex).toBe(1);
  });
});

describe('renameMoveSlot', () => {
  it('renames the slot', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', name: 'Old' })] } as any);
    useGraphStore.getState().renameMoveSlot('slot-1', 'New Name');
    expect((useGraphStore.getState() as any).moveSlots[0].name).toBe('New Name');
  });

  it('does nothing if slot not found', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1' })] } as any);
    useGraphStore.getState().renameMoveSlot('nonexistent', 'New');
    expect((useGraphStore.getState() as any).moveSlots[0].name).toBe('Test Move');
  });
});

describe('setSlotFadeDuration', () => {
  it('updates fade duration', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', fadeDuration: 2.0 })] } as any);
    useGraphStore.getState().setSlotFadeDuration('slot-1', 5.0);
    expect((useGraphStore.getState() as any).moveSlots[0].fadeDuration).toBe(5.0);
  });
});

describe('toggleSlotPreview', () => {
  it('toggles preview mode', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', isPreview: false })] } as any);
    useGraphStore.getState().toggleSlotPreview('slot-1');
    expect((useGraphStore.getState() as any).moveSlots[0].isPreview).toBe(true);
    useGraphStore.getState().toggleSlotPreview('slot-1');
    expect((useGraphStore.getState() as any).moveSlots[0].isPreview).toBe(false);
  });
});

describe('setSlotMacros', () => {
  it('merges macros partially', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1' })] } as any);
    useGraphStore.getState().setSlotMacros('slot-1', { speed: 2.0, scale: 3.0 });
    const macros = (useGraphStore.getState() as any).moveSlots[0].macros;
    expect(macros.speed).toBe(2.0);
    expect(macros.scale).toBe(3.0);
    // Other macros should be unchanged
    expect(macros.shiftX).toBe(0);
    expect(macros.yaw).toBe(0);
  });

  it('pushes speed to backend when movement is active', async () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', movementId: 'mv-1' })] } as any);
    useGraphStore.getState().setSlotMacros('slot-1', { speed: 1.5 });

    // Wait for the async invoke
    await new Promise((r) => setTimeout(r, 10));

    const speedCalls = getInvokeCalls().filter((c) => c.cmd === 'set_move_speed');
    expect(speedCalls.length).toBeGreaterThan(0);
    expect(speedCalls[0].args?.speed).toBe(1.5);
  });

  it('does NOT push speed when movement is not active', async () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', movementId: null })] } as any);
    useGraphStore.getState().setSlotMacros('slot-1', { speed: 1.5 });

    await new Promise((r) => setTimeout(r, 10));
    const speedCalls = getInvokeCalls().filter((c) => c.cmd === 'set_move_speed');
    expect(speedCalls).toHaveLength(0);
  });
});

describe('setSlotTracks', () => {
  it('updates trackIds sorted', () => {
    useGraphStore.setState({ moveSlots: [makeSlot({ id: 'slot-1', trackIds: [1, 2] })] } as any);
    useGraphStore.getState().setSlotTracks('slot-1', [5, 3, 1]);
    expect((useGraphStore.getState() as any).moveSlots[0].trackIds).toEqual([1, 3, 5]);
  });

  it('syncs n_objects in graphJson when graph exists', () => {
    const graph = makeSimpleGraph(2);
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'slot-1', trackIds: [1, 2], graphJson: graph })],
    } as any);
    useGraphStore.getState().setSlotTracks('slot-1', [1, 2, 3]);

    const slot = (useGraphStore.getState() as any).moveSlots[0];
    const objectsNode = slot.graphJson.nodes.find((n: any) => n.data.type === 'Objects');
    expect((objectsNode.data as any).params.n_objects).toBe(3);
    const engineNode = slot.graphJson.nodes.find((n: any) => n.data.type === 'Circular');
    expect((engineNode.data as any).params.n_objects).toBe(3);
  });

  it('syncs selectedTrackIds when it is the editing slot', () => {
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'slot-1', trackIds: [1, 2] })],
      editingSlotId: 'slot-1',
      selectedTrackIds: new Set([1, 2]),
    } as any);
    useGraphStore.getState().setSlotTracks('slot-1', [3, 4]);
    expect(Array.from((useGraphStore.getState() as any).selectedTrackIds)).toEqual([3, 4]);
  });

  it('does NOT sync selectedTrackIds when it is NOT the editing slot', () => {
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'slot-1', trackIds: [1, 2] })],
      editingSlotId: 'slot-other',
      selectedTrackIds: new Set([1, 2]),
    } as any);
    useGraphStore.getState().setSlotTracks('slot-1', [3, 4]);
    expect(Array.from((useGraphStore.getState() as any).selectedTrackIds)).toEqual([1, 2]);
  });
});

// ─── Setlist operations ───

describe('addToSetlist', () => {
  it('adds a slot to the setlist', () => {
    useGraphStore.getState().addToSetlist('slot-1');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['slot-1']);
  });

  it('prevents duplicates', () => {
    useGraphStore.setState({ setlistOrder: ['slot-1'] } as any);
    useGraphStore.getState().addToSetlist('slot-1');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['slot-1']);
  });
});

describe('removeFromSetlist', () => {
  it('removes from setlist', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'] } as any);
    useGraphStore.getState().removeFromSetlist('b');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['a', 'c']);
  });

  it('decrements currentSetlistIndex if removed item was before it', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'], currentSetlistIndex: 2 } as any);
    useGraphStore.getState().removeFromSetlist('a');
    expect((useGraphStore.getState() as any).currentSetlistIndex).toBe(1);
  });

  it('does NOT change currentSetlistIndex if removed item was after it', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'], currentSetlistIndex: 1 } as any);
    useGraphStore.getState().removeFromSetlist('c');
    expect((useGraphStore.getState() as any).currentSetlistIndex).toBe(1);
  });
});

describe('moveSetlistItem', () => {
  it('moves item up', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'] } as any);
    useGraphStore.getState().moveSetlistItem(2, 'up');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['a', 'c', 'b']);
  });

  it('moves item down', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'] } as any);
    useGraphStore.getState().moveSetlistItem(0, 'down');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at top boundary', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'] } as any);
    useGraphStore.getState().moveSetlistItem(0, 'up');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['a', 'b', 'c']);
  });

  it('does nothing at bottom boundary', () => {
    useGraphStore.setState({ setlistOrder: ['a', 'b', 'c'] } as any);
    useGraphStore.getState().moveSetlistItem(2, 'down');
    expect((useGraphStore.getState() as any).setlistOrder).toEqual(['a', 'b', 'c']);
  });
});

describe('goToNextMove', () => {
  it('returns error message on empty setlist', async () => {
    const result = await useGraphStore.getState().goToNextMove();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Empty setlist');
  });

  it('returns error message at end of setlist', async () => {
    useGraphStore.setState({
      setlistOrder: ['slot-1'],
      currentSetlistIndex: 0,
      moveSlots: [makeSlot({ id: 'slot-1' })],
    } as any);
    const result = await useGraphStore.getState().goToNextMove();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Fin de la setlist');
  });

  it('returns error if next slot not found', async () => {
    useGraphStore.setState({
      setlistOrder: ['slot-1', 'slot-missing'],
      currentSetlistIndex: 0,
      moveSlots: [makeSlot({ id: 'slot-1' })],
    } as any);
    const result = await useGraphStore.getState().goToNextMove();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('introuvable');
  });
});

describe('syncSlotMovements', () => {
  it('clears stale movementIds', () => {
    useGraphStore.setState({
      moveSlots: [
        makeSlot({ id: 'slot-1', movementId: 'mv-active' }),
        makeSlot({ id: 'slot-2', movementId: 'mv-stale' }),
      ],
      movements: [{ id: 'mv-active' }],
    } as any);
    useGraphStore.getState().syncSlotMovements();

    const slots = (useGraphStore.getState() as any).moveSlots;
    expect(slots[0].movementId).toBe('mv-active');
    expect(slots[1].movementId).toBeNull();
  });

  it('does nothing when no stale movements', () => {
    useGraphStore.setState({
      moveSlots: [makeSlot({ id: 'slot-1', movementId: 'mv-1' })],
      movements: [{ id: 'mv-1' }],
    } as any);
    useGraphStore.getState().syncSlotMovements();
    expect((useGraphStore.getState() as any).moveSlots[0].movementId).toBe('mv-1');
  });
});
