import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HolProject } from '../store/useGraphStore';
import { toThree } from '../utils/coords';


interface UseHolMarkersParams {
  sceneRef: MutableRefObject<THREE.Scene | null>;
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  holProject: HolProject | null;
}

/**
 * Crée les marqueurs Holophonix (anneaux + labels CSS2D) pour chaque track du holProject.
 * Le billboard effect (lookAt camera) reste dans le render loop de Scene3D.
 */
export function useHolMarkers({ sceneRef, cameraRef, holProject }: UseHolMarkersParams) {
  const holMarkersRef = useRef<THREE.Mesh[]>([]);
  const holLabelsRef = useRef<CSS2DObject[]>([]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old markers + labels (dispose geometry/material pour éviter les fuites)
    holMarkersRef.current.forEach((m) => {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    holLabelsRef.current.forEach((l) => scene.remove(l));
    holMarkersRef.current = [];
    holLabelsRef.current = [];

    if (!holProject) return;

    holProject.tracks.forEach((track) => {
      // Marker (small ring)
      const geo = new THREE.RingGeometry(0.08, 0.12, 24);
      const color = new THREE.Color(track.color || '#888888');
      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(geo, mat);
      const [rx, ry, rz] = toThree(track.position[0], track.position[1], track.position[2]);
      ring.position.set(rx, ry, rz);
      ring.lookAt(cameraRef.current!.position);
      scene.add(ring);
      holMarkersRef.current.push(ring);

      // Label
      const div = document.createElement('div');
      div.className = 'hol-track-label';
      div.textContent = `${track.name} (#${track.id})`;
      div.style.cssText = 'color: #aaa; font-size: 10px; font-family: monospace; background: rgba(0,0,0,0.5); padding: 1px 4px; border-radius: 2px; white-space: nowrap;';
      const label = new CSS2DObject(div);
      label.position.set(rx, ry + 0.25, rz);
      scene.add(label);
      holLabelsRef.current.push(label);
    });
  }, [holProject, sceneRef, cameraRef]);

  return { holMarkersRef, holLabelsRef };
}
