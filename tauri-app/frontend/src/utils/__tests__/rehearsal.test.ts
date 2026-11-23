/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { doRehearsal, doSlot } from '../liveActions';
import { useScoreTape } from '../../hooks/useScoreTape';
import { emitMockEvent, clearListeners } from '../../test/setup';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';

// S1 : l'horloge de lecture vit dans le backend (`score_load`/`score_play`
// → thread → `score-fire`). Le frontend pousse la bande et exécute les
// entrées tirées — plus de setTimeout (revue M7 résolue par construction :
// le backend n'a qu'un seul thread de lecture par génération).
const slot = (id: string) =>
  ({
    id, name: id, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds: [1],
    movementId: null, isPreview: false,
  }) as never;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rehearsal — horloge backend (S1)', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    clearListeners();
    doRehearsal('clear'); // purge l'état module entre les tests
    clearInvokeCalls();
    useGraphStore.setState({ moveSlots: [slot('s1')] } as never);
  });

  it('play pousse la bande au backend puis arme la lecture', async () => {
    doRehearsal('record');
    doSlot(1); // enregistré via rec() + joue (activate_move)
    doRehearsal('stop');
    await settle(150);
    clearInvokeCalls();

    doRehearsal('play');
    await settle(50);
    const calls = getInvokeCalls().map((c) => c.cmd);
    expect(calls).toContain('score_load');
    expect(calls).toContain('score_play');
    // score_load reçoit les entrées enregistrées (doSlot).
    const load = getInvokeCalls().find((c) => c.cmd === 'score_load');
    expect((load?.args?.entries as { name: string }[])?.[0]?.name).toBe('doSlot');
  });

  it('un score-fire backend exécute la commande enregistrée', async () => {
    renderHook(() => useScoreTape());
    await settle(20);
    emitMockEvent('score-fire', { t: 0, name: 'doSlot', args: [1] });
    await settle(50);
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('activate_move');
  });

  it('clear vide la bande backend — plus aucun tir possible', () => {
    doRehearsal('clear');
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('score_clear');
  });

  it('stop coupe la lecture backend', () => {
    doRehearsal('stop');
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('score_stop');
  });
});
