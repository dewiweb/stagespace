import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGraphHistory } from '../graphHistory';

/// graphHistory — pile undo/redo burst-fusionnée partagée par les stores
/// standalone (Global FX / Modulation).
describe('createGraphHistory', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('undo restore le snapshot enregistré avant la mutation', () => {
    const h = createGraphHistory<string, string>();
    let nodes = ['A'];
    h.record(nodes, []);
    nodes = ['A', 'B'];
    vi.advanceTimersByTime(500); // hors fenêtre de merge → entrée distincte
    h.record(nodes, []);
    nodes = ['A', 'B', 'C'];

    const snap = h.undo(nodes, []);
    expect(snap?.nodes).toEqual(['A', 'B']);
  });

  it('fusionne un burst de mutations en une seule entrée', () => {
    const h = createGraphHistory<string, string>(50, 400);
    h.record(['A'], []);
    // Deux mutations dans la fenêtre de merge → une seule entrée.
    h.record(['A', 'B'], []);
    h.record(['A', 'B', 'C'], []);
    expect(h.depth().past).toBe(1);
    // Après la fenêtre, nouvelle entrée.
    vi.advanceTimersByTime(500);
    h.record(['A', 'B', 'C', 'D'], []);
    expect(h.depth().past).toBe(2);
  });

  it('redo rejoue après undo ; une nouvelle mutation purge le futur', () => {
    const h = createGraphHistory<string, string>();
    h.record(['A'], []);
    vi.advanceTimersByTime(500);
    const undone = h.undo(['B'], []);
    expect(undone?.nodes).toEqual(['A']);
    const redone = h.redo(undone!.nodes, []);
    expect(redone?.nodes).toEqual(['B']);

    // Nouvelle mutation après undo → la branche redo est perdue.
    const h2 = createGraphHistory<string, string>();
    h2.record(['A'], []);
    h2.undo(['B'], []);
    h2.record(['A', 'C'], []);
    expect(h2.redo(['x'], [])).toBeNull();
  });

  it('cap la pile à maxEntries', () => {
    const h = createGraphHistory<string, string>(3);
    for (let i = 0; i < 6; i++) {
      h.record([`n${i}`], []);
      vi.advanceTimersByTime(500);
    }
    expect(h.depth().past).toBe(3);
  });

  it('undo sur pile vide retourne null ; clear vide tout', () => {
    const h = createGraphHistory<string, string>();
    expect(h.undo([], [])).toBeNull();
    h.record(['A'], []);
    h.clear();
    expect(h.undo(['B'], [])).toBeNull();
  });
});
