import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { useObjects3D } from '../useObjects3D';
import { useGraphStore } from '../../store/useGraphStore';

// Régression : l'effect abandonnait silencieusement quand sceneRef.current
// était null (fenêtre StrictMode remount / init render loop). Résultat :
// objs=0 dans le render loop — positions reçues à 60fps mais aucun mesh à
// animer → vue figée alors que les moves tournaient.

describe('useObjects3D', () => {
  let rafCallbacks: FrameRequestCallback[];
  let nextRafId: number;

  beforeEach(() => {
    rafCallbacks = [];
    nextRafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++nextRafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
    useGraphStore.setState({
      holProject: null,
      manualOscIds: [1, 2, 3, 4],
      manualPositions: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushRaf = () => {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach((cb) => cb(performance.now()));
  };

  it('creates meshes immediately when the scene exists', () => {
    const scene = new THREE.Scene();
    const sceneRef = { current: scene };
    const { result } = renderHook(() =>
      useObjects3D({ sceneRef, nObjects: 4, sceneReady: true }),
    );
    expect(result.current.objectsRef.current).toHaveLength(4);
    expect(scene.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(4);
  });

  it('retries next frame when the scene is not ready yet', () => {
    const sceneRef: { current: THREE.Scene | null } = { current: null };
    const { result } = renderHook(() =>
      useObjects3D({ sceneRef, nObjects: 4, sceneReady: false }),
    );
    // Scène absente au mount : aucun mesh, mais un retry est planifié
    expect(result.current.objectsRef.current).toHaveLength(0);
    expect(rafCallbacks.length).toBeGreaterThan(0);

    // La scène apparaît (init du render loop) — le RAF retry crée les meshes
    sceneRef.current = new THREE.Scene();
    flushRaf();
    expect(result.current.objectsRef.current).toHaveLength(4);
    expect(sceneRef.current.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(4);
  });

  it('stops retrying after unmount (no scene.add on a dead hook)', () => {
    const sceneRef: { current: THREE.Scene | null } = { current: null };
    const { result, unmount } = renderHook(() =>
      useObjects3D({ sceneRef, nObjects: 4, sceneReady: false }),
    );
    unmount();
    sceneRef.current = new THREE.Scene();
    flushRaf();
    // cancelled=true : le RAF callback ne schedule plus rien, pas de meshes
    expect(result.current.objectsRef.current).toHaveLength(0);
    expect(rafCallbacks.length).toBe(0);
    expect(sceneRef.current.children).toHaveLength(0);
  });
});
