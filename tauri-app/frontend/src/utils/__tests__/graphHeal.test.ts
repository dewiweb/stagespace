import { describe, it, expect } from 'vitest';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import { healEdgesForRemoval } from '../graphHeal';

/// Delete-heal : un node mid-chain supprimé recoud A→B si les types de
/// port correspondent — sémantique plugdata.
const node = (id: string, type: string): Node =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { type, label: type, params: {} } }) as Node;

const edge = (id: string, source: string, target: string, sh = 'out', th = 'in'): Edge => ({
  id, source, target, sourceHandle: sh, targetHandle: th,
});

const noKind = () => undefined;

describe('healEdgesForRemoval', () => {
  it('un modifier mid-chain recoud ses voisins (Circular → Scale → Output)', () => {
    const nodes = [node('a', 'Circular'), node('m', 'Scale'), node('b', 'Output')];
    const edges = [edge('e1', 'a', 'm'), edge('e2', 'm', 'b')];
    const heal = healEdgesForRemoval(new Set(['m']), nodes, edges, noKind);
    expect(heal).toHaveLength(1);
    expect(heal[0]).toMatchObject({
      source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  it('pas de heal quand les types de port sont incompatibles', () => {
    // Duration → Scale : la sortie Duration du node 'a' ne peut pas
    // alimenter l'entrée Positions du node 'b'.
    const nodes = [node('a', 'Duration'), node('m', 'Scale'), node('b', 'Output')];
    const edges = [
      edge('e1', 'a', 'm', 'duration', 'in'), // câblage fictif invalide — le test porte sur le type résolu
      edge('e2', 'm', 'b'),
    ];
    const heal = healEdgesForRemoval(new Set(['m']), nodes, edges, noKind);
    expect(heal).toHaveLength(0);
  });

  it('pas de heal sur un node terminal (1 entrée, 0 sortie)', () => {
    const nodes = [node('a', 'Circular'), node('b', 'Output')];
    const edges = [edge('e1', 'a', 'b')];
    expect(healEdgesForRemoval(new Set(['b']), nodes, edges, noKind)).toHaveLength(0);
  });

  it('pas de heal sur un node source (0 entrée, 1 sortie)', () => {
    const nodes = [node('a', 'Objects'), node('b', 'Circular'), node('c', 'Output')];
    const edges = [edge('e1', 'a', 'b', 'objects', 'in'), edge('e2', 'b', 'c')];
    expect(healEdgesForRemoval(new Set(['b']), nodes, edges, noKind)).toHaveLength(0);
  });

  it('pas de heal sur un composite binaire (2 entrées)', () => {
    const nodes = [
      node('a1', 'Circular'), node('a2', 'Linear'),
      node('m', 'Mix'), node('b', 'Output'),
    ];
    const edges = [
      edge('e1', 'a1', 'm', 'out', 'a'), edge('e2', 'a2', 'm', 'out', 'b'),
      edge('e3', 'm', 'b'),
    ];
    expect(healEdgesForRemoval(new Set(['m']), nodes, edges, noKind)).toHaveLength(0);
  });

  it('ignore les voisins eux-mêmes supprimés (multi-delete)', () => {
    const nodes = [node('a', 'Circular'), node('m', 'Scale'), node('b', 'Output')];
    const edges = [edge('e1', 'a', 'm'), edge('e2', 'm', 'b')];
    // 'm' et 'b' supprimés ensemble — le successeur n'existe plus.
    expect(healEdgesForRemoval(new Set(['m', 'b']), nodes, edges, noKind)).toHaveLength(0);
  });

  it('un node sans edges traverse sans heal (frames, isolés)', () => {
    const nodes = [node('f', 'Frame'), node('a', 'Circular')];
    expect(healEdgesForRemoval(new Set(['f']), nodes, [], noKind)).toHaveLength(0);
  });

  it('plusieurs nodes mid-chain supprimés en un geste → un heal chacun', () => {
    const nodes = [
      node('a', 'Circular'), node('m1', 'Scale'), node('b', 'Output'),
      node('x', 'Linear'), node('m2', 'Offset'), node('y', 'Output'),
    ];
    const edges = [
      edge('e1', 'a', 'm1'), edge('e2', 'm1', 'b'),
      edge('e3', 'x', 'm2'), edge('e4', 'm2', 'y'),
    ];
    const heal = healEdgesForRemoval(new Set(['m1', 'm2']), nodes, edges, noKind);
    expect(heal).toHaveLength(2);
    expect(heal.map((h) => `${h.source}->${h.target}`).sort()).toEqual(['a->b', 'x->y']);
  });
});
