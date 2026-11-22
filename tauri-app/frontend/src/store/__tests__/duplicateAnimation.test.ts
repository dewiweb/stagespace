/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import type { Move } from '../useMoveEditorStore';

// setup.ts mocke globalement useMoveEditorStore (mutable plain state) —
// importActual donne le vrai store zustand pour tester l'action réelle.
const { useMoveEditorStore } = await vi.importActual<typeof import('../useMoveEditorStore')>(
  '../useMoveEditorStore',
);

const makeAnim = (id: string, name: string): Move => ({
  id,
  name,
  graph_json: { nodes: [{ id: 'n1' }], edges: [] },
  assignments: [],
  audio_mods: [],
} as unknown as Move);

describe('duplicateAnimation', () => {
  beforeEach(() => {
    useMoveEditorStore.setState({ animations: [] });
  });

  it('clone profond, id frais, inséré après la source', () => {
    const a = makeAnim('a', 'Orbit');
    const b = makeAnim('b', 'Wave');
    useMoveEditorStore.setState({ animations: [a, b] });

    useMoveEditorStore.getState().duplicateAnimation('a');

    const anims = useMoveEditorStore.getState().animations;
    expect(anims).toHaveLength(3);
    expect(anims[1].id).not.toBe('a');
    expect(anims[1].name).toBe('Orbit copy');
    // Deep clone — muter la copie ne touche pas la source.
    (anims[1].graph_json as { nodes: { id: string }[] }).nodes[0].id = 'MUTATED';
    expect((anims[0].graph_json as { nodes: { id: string }[] }).nodes[0].id).toBe('n1');
  });

  it('no-op sur id inconnu', () => {
    useMoveEditorStore.setState({ animations: [makeAnim('a', 'Orbit')] });
    useMoveEditorStore.getState().duplicateAnimation('zzz');
    expect(useMoveEditorStore.getState().animations).toHaveLength(1);
  });
});
