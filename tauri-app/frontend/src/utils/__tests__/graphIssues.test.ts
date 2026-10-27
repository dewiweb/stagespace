import { describe, it, expect } from 'vitest';
import { issuesByNode, nodeIssueClass, countIssues } from '../graphIssues';
import type { GraphIssue } from '../graphIssues';

const err = (msg: string, ids: string[]): GraphIssue => ({
  severity: 'Error',
  message: msg,
  node_ids: ids,
});
const warn = (msg: string, ids: string[]): GraphIssue => ({
  severity: 'Warning',
  message: msg,
  node_ids: ids,
});

describe('graphIssues helpers', () => {
  it('agrège les issues par node, erreur prioritaire', () => {
    const map = issuesByNode([
      warn('dead', ['a', 'b']),
      err('type mismatch', ['b', 'c']),
      warn('dead2', ['b']),
    ]);
    expect(map.get('a')?.severity).toBe('Warning');
    expect(map.get('b')?.severity).toBe('Error'); // l'erreur l'emporte
    expect(map.get('b')?.messages).toHaveLength(3);
    expect(map.get('c')?.messages).toEqual(['type mismatch']);
  });

  it('classe par node', () => {
    const map = issuesByNode([err('x', ['n1']), warn('y', ['n2'])]);
    expect(nodeIssueClass(map, 'n1')).toBe('rf-node-error');
    expect(nodeIssueClass(map, 'n2')).toBe('rf-node-warning');
    expect(nodeIssueClass(map, 'n3')).toBeNull();
  });

  it('compte erreurs et warnings', () => {
    expect(
      countIssues([err('a', []), err('b', []), warn('c', [])]),
    ).toEqual({ errors: 2, warnings: 1 });
    expect(countIssues([])).toEqual({ errors: 0, warnings: 0 });
  });
});

import { portTypesInGraph, PORT_COLORS } from '../connectionRules';

describe('portTypesInGraph — légende contextuelle', () => {
  it('sub graph : Objects/Duration/Positions en ordre PORT_COLORS', () => {
    const types = portTypesInGraph(['Objects', 'Duration', 'Circular', 'Output']);
    expect(types).toContain('ObjectSet');
    expect(types).toContain('Duration');
    expect(types).toContain('Positions');
    expect(types).not.toContain('Signal');
    expect(types).toEqual(Object.keys(PORT_COLORS).filter((k) => types.includes(k as keyof typeof PORT_COLORS)));
  });

  it('signal graph : domaine Signal présent', () => {
    const types = portTypesInGraph(['SignalConst', 'SignalOut']);
    expect(types).toEqual(['Signal']);
    // LFO échantillonne une trajectoire Positions → les deux domaines.
    const withLfo = portTypesInGraph(['SignalConst', 'LFO', 'SignalOut']);
    expect(withLfo).toContain('Signal');
    expect(withLfo).toContain('Positions');
  });

  it('global graph : Positions uniquement (transforms + capteurs)', () => {
    const types = portTypesInGraph(['Merge', 'Scale', 'Zone', 'Velocity', 'Output']);
    expect(types).toEqual(['Positions']);
  });

  it('graphe vide / types inconnus → liste vide', () => {
    expect(portTypesInGraph([])).toEqual([]);
    expect(portTypesInGraph([undefined, 'NoSuchType' as never])).toEqual([]);
  });
});
