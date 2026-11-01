/// <reference types="vitest/globals" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShowControl } from '../useShowControl';
import { emitMockEvent, clearListeners } from '../../test/setup';
import { getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';
import { useCuelistStore } from '../../store/useCuelistStore';

// Le dernier maillon testable de la chaîne show-control : l'event OSC
// `/stagespace/*` → dispatch vers la MÊME liveAction que le clavier →
// l'IPC backend. Un dispatch cassé = une console muette en live.

const emit = (command: unknown) =>
  emitMockEvent('show-control', { command, from: 'test:9000' });

describe('useShowControl — dispatch OSC → liveActions → IPC', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    clearListeners();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.restoreAllMocks();
    renderHook(() => useShowControl());
  });

  it('Arm → set_osc_armed true · Disarm → false', () => {
    emit({ command: 'Arm' });
    emit({ command: 'Disarm' });
    const calls = getInvokeCalls().filter((c) => c.cmd === 'set_osc_armed');
    expect(calls.map((c) => c.args?.armed)).toEqual([true, false]);
  });

  it('Panic → deactivate_all_moves (inconditionnel)', () => {
    emit({ command: 'Panic' });
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('deactivate_all_moves');
  });

  it('Throw → throw_object avec obj + vélocité', () => {
    emit({ command: 'Throw', value: [2, 1.5, -0.5, 0] });
    const c = getInvokeCalls().find((c) => c.cmd === 'throw_object');
    expect(c?.args).toMatchObject({ obj: 2, vel: [1.5, -0.5, 0] });
  });

  it('Spatial → set_spatial_compression k', () => {
    emit({ command: 'Spatial', value: 0.7 });
    const c = getInvokeCalls().find((c) => c.cmd === 'set_spatial_compression');
    expect(c?.args).toMatchObject({ k: 0.7 });
  });

  it('Attention → set_attention obj · null = release', () => {
    emit({ command: 'Attention', value: 3 });
    emit({ command: 'Attention', value: null });
    const calls = getInvokeCalls().filter((c) => c.cmd === 'set_attention');
    expect(calls.map((c) => c.args?.obj)).toEqual([3, null]);
  });

  it('Gesture → set_gesture name + strength', () => {
    emit({ command: 'Gesture', value: ['explode', 0.8] });
    const c = getInvokeCalls().find((c) => c.cmd === 'set_gesture');
    expect(c?.args).toMatchObject({ name: 'explode', strength: 0.8 });
  });

  it('SetPosition → set_manual_position obj + xyz', () => {
    emit({ command: 'SetPosition', value: [1, 2.5, 3.0, 1.0] });
    const c = getInvokeCalls().find((c) => c.cmd === 'set_manual_position');
    expect(c?.args).toMatchObject({ objectIndex: 1, position: [2.5, 3.0, 1.0] });
  });

  it('Park → park_object · Unpark → unpark_object', () => {
    emit({ command: 'Park', value: 4 });
    emit({ command: 'Unpark', value: 4 });
    const cmds = getInvokeCalls().map((c) => c.cmd);
    expect(cmds).toContain('park_object');
    expect(cmds).toContain('unpark_object');
  });

  it('Timecode → handleTimecode (pas d\'IPC — le chase vit dans le store)', () => {
    const spy = vi.spyOn(useCuelistStore.getState(), 'handleTimecode');
    emit({ command: 'Timecode', value: 3725.5 });
    expect(spy).toHaveBeenCalledWith(3725.5);
  });

  it('CueRecall inconnu → nack not-found (jamais de recall aveugle)', () => {
    useCuelistStore.setState({ cues: [] } as never);
    emit({ command: 'CueRecall', value: ['42'] });
    const nack = getInvokeCalls().find((c) => c.cmd === 'send_show_nack');
    expect(nack?.args?.reason).toContain('not-found');
  });

  it('recall en cours → CueNext nack busy, jamais de recall_cue', () => {
    useCuelistStore.setState({ isRecalling: true } as never);
    emit({ command: 'CueNext' });
    emit({ command: 'CueRecall', value: ['1'] });
    const nacks = getInvokeCalls().filter((c) => c.cmd === 'send_show_nack');
    expect(nacks.length).toBeGreaterThanOrEqual(2);
    expect(nacks.every((c) => String(c.args?.reason).includes('busy'))).toBe(true);
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('recall_cue');
    useCuelistStore.setState({ isRecalling: false } as never);
  });
});
