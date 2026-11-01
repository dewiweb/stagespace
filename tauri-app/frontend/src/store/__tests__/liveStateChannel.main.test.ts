/// <reference types="vitest/globals" />
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getInvokeCalls, clearInvokeCalls } from './testHelpers';
import { getEmitCalls, clearEmitCalls } from '../../test/setup';

// Canal live:state — fenêtre PRINCIPALE (url sans ?view=) : elle poll le
// backend puis broadcaste le payload complet aux fenêtres détachées.
// Le poll initial part au chargement du module (perfSlice bottom).

describe('live:state — fenêtre principale', () => {
  beforeEach(() => {
    clearInvokeCalls();
    clearEmitCalls();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('poll santé complet → broadcast live:state (une fois, pas N×)', async () => {
    // Le poll initial a déjà tourné à l'import du module — attends qu'il
    // se termine (les invokes dynamiques résolvent en microtasks).
    await vi.waitFor(() => {
      expect(getEmitCalls().some((c) => c.event === 'live:state')).toBe(true);
    }, { timeout: 2000 });

    const cmds = getInvokeCalls().map((c) => c.cmd);
    // Le poll couvre les 4 métriques perf + les 2 santé show.
    for (const c of [
      'get_object_states',
      'get_psn_health',
      'get_emitted_positions',
      'get_perceptual_metrics',
      'get_parked_objects',
      'get_last_show_cmd_age',
    ]) {
      expect(cmds, `missing poll invoke ${c}`).toContain(c);
    }

    const live = getEmitCalls().find((c) => c.event === 'live:state');
    expect(live?.payload).toMatchObject({
      objectStates: expect.any(Object),
      flowHealth: expect.any(Object),
      emittedPositions: expect.any(Object),
      perceptual: expect.any(Object),
      parked: expect.any(Array),
    });
    expect(live?.payload).toHaveProperty('consoleAge');
  });
});
