/// <reference types="vitest/globals" />

// Régression 0.8.0 — vraie transform per-move :
// - playSlot seede les macros spatiales dans le payload animation (worker)
//   et ne les pousse PLUS au merge global (fin de la fiction console A5)
// - setSlotMacros pousse le spatial en live via set_move_macro quand le
//   slot joue

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore, makeSlot } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('playSlot — per-move transform seeding', () => {
  it('sends spatial macros in the animation payload, NOT to set_global_macro', async () => {
    const slot = makeSlot({
      id: 'slot-1',
      trackIds: [1, 2],
      macros: { speed: 1.5, scale: 2.0, shiftX: 3, shiftY: 0, shiftZ: -1, yaw: 45, pitch: 0, roll: 10 },
    });
    useGraphStore.setState({ moveSlots: [slot], manualOscIds: [1, 2, 3] } as any);

    await useGraphStore.getState().playSlot('slot-1');

    const calls = getInvokeCalls();
    const activate = calls.find((c) => c.cmd === 'activate_move');
    expect(activate, 'activate_move doit être appelé').toBeTruthy();
    const anim = (activate!.args as any).request.animation;
    // Les macros spatiales voyagent dans le payload — le backend les seede
    // au worker (spec_from_request → SpatialMacroInit).
    expect(anim.scale).toBe(2.0);
    expect(anim.offset_x).toBe(3);
    expect(anim.offset_z).toBe(-1);
    expect(anim.yaw).toBe(45);
    expect(anim.roll).toBe(10);
    expect(anim.speed).toBe(1.5);

    // Fin de la fiction console : plus de push au merge global — le global
    // reste où l'opérateur l'a mis.
    const globalPush = calls.find((c) => c.cmd === 'set_global_macro');
    expect(globalPush, 'set_global_macro ne doit PLUS être appelé au play').toBeUndefined();
  });
});

describe('setSlotMacros — live per-move push', () => {
  it('pushes spatial macros to the worker when the slot is playing', () => {
    const slot = makeSlot({ id: 'slot-1', trackIds: [1], movementId: 'mv-1' });
    useGraphStore.setState({ moveSlots: [slot] } as any);

    useGraphStore.getState().setSlotMacros('slot-1', { scale: 2.5, yaw: 90 });

    const calls = getInvokeCalls();
    const macroPush = calls.find((c) => c.cmd === 'set_move_macro');
    expect(macroPush, 'set_move_macro doit être appelé pour un slot en lecture').toBeTruthy();
    expect((macroPush!.args as any).movementId).toBe('mv-1');
    expect((macroPush!.args as any).request.scale).toBe(2.5);
    expect((macroPush!.args as any).request.yaw).toBe(90);
    // Speed aussi (per-move) — le chemin existant est conservé.
    const speedPush = calls.find((c) => c.cmd === 'set_move_speed');
    expect(speedPush).toBeTruthy();
  });

  it('pushes nothing when the slot is stopped', () => {
    const slot = makeSlot({ id: 'slot-1', trackIds: [1], movementId: null });
    useGraphStore.setState({ moveSlots: [slot] } as any);

    useGraphStore.getState().setSlotMacros('slot-1', { scale: 2.5 });

    const calls = getInvokeCalls();
    expect(calls.find((c) => c.cmd === 'set_move_macro')).toBeUndefined();
    expect(calls.find((c) => c.cmd === 'set_move_speed')).toBeUndefined();
  });
});
