/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, getInvokeCalls, resetStore } from './testHelpers';

beforeEach(() => {
  resetStore();
});

describe('setMacros', () => {
  it('merges macros partially', () => {
    useGraphStore.getState().setMacros({ speed: 2.0 });
    const macros = (useGraphStore.getState() as any).macros;
    expect(macros.speed).toBe(2.0);
    expect(macros.scale).toBe(1.0); // unchanged
  });

  it('merges multiple macros', () => {
    useGraphStore.getState().setMacros({ scale: 3.0, yaw: 45, shiftX: 2 });
    const macros = (useGraphStore.getState() as any).macros;
    expect(macros.scale).toBe(3.0);
    expect(macros.yaw).toBe(45);
    expect(macros.shiftX).toBe(2);
  });
});

describe('pushMacrosToRuntime', () => {
  it('pushes spatial macros globally + speed per-movement when movements are active', async () => {
    useGraphStore.setState({
      macros: { speed: 1.5, scale: 2.0, shiftX: 1, shiftY: 0, shiftZ: 0, yaw: 30, pitch: 0, roll: 0, radius_scale: 1, height_offset: 0 },
      movements: [
        { id: 'mv-1', name: 'A', osc_ids: [1] },
        { id: 'mv-2', name: 'B', osc_ids: [2] },
      ],
    } as any);

    await useGraphStore.getState().pushMacrosToRuntime();

    const setGlobalCalls = getInvokeCalls().filter((c) => c.cmd === 'set_global_macro');
    expect(setGlobalCalls).toHaveLength(1);
    expect(setGlobalCalls[0].args?.request.scale).toBe(2.0);
    expect(setGlobalCalls[0].args?.request.shiftX).toBe(1);
    expect(setGlobalCalls[0].args?.request.yaw).toBe(30);
    // Speed should NOT be in the global macro request
    expect(setGlobalCalls[0].args?.request.speed).toBeUndefined();

    // Speed should be pushed per-movement
    const speedCalls = getInvokeCalls().filter((c) => c.cmd === 'set_move_speed');
    expect(speedCalls).toHaveLength(2);
    expect(speedCalls[0].args?.speed).toBe(1.5);
    expect(speedCalls[1].args?.speed).toBe(1.5);
  });

  it('uses legacy set_macro when no movements are active', async () => {
    useGraphStore.setState({
      macros: { speed: 1.5, scale: 2.0, shiftX: 1, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0, radius_scale: 1, height_offset: 0 },
      movements: [],
    } as any);

    await useGraphStore.getState().pushMacrosToRuntime();

    const legacyCalls = getInvokeCalls().filter((c) => c.cmd === 'set_macro');
    expect(legacyCalls).toHaveLength(1);
    // Legacy call should include speed
    expect(legacyCalls[0].args?.request.speed).toBe(1.5);
    expect(legacyCalls[0].args?.request.scale).toBe(2.0);

    // Should NOT call set_global_macro or set_move_speed
    expect(getInvokeCalls().filter((c) => c.cmd === 'set_global_macro')).toHaveLength(0);
    expect(getInvokeCalls().filter((c) => c.cmd === 'set_move_speed')).toHaveLength(0);
  });
});

describe('setLoopMode', () => {
  it('calls set_move_playback_mode on each active movement', async () => {
    useGraphStore.setState({ movements: [{ id: 'mv-1' }, { id: 'mv-2' }] } as any);
    await useGraphStore.getState().setLoopMode('oneshot');
    const calls = getInvokeCalls().filter((c) => c.cmd === 'set_move_playback_mode');
    expect(calls).toHaveLength(2);
    expect(calls[0].args?.loopMode).toBe('oneshot');
  });
});

describe('setDirection', () => {
  it('calls set_move_playback_mode on each active movement', async () => {
    useGraphStore.setState({ movements: [{ id: 'mv-1' }] } as any);
    await useGraphStore.getState().setDirection('backward');
    const calls = getInvokeCalls().filter((c) => c.cmd === 'set_move_playback_mode');
    expect(calls).toHaveLength(1);
    expect(calls[0].args?.direction).toBe('backward');
  });
});
