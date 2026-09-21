/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import { useGraphStore, getInvokeCalls, setInvokeResponse, resetStore } from './testHelpers';
import { toast } from '../useToastStore';

// Le panic est LE contrôle d'urgence du show — ses promesses doivent être
// véridiques : stop inconditionnel, échecs remontés, pas de faux succès.
describe('panic', () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  it('calls deactivate_all_moves unconditionally — even with an empty movement cache', async () => {
    // movements: [] (stale cache) — panic ne doit PAS s'en servir de garde :
    // des moves backend peuvent tourner sans que le frontend le sache.
    useGraphStore.setState({ movements: [] } as any);
    await useGraphStore.getState().panic();
    const cmds = getInvokeCalls().map((c) => c.cmd);
    expect(cmds).toContain('deactivate_all_moves');
  });

  it('reports partial failure (sticky error) when the backend stop fails — never claims success', async () => {
    const errSpy = vi.spyOn(toast, 'error');
    const warnSpy = vi.spyOn(toast, 'warning');
    setInvokeResponse('deactivate_all_moves', new Error('backend dead'));
    await useGraphStore.getState().panic();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('PANIC partially failed'), 0);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('all moves stopped'), expect.anything());
  });

  it('still sends origin positions when the stop itself failed', async () => {
    setInvokeResponse('deactivate_all_moves', new Error('backend dead'));
    useGraphStore.setState({ manualOscIds: [1, 2] } as any);
    await useGraphStore.getState().panic();
    const sends = getInvokeCalls().filter((c) => c.cmd === 'send_osc_position');
    // Le stop a échoué mais les positions de parking doivent quand même partir.
    expect(sends.length).toBe(2);
  });

  it('does not claim "positions reset" when no destination exists', async () => {
    const warnSpy = vi.spyOn(toast, 'warning');
    useGraphStore.setState({ holProject: null, manualOscIds: [] } as any);
    await useGraphStore.getState().panic();
    // Aucun envoi possible → le message ne doit pas prétendre un reset.
    expect(warnSpy).toHaveBeenCalledWith('PANIC — all moves stopped', 4000);
  });

  it('reports failed position sends as partial failure', async () => {
    const errSpy = vi.spyOn(toast, 'error');
    setInvokeResponse('send_osc_position', new Error('no route'));
    useGraphStore.setState({ holProject: null, manualOscIds: [1, 2, 3] } as any);
    await useGraphStore.getState().panic();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('3 position reset(s) lost'), 0);
  });
});
