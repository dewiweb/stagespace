import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';

interface UseObjects3DParams {
  sceneRef: MutableRefObject<THREE.Scene | null>;
  nObjects: number;
  /// Trigger pour recréer les objets quand la scène est prête
  sceneReady?: boolean;
}

/**
 * Crée les sphères (objets) + labels CSS2D.
 * Lit manualOscIds depuis useGraphStore.getState() (pas en paramètre, pour éviter re-création).
 */
export function useObjects3D({ sceneRef, nObjects, sceneReady }: UseObjects3DParams) {
  const objectsRef = useRef<THREE.Mesh[]>([]);
  const objectLabelsRef = useRef<CSS2DObject[]>([]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old objects + labels (dispose geometry/material pour éviter les fuites)
    objectsRef.current.forEach((obj) => {
      scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    });
    objectsRef.current = [];
    objectLabelsRef.current.forEach((l) => scene.remove(l));
    objectLabelsRef.current = [];

    // Add new objects + labels
    const oscIds = useGraphStore.getState().manualOscIds;
    const manualPos = useGraphStore.getState().manualPositions;
    for (let i = 0; i < nObjects; i++) {
      const geo = new THREE.SphereGeometry(0.2, 24, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(i / nObjects, 0.7, 0.55),
        emissive: new THREE.Color().setHSL(i / nObjects, 0.5, 0.2),
        roughness: 0.4,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // Position initiale: manualPositions si disponible, sinon cercle par défaut
      const pos = manualPos[i];
      if (pos) {
        mesh.position.set(pos[0], pos[1], pos[2]);
      } else {
        // Fallback: cercle
        const angle = (i / nObjects) * Math.PI * 2;
        const radius = nObjects <= 4 ? 1.5 : nObjects <= 8 ? 2.0 : 2.5;
        mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      }
      scene.add(mesh);
      objectsRef.current.push(mesh);

      // Label — utilise l'osc_id si disponible, sinon l'index
      const labelId = oscIds[i] ?? i + 1;
      const div = document.createElement('div');
      div.className = 'obj-label';
      div.textContent = `#${labelId}`;
      div.style.cssText = 'color: #ddd; font-size: 9px; font-family: monospace; background: rgba(0,0,0,0.4); padding: 1px 3px; border-radius: 2px; white-space: nowrap; pointer-events: none;';
      const label = new CSS2DObject(div);
      label.position.set(0, 0.3, 0);
      mesh.add(label);
      objectLabelsRef.current.push(label);
    }
  }, [nObjects, sceneReady]);

  return { objectsRef, objectLabelsRef };
}
