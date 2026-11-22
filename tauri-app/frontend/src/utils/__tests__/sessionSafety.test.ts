/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../../store/useSessionStore';
import { useGraphStore } from '../../store/useGraphStore';
import { guardDirty, initDirtyTracking, getPendingUnsavedAction, clearPendingUnsavedAction } from '../sessionSafety';

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
