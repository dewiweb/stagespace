import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { usePoseStore } from '../store/usePoseStore';
import { useGraphStore } from '../store/useGraphStore';
import { toThree } from '../utils/coords';
import { removeWithLabels } from '../utils/three';
import { poseGhostEntries } from '../utils/poseGhosts';
import { VIZ } from '../utils/uiColors';

interface UsePoseGhostsParams {
  sceneRef: MutableRefObject<THREE.Scene | null>;
}

/// Couleurs — cible/destination (teal VIZ.target : même vocabulaire que
/// les autres visualisations de destination), warning pour une track
/// non patchée (serait skippée au recall — même code que le badge ⚠
/// du panel). Labels = variants lisibles sur fond noir.
const CIRCLE_SEGMENTS = 32;
const CIRCLE_RADIUS = 0.32;

/**
 * Fantômes de pose — cercles pointillés + labels aux positions cibles de
 * la pose sélectionnée dans le panel (P6). Même pattern que
 * `useHolMarkers` : marqueurs recréés quand la sélection/les poses/la
 * pref changent. Cercles horizontaux (plan XZ) — lisibles sans billboard,
 * aucune modification du render loop. La pref « fantômes » existante
 * (viewerRestGhosts) est étendue aux poses — désactivée = aucun fantôme.
 */
export function usePoseGhosts({ sceneRef }: UsePoseGhostsParams) {
  const poseGhostsRef = useRef<THREE.LineLoop[]>([]);
  const poses = usePoseStore((s) => s.poses);
  const selectedPoseName = usePoseStore((s) => s.selectedPoseName);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const ghostsEnabled = useGraphStore((s) => s.viewerRestGhosts);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const syncGhosts = () => {
      if (cancelled) return;
      const scene = sceneRef.current;
      if (!scene) {
        if (!cancelled) raf = requestAnimationFrame(syncGhosts);
        return;
      }

      // Nettoyage systématique — removeWithLabels détache le CSS2DObject
      // enfant du DOM (l'event 'removed' ne se propage pas aux descendants).
      poseGhostsRef.current.forEach((m) => {
        removeWithLabels(scene, m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      poseGhostsRef.current = [];

      if (!ghostsEnabled || !selectedPoseName) return;
      const pose = poses.find((p) => p.name === selectedPoseName);
      if (!pose) return;

      for (const entry of poseGhostEntries(pose, manualOscIds)) {
        // Cercle pointillé horizontal (plan XZ — le sol spatial) centré
        // sur la cible : pas besoin de billboard pour être lisible, le
        // cercle au sol marque la position comme un tapis de spot.
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
          const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * CIRCLE_RADIUS, 0, Math.sin(a) * CIRCLE_RADIUS));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineDashedMaterial({
          color: entry.patched ? VIZ.target : VIZ.targetInvalid,
          dashSize: 0.09,
          gapSize: 0.06,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        });
        const circle = new THREE.LineLoop(geo, mat);
        circle.computeLineDistances();
        const [tx, ty, tz] = toThree(entry.position[0], entry.position[1], entry.position[2]);
        circle.position.set(tx, ty, tz);
        scene.add(circle);
        poseGhostsRef.current.push(circle);

        // Label — enfant du cercle (visibilité automatique), nom de pose
        // + track ciblée. Le nom est répété sur chaque fantôme : à
        // distance on identifie la formation sans recouper avec le panel.
        const div = document.createElement('div');
        div.className = 'pose-ghost-label';
        div.textContent = `${pose.name} #${entry.trackId}`;
        div.style.cssText = `color: ${entry.patched ? VIZ.targetLabel : VIZ.targetInvalidLabel}; font-size: 9px; font-family: monospace; background: rgba(0,0,0,0.45); padding: 0 3px; border-radius: 2px; white-space: nowrap;`;
        const label = new CSS2DObject(div);
        label.position.set(0, 0.28, 0);
        circle.add(label);
      }
    };
    syncGhosts();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [poses, selectedPoseName, manualOscIds, ghostsEnabled, sceneRef]);

  return { poseGhostsRef };
}
