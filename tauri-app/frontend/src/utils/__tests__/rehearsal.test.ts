/// <reference types="vitest/globals" />
import { describe, expect, it, beforeEach } from 'vitest';
import { doRehearsal, doSlot } from '../liveActions';
import { useGraphStore, getInvokeCalls, clearInvokeCalls, resetStore } from '../../store/__tests__/testHelpers';

// P1.12 : 'clear' doit annuler TOUS les timers de la bande — avant, un
// seul playTimer était écrasé en boucle et la bande continuait de tirer
// dans le show après annulation.
const slot = (id: string) =>
  ({
    id, name: id, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds: [1],
    movementId: null, isPreview: false,
  }) as never;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rehearsal replay', () => {
  beforeEach(() => {
    resetStore();
    clearInvokeCalls();
    doRehearsal('clear'); // purge l'état module entre les tests
    useGraphStore.setState({ moveSlots: [slot('s1')] } as never);
  });

  it('play sans clear → la bande rejoue les commandes', async () => {
    doRehearsal('record');
    doSlot(1); // enregistré via rec() + joue (activate_move)
    doRehearsal('stop');
    clearInvokeCalls();

    doRehearsal('play');
    await settle(150);
    expect(getInvokeCalls().map((c) => c.cmd)).toContain('activate_move');
    doRehearsal('clear');
  });

  it('clear annule TOUS les timers — aucun tir ne part après', async () => {
    doRehearsal('record');
    doSlot(1);
    doSlot(1);
    doSlot(1);
    doRehearsal('stop');
    // Les playSlot ENREGISTRÉS sont async (build du graphe) — leur invoke
    // tomberait après clearInvokeCalls et ferait croire à un replay.
    await settle(150);
    clearInvokeCalls();

    // play + clear synchrones : les timers ne peuvent pas s'intercaler.
    doRehearsal('play');
    doRehearsal('clear');
    await settle(200);
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain('activate_move');
  });
});
