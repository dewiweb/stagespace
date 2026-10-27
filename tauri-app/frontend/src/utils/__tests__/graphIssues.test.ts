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
