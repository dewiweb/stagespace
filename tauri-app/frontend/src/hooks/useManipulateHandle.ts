import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';

interface UseManipulateHandleParams {
  sceneRef: MutableRefObject<THREE.Scene | null>;
  manipulateMode: boolean;
}

/**
 * Crée le handle (octahedron) + trajectory line quand manipulateMode est actif.
 * La position du handle est mise à jour dans le render loop de Scene3D.
 */
export function useManipulateHandle({ sceneRef, manipulateMode }: UseManipulateHandleParams) {
  const handleRef = useRef<THREE.Mesh | null>(null);
  const trajectoryLineRef = useRef<THREE.Line | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old handle + line
    if (handleRef.current) {
      scene.remove(handleRef.current);
      handleRef.current.geometry.dispose();
      (handleRef.current.material as THREE.Material).dispose();
      handleRef.current = null;
    }
    if (trajectoryLineRef.current) {
      scene.remove(trajectoryLineRef.current);
      trajectoryLineRef.current.geometry.dispose();
      (trajectoryLineRef.current.material as THREE.Material).dispose();
      trajectoryLineRef.current = null;
    }

    if (!manipulateMode) return;

    // Handle = octahedron (position mise à jour dans le render loop)
    const handleGeo = new THREE.OctahedronGeometry(0.2, 0);
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.8,
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    scene.add(handle);
    handleRef.current = handle;

    // Trajectory line — geometry vide au départ, mise à jour dans le render loop
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0)]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xff8800,
      dashSize: 0.15,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.5,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    scene.add(line);
    trajectoryLineRef.current = line;
  }, [manipulateMode]);

  return { handleRef, trajectoryLineRef };
}
