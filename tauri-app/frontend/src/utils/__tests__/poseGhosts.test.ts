/// <reference types="vitest/globals" />
/// P6 — fantômes de pose : entries (positions absolues + flag patched,
/// tri stable) et cycle de sélection du store (le delete tue la sélection
/// pour ne pas laisser de fantômes orphelins).
import { describe, it, expect, beforeEach } from 'vitest';
import { poseGhostEntries } from '../poseGhosts';
import { usePoseStore } from '../../store/usePoseStore';
import { resetStore, setInvokeResponse, getInvokeCalls } from '../../store/__tests__/testHelpers';
import type { Pose } from '../../types/generated/Pose';

const pose: Pose = {
  name: 'line-up',
  positions: { 3: [-2.5, 2, 0], 1: [2, 1.5, 0], 5: [0, 0, 1] },
};

beforeEach(() => {
  resetStore();
  usePoseStore.setState({ poses: [], selectedPoseName: null });
});

describe('poseGhostEntries', () => {
  it('une entrée par track, triée par track_id (ordre stable)', () => {
    const entries = poseGhostEntries(pose, [1, 2, 3, 4, 5]);
    expect(entries.map((e) => e.trackId)).toEqual([1, 3, 5]);
    expect(entries[0].position).toEqual([2, 1.5, 0]);
    expect(entries[1].position).toEqual([-2.5, 2, 0]);
  });

  it('patched = la track est dans le mapping courant', () => {
    const entries = poseGhostEntries(pose, [1, 2, 3]); // track 5 non patchée
    expect(entries.find((e) => e.trackId === 1)!.patched).toBe(true);
    expect(entries.find((e) => e.trackId === 5)!.patched).toBe(false);
  });

  it('positions absolues — aucune résolution obj (la cible est un point de l\'espace)', () => {
    // Mapping vide : les entries existent quand même, toutes unpatched.
    const entries = poseGhostEntries(pose, []);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => !e.patched)).toBe(true);
  });
});

describe('usePoseStore — sélection pour les fantômes', () => {
  it('selectPose / deselect', () => {
    usePoseStore.getState().selectPose('line-up');
    expect(usePoseStore.getState().selectedPoseName).toBe('line-up');
    usePoseStore.getState().selectPose(null);
    expect(usePoseStore.getState().selectedPoseName).toBeNull();
  });

  it('deletePose tue la sélection — pas de fantômes orphelins', async () => {
    setInvokeResponse('pose_delete', null);
    setInvokeResponse('pose_list', []);
    usePoseStore.setState({
      poses: [pose],
      selectedPoseName: 'line-up',
    });

    await usePoseStore.getState().deletePose('line-up');

    expect(usePoseStore.getState().selectedPoseName).toBeNull();
    expect(getInvokeCalls().filter((c) => c.cmd === 'pose_delete')).toHaveLength(1);
  });

  it('deletePose épargne la sélection d\'une autre pose', async () => {
    setInvokeResponse('pose_delete', null);
    setInvokeResponse('pose_list', []);
    usePoseStore.setState({
      poses: [pose, { name: 'cluster', positions: { 2: [0, 0, 0] } }],
      selectedPoseName: 'cluster',
    });

    await usePoseStore.getState().deletePose('line-up');

    expect(usePoseStore.getState().selectedPoseName).toBe('cluster');
  });
});
