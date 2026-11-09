import { useCallback, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { dollyCamera } from '../utils/three';

interface UseScenePickingParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  controlsRef: MutableRefObject<OrbitControls | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  sceneRef: MutableRefObject<THREE.Scene | null>;
  objectsRef: MutableRefObject<THREE.Mesh[]>;
}

/**
 * Pick partagé du viewer 3D — les helpers NDC→raycast utilisés par
 * tous les gestes (assign, release, select, zone edit/place) plus le
 * zoom manuel. Centralisés : le bloc NDC→raycaster n'est plus dupliqué.
 */
export function useScenePicking({
  cameraRef,
  controlsRef,
  containerRef,
  sceneRef,
  objectsRef,
}: UseScenePickingParams) {
  // Zoom manuel (dolly vers controls.target) — OrbitControls est désactivé
  // pendant les modes interactifs : sans ça la molette ne zoomait plus.
  const handleZoomWheel = useCallback((e: React.WheelEvent) => {
    dollyCamera(controlsRef.current, e.deltaY < 0 ? 0.92 : 1.08);
  }, [controlsRef]);

  // Raycaster générique NDC — null si caméra/container absents.
  const raycastAt = useCallback(
    (e: { clientX: number; clientY: number }): THREE.Raycaster | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return null;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const r = new THREE.Raycaster();
      r.setFromCamera(ndc, camera);
      return r;
    },
    [cameraRef, containerRef],
  );

  // Index d'objet au point écran — raycast sur les objets visibles, avec
  // fallback proximité : une sphère en mouvement est dure à viser, l'objet
  // le plus proche du clic (< proximityPx) est retourné.
  const pickObjectIndexAt = useCallback(
    (
      e: { clientX: number; clientY: number },
      opts?: { proximityPx?: number },
    ): number | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      const raycaster = raycastAt(e);
      if (!camera || !container || !raycaster) return null;
      const rect = container.getBoundingClientRect();
      const visibleObjs = objectsRef.current.filter((o) => o.visible);
      const hits = raycaster.intersectObjects(visibleObjs, true);
      if (hits.length > 0) {
        let hitObj = hits[0].object as THREE.Mesh;
        let idx = objectsRef.current.indexOf(hitObj);
        while (idx < 0 && hitObj.parent) {
          hitObj = hitObj.parent as THREE.Mesh;
          idx = objectsRef.current.indexOf(hitObj);
        }
        if (idx >= 0) return idx;
      }
      const maxPx = opts?.proximityPx ?? 0;
      if (maxPx <= 0) return null;
      let bd = maxPx;
      let best: number | null = null;
      for (const o of visibleObjs) {
        const p = o.position.clone().project(camera);
        if (p.z < -1 || p.z > 1) continue; // derrière la caméra
        const sx = ((p.x + 1) / 2) * rect.width;
        const sy = ((1 - p.y) / 2) * rect.height;
        const d = Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top));
        if (d < bd) {
          bd = d;
          best = objectsRef.current.indexOf(o);
        }
      }
      return best;
    },
    [cameraRef, containerRef, objectsRef, raycastAt],
  );

  // Index de zone manuelle au point écran — meshes tagués
  // userData.isZone par ZoneVisualization.
  const zoneIndexAt = useCallback(
    (raycaster: THREE.Raycaster): number | null => {
      const scene = sceneRef.current;
      if (!scene) return null;
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && o.userData.isZone !== true) o = o.parent;
        if (o?.userData.isZone === true) return o.userData.zoneIndex as number;
      }
      return null;
    },
    [sceneRef],
  );

  return { handleZoomWheel, raycastAt, pickObjectIndexAt, zoneIndexAt };
}
