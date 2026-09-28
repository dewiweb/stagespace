import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import { toThree } from '../utils/coords';
import { removeWithLabels } from '../utils/three';


interface UseObjects3DParams {
  sceneRef: MutableRefObject<THREE.Scene | null>;
  nObjects: number;
  /// Trigger pour recréer les objets quand la scène est prête
  sceneReady?: boolean;
}

/**
 * Crée les sphères (objets) + labels CSS2D.
 * Lit manualOscIds depuis useGraphStore.getState() (pas en paramètre, pour éviter re-création).
 *
 * Au lieu de tout recréer à chaque changement de nObjects, on fait un diff :
 * - ajouter les objets manquants
 * - retirer les objets en trop
 * - mettre à jour les labels des objets existants
 * Cela évite les labels orphelins/dupliqués dans le DOM du CSS2DRenderer.
 */
export function useObjects3D({ sceneRef, nObjects, sceneReady }: UseObjects3DParams) {
  const objectsRef = useRef<THREE.Mesh[]>([]);
  // Subscription réactive — les labels doivent se mettre à jour quand le
  // .hol se charge (track.id), même si nObjects ne change pas.
  const holProject = useGraphStore((s) => s.holProject);
  // Pas besoin de tracker les labels séparément — ils sont enfants des meshes
  // et sont nettoyés automatiquement par l'event 'removed' du CSS2DObject.

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const syncObjects = () => {
    if (cancelled) return;
    const scene = sceneRef.current;
    if (!scene) {
      // La scène peut ne pas exister encore (init du render loop, remount
      // StrictMode, sceneReady désynchronisé) — retenter à la prochaine
      // frame au lieu d'abandonner : sinon aucun objet n'est jamais créé
      // et la vue reste figée (positions reçues mais aucun mesh à animer).
      if (!cancelled) raf = requestAnimationFrame(syncObjects);
      return;
    }

    const oscIds = useGraphStore.getState().manualOscIds;
    const manualPos = useGraphStore.getState().manualPositions;
    const holTracks = holProject?.tracks ?? [];
    // Label : vrai track.id du .hol si chargé, sinon osc_id manuel, sinon index
    const labelFor = (i: number) => holTracks[i]?.id ?? oscIds[i] ?? i + 1;
    const current = objectsRef.current;
    const currentCount = current.length;

    // 1. Retirer les objets en trop (du dernier vers le premier)
    if (currentCount > nObjects) {
      for (let i = currentCount - 1; i >= nObjects; i--) {
        const obj = current[i];
        // removeWithLabels : sans ça, l'event 'removed' n'atteint pas le
        // CSS2DObject enfant → son div reste orphelin dans le DOM du
        // CSS2DRenderer (label figé, visible alors que le mesh est parti).
        removeWithLabels(scene, obj);
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
      current.length = nObjects;
    }

    // 2. Ajouter les objets manquants
    for (let i = currentCount; i < nObjects; i++) {
      const geo = new THREE.SphereGeometry(0.2, 24, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(i / Math.max(nObjects, 1), 0.7, 0.55),
        emissive: new THREE.Color().setHSL(i / Math.max(nObjects, 1), 0.5, 0.2),
        roughness: 0.4,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const pos = manualPos[i];
      if (pos) {
        const [tx, ty, tz] = toThree(pos[0], pos[1], pos[2]);
        mesh.position.set(tx, ty, tz);
      } else {
        // Fallback: cercle horizontal en backend coords (z=0)
        const angle = (i / Math.max(nObjects, 1)) * Math.PI * 2;
        const radius = nObjects <= 4 ? 1.5 : nObjects <= 8 ? 2.0 : nObjects <= 16 ? 3.0 : 4.0;
        const [tx, ty, tz] = toThree(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        mesh.position.set(tx, ty, tz);
      }

      // Label — track.id (.hol) > osc_id manuel > index
      const labelId = labelFor(i);
      const div = document.createElement('div');
      div.className = 'obj-label';
      div.textContent = `#${labelId}`;
      div.style.cssText = 'color: #ddd; font-size: 9px; font-family: monospace; background: rgba(0,0,0,0.4); padding: 1px 3px; border-radius: 2px; white-space: nowrap; pointer-events: none;';
      const label = new CSS2DObject(div);
      label.position.set(0, 0.3, 0);
      mesh.add(label);

      scene.add(mesh);
      current.push(mesh);
    }

    // 3. Mettre à jour les labels des objets existants (au cas où oscIds/hol a changé)
    for (let i = 0; i < Math.min(currentCount, nObjects); i++) {
      const mesh = current[i];
      const labelId = labelFor(i);
      const label = mesh.children.find((c: any) => c.isCSS2DObject) as CSS2DObject | undefined;
      if (label && label.element) {
        const newText = `#${labelId}`;
        if (label.element.textContent !== newText) {
          label.element.textContent = newText;
        }
      }
    }
    };
    syncObjects();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [nObjects, sceneReady, sceneRef, holProject]);

  return { objectsRef, objectLabelsRef: objectsRef };
}
