/**
 * @vitest-environment-options {"url": "http://localhost/?view=run"}
 */
/// <reference types="vitest/globals" />
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getInvokeCalls, clearInvokeCalls } from './testHelpers';
import { emitMockEvent } from '../../test/setup';
import { useGraphStore } from '../useGraphStore';
import { useShowStatusStore } from '../useShowStatusStore';
import { useCuelistStore } from '../useCuelistStore';
import type { LiveStatePayload } from '../slices/perfSlice';

// Canal live:state — fenêtre DÉTACHÉE (?view=run via le pragma url) :
// elle NE poll PAS le backend (l'intervalle n'existe pas) — elle écoute
// le broadcast de la fenêtre principale et écrit les deux stores.

const payload: LiveStatePayload = {
  objectStates: { 0: 'park', 1: 'move', 2: 'psn' },
  flowHealth: { psnRunning: true, psnAge: 120, armed: false, showCmdAgeS: 3.2 },
  emittedPositions: { 0: [1, 2, 0], 1: [0, 0, 0], 2: [-3, 1, 0.5] },
  perceptual: { legibility_deg_s: { 1: 4.2 }, looming_ms: 1.1, vection: 0.3 },
  parked: [0],
  consoleAge: 2.5,
  manualPositions: { 1: [0.5, 1.0, 0.0], 2: [-1.0, 0.0, 0.25] },
  cueIndex: 3,
  setlistIndex: 1,
  soloSavedIds: ['s1', 's2'],
};

describe('live:state — fenêtre détachée (?view=run)', () => {
  beforeEach(() => {
    clearInvokeCalls();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('ne poll pas le backend — aucun invoke de surveillance', async () => {
    await new Promise((r) => setTimeout(r, 60));
    const cmds = getInvokeCalls().map((c) => c.cmd);
    for (const c of ['get_object_states', 'get_psn_health', 'get_emitted_positions', 'get_perceptual_metrics', 'get_parked_objects', 'get_last_show_cmd_age']) {
      expect(cmds).not.toContain(c);
    }
  });

  it('applique le broadcast live:state dans les deux stores', async () => {
    emitMockEvent('live:state', payload);
    // Les imports dynamiques du listener résolvent en microtasks.
    await vi.waitFor(() => {
      expect(useGraphStore.getState().objectStates[0]).toBe('park');
    }, { timeout: 1000 });
    expect(useGraphStore.getState().emittedPositions[0]).toEqual([1, 2, 0]);
    expect(useGraphStore.getState().flowHealth.psnAge).toBe(120);
    expect(useGraphStore.getState().perceptual.looming_ms).toBe(1.1);
    expect(useShowStatusStore.getState().parked).toEqual([0]);
    expect(useShowStatusStore.getState().consoleAge).toBe(2.5);
    expect(useGraphStore.getState().manualPositions[1]).toEqual([0.5, 1.0, 0.0]);
    // Indices volatiles propagés — NOW/NEXT n'est plus figé à -1.
    expect(useCuelistStore.getState().currentCueIndex).toBe(3);
    expect(useGraphStore.getState().currentSetlistIndex).toBe(1);
    expect(useGraphStore.getState().soloSavedIds).toEqual(['s1', 's2']);
    expect(useShowStatusStore.getState().armed).toBe(false);
  });
});
