/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../../store/useSessionStore';
import { useGraphStore } from '../../store/useGraphStore';
import { guardDirty, initDirtyTracking, initWindowCloseGuard, getPendingUnsavedAction, clearPendingUnsavedAction } from '../sessionSafety';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ dirty: false, currentShowPath: null, recentShows: [] });
  });

  it('markDirty → dirty, markClean → clean + chemin + recent', () => {
    const s = useSessionStore.getState();
    s.markDirty();
    expect(useSessionStore.getState().dirty).toBe(true);
    s.markClean('/shows/toto.hfg');
    const st = useSessionStore.getState();
    expect(st.dirty).toBe(false);
    expect(st.currentShowPath).toBe('/shows/toto.hfg');
    expect(st.recentShows[0]).toBe('/shows/toto.hfg');
  });

  it('recents — dédup, tête = dernier, cap MAX', () => {
    const s = useSessionStore.getState();
    s.markClean('/a.hfg');
    s.markClean('/b.hfg');
    s.markClean('/a.hfg');
    const r = useSessionStore.getState().recentShows;
    expect(r[0]).toBe('/a.hfg');
    expect(r.filter((p) => p === '/a.hfg')).toHaveLength(1);
    expect(r).toHaveLength(2);
  });

  it('markUntitled — clean sans chemin, recents préservés', () => {
    const s = useSessionStore.getState();
    s.markClean('/a.hfg');
    s.markDirty();
    s.markUntitled();
    const st = useSessionStore.getState();
    expect(st.dirty).toBe(false);
    expect(st.currentShowPath).toBeNull();
    expect(st.recentShows).toContain('/a.hfg');
  });
});

describe('guardDirty', () => {
  beforeEach(() => {
    clearPendingUnsavedAction();
    useSessionStore.setState({ dirty: false });
  });

  it('clean → exécute directement', () => {
    let ran = false;
    guardDirty('Test', () => { ran = true; });
    expect(ran).toBe(true);
    expect(getPendingUnsavedAction()).toBeNull();
  });

  it('dirty → arme la modale, n\'exécute pas', () => {
    useSessionStore.setState({ dirty: true });
    let ran = false;
    guardDirty('Test', () => { ran = true; });
    expect(ran).toBe(false);
    expect(getPendingUnsavedAction()?.label).toBe('Test');
    getPendingUnsavedAction()?.run();
    expect(ran).toBe(true);
  });
});

describe('initDirtyTracking', () => {
  beforeEach(() => {
    useSessionStore.setState({ dirty: false });
  });

  it('mutation d\'une clé document → dirty ; clé runtime → pas dirty', () => {
    const unsub = initDirtyTracking();
    const g = useGraphStore.getState();
    // Clé document : setlistOrder
    useGraphStore.setState({ setlistOrder: [...g.setlistOrder, 'x'] });
    expect(useSessionStore.getState().dirty).toBe(true);
    useSessionStore.setState({ dirty: false });
    // Clé runtime (pas dans la whitelist) : selectedObjIndex
    useGraphStore.setState({ selectedObjIndex: 3 });
    expect(useSessionStore.getState().dirty).toBe(false);
    unsub();
    // Après unsub : plus de tracking.
    useGraphStore.setState({ setlistOrder: [...useGraphStore.getState().setlistOrder, 'y'] });
    expect(useSessionStore.getState().dirty).toBe(false);
  });
});

describe('initWindowCloseGuard — Quit', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const handlers = () =>
    g.__closeRequestedHandlers as Array<(e: { preventDefault: () => void }) => unknown>;
  const win = () =>
    g.__windowMock as { close: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    handlers().length = 0;
    win().close.mockClear();
    win().destroy.mockClear();
    useSessionStore.setState({ dirty: false });
    clearPendingUnsavedAction();
  });

  it('dirty → preventDefault + modale armée ; Discard → markClean + close()', async () => {
    const unlisten = initWindowCloseGuard();
    await Promise.resolve(); // laisse onCloseRequested().then() se résoudre
    useSessionStore.setState({ dirty: true });

    const prevented = { prevented: false };
    await handlers()[0]({ preventDefault: () => { prevented.prevented = true; } });
    expect(prevented.prevented).toBe(true);
    expect(getPendingUnsavedAction()?.label).toBe('Quit');

    // Discard : l'action fait markClean + close() (jamais destroy() —
    // allow-destroy absent des capabilities, IPC refusé en silence).
    getPendingUnsavedAction()?.run();
    await Promise.resolve();
    expect(useSessionStore.getState().dirty).toBe(false);
    expect(win().close).toHaveBeenCalledTimes(1);
    expect(win().destroy).not.toHaveBeenCalled();

    // Ré-entrée : notre close() réémet CloseRequested → la garde laisse
    // passer même si le cleanup a re-sali le doc entre-temps.
    useSessionStore.setState({ dirty: true });
    const again = { prevented: false };
    await handlers()[0]({ preventDefault: () => { again.prevented = true; } });
    expect(again.prevented).toBe(false);
    unlisten();
  });

  it('clean → pas de preventDefault, pas de modale', async () => {
    const unlisten = initWindowCloseGuard();
    await Promise.resolve();
    const e = { prevented: false };
    await handlers()[0]({ preventDefault: () => { e.prevented = true; } });
    expect(e.prevented).toBe(false);
    expect(getPendingUnsavedAction()).toBeNull();
    unlisten();
  });
});
