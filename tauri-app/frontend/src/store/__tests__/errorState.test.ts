/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, resetStore } from './testHelpers';

// Les actions compile/playGraph/previewGraph/stopGraph du chemin "graphe
// expert" legacy ont été supprimées — les moves passent exclusivement par
// les slots (activate_move). Ce fichier couvre les actions d'état d'erreur
// qui restent exposées à l'UI (Toolbar affiche compileError/playError).

beforeEach(() => {
  resetStore();
});

describe('clearCompileError', () => {
  it('clears compile error and resets status', () => {
    useGraphStore.setState({ compileError: 'some error', status: 'error', isPlaying: false } as any);
    useGraphStore.getState().clearCompileError();
    expect((useGraphStore.getState() as any).compileError).toBeNull();
    expect((useGraphStore.getState() as any).status).toBe('idle');
  });

  it('sets status to playing if moves are running', () => {
    // "Playing" se dérive de movements — le champ isPlaying a été supprimé.
    useGraphStore.setState({ compileError: 'some error', status: 'error', movements: [{ id: 'm1' }] } as any);
    useGraphStore.getState().clearCompileError();
    expect((useGraphStore.getState() as any).status).toBe('playing');
  });
});

describe('clearPlayError', () => {
  it('clears play error and resets status', () => {
    useGraphStore.setState({ playError: 'some error', status: 'error', isPlaying: false } as any);
    useGraphStore.getState().clearPlayError();
    expect((useGraphStore.getState() as any).playError).toBeNull();
    expect((useGraphStore.getState() as any).status).toBe('idle');
  });
});
