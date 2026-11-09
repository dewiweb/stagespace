/// <reference types="vitest/globals" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConduiteBroadcast } from '../useConduiteBroadcast';
import { emitMockEvent, clearListeners, getEmitCalls, clearEmitCalls } from '../../test/setup';
import { getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';
import { useCuelistStore } from '../../store/useCuelistStore';
import { useShowStatusStore } from '../../store/useShowStatusStore';

// Le canal inter-webview conduite : la fenêtre détachée émet
// `conduite:cmd` (strings) → la principale dispatch vers les mêmes
// liveActions que clavier/OSC. Et `conduite:state` est broadcasté
// toutes les 500ms vers la détachée (cue list, pending, TC).

describe('useConduiteBroadcast — canal inter-webview', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    clearListeners();
    clearEmitCalls();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.restoreAllMocks();
    renderHook(() => useConduiteBroadcast());
  });

  it('panic → deactivate_all_moves', () => {
    emitMockEvent('conduite:cmd', 'panic');
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('deactivate_all_moves');
  });

  it('arm → set_osc_armed (toggle de l\'état courant)', () => {
    useShowStatusStore.setState({ armed: true });
    emitMockEvent('conduite:cmd', 'arm');
    const c = getInvokeCalls().find((c) => c.cmd === 'set_osc_armed');
    expect(c?.args?.armed).toBe(false);
  });

  it('recall:<id> inconnu → nack not-found, jamais de recall aveugle', () => {
    useCuelistStore.setState({ cues: [] } as never);
    emitMockEvent('conduite:cmd', 'recall:no-such-id');
    const nack = getInvokeCalls().find((c) => c.cmd === 'send_show_nack');
    expect(nack?.args?.reason).toContain('not-found');
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('recall_cue');
  });

  it('broadcast conduite:state — la détachée reçoit la cue list', async () => {
    useCuelistStore.setState({
      cues: [{ id: 'c1', name: 'Blackout', cue_number: '3' }],
      currentCueIndex: 0,
    } as never);
    // L'intervalle 500ms est réel — on attend le premier broadcast.
    await vi.waitFor(() => {
      expect(getEmitCalls().some((c) => c.event === 'conduite:state')).toBe(true);
    }, { timeout: 1500 });
    const st = getEmitCalls().find((c) => c.event === 'conduite:state')?.payload;
    expect(st.cues[0]).toMatchObject({ id: 'c1', label: '3 Blackout', current: true });
  });
});
