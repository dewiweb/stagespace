/// <reference types="vitest/globals" />
import { resetStore, useGraphStore } from './testHelpers';

const PREFS_KEY = 'stagespace.viewer.prefs';

describe('viewer prefs — trajectories & idle tracks (menu View)', () => {
  beforeEach(() => {
    resetStore();
    // États par défaut (le parse localStorage est module-level — on pose
    // les valeurs directement pour tester la mécanique, pas l'hydratation).
    useGraphStore.setState({ viewerTrajectories: true, viewerShowIdle: false } as any);
  });

  it('defaults — trajectoires visibles, idle tracks cachées', () => {
    // Les defaults reflètent le comportement historique : les paths 3D
    // ont toujours été dessinés, les objets hors moves toujours cachés.
    expect(useGraphStore.getState().viewerTrajectories).toBe(true);
    expect(useGraphStore.getState().viewerShowIdle).toBe(false);
  });

  it('toggle trajectories — persiste la combinaison complète des prefs', () => {
    useGraphStore.getState().setViewerTrajectories(false);
    expect(useGraphStore.getState().viewerTrajectories).toBe(false);
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(saved.traj).toBe(false);
    // Les autres prefs survivent au toggle — une clé seule ne doit pas
    // écraser le reste de la combinaison.
    expect(saved.ghosts).toBe(true);
    expect(saved.dim).toBe(true);
    expect(saved.idle).toBe(false);
  });

  it('toggle idle — persiste, et ne touche pas les autres prefs', () => {
    useGraphStore.getState().setViewerShowIdle(true);
    expect(useGraphStore.getState().viewerShowIdle).toBe(true);
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(saved.idle).toBe(true);
    expect(saved.traj).toBe(true);
  });

  it('les deux toggles sont indépendants', () => {
    useGraphStore.getState().setViewerShowIdle(true);
    useGraphStore.getState().setViewerTrajectories(false);
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(saved).toMatchObject({ traj: false, idle: true });
    // Et l'état en mémoire suit
    expect(useGraphStore.getState().viewerShowIdle).toBe(true);
    expect(useGraphStore.getState().viewerTrajectories).toBe(false);
  });
});
