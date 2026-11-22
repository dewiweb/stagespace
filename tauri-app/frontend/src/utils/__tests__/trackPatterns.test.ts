import { describe, it, expect } from 'vitest';
import { applySelectionPattern, TRACK_PATTERNS } from '../trackPatterns';

const IDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('applySelectionPattern', () => {
  it('all / none', () => {
    expect(applySelectionPattern('all', IDS, new Set())).toEqual(IDS);
    expect(applySelectionPattern('none', IDS, new Set(IDS))).toEqual([]);
  });

  it('even / odd — parité sur l\'index, pas sur la valeur de l\'id', () => {
    const ids = [10, 20, 30, 40]; // ids pairs mais indices alternés
    expect(applySelectionPattern('even', ids, new Set())).toEqual([10, 30]);
    expect(applySelectionPattern('odd', ids, new Set())).toEqual([20, 40]);
  });

  it('halves — unpaired count : 1st half prend l\'élément du milieu', () => {
    const ids = [1, 2, 3, 4, 5];
    expect(applySelectionPattern('first_half', ids, new Set())).toEqual([1, 2, 3]);
    expect(applySelectionPattern('second_half', ids, new Set())).toEqual([3, 4, 5]);
  });

  it('inverse — complémentaire de la sélection courante', () => {
    expect(applySelectionPattern('inverse', IDS, new Set([2, 4]))).toEqual([1, 3, 5, 6, 7, 8]);
  });

  it('liste vide → sélection vide quel que soit le pattern', () => {
    for (const p of TRACK_PATTERNS) {
      expect(applySelectionPattern(p.id, [], new Set())).toEqual([]);
    }
  });
});
