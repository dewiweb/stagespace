import { MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface UseInteractionModesParams {
  controlsRef: MutableRefObject<OrbitControls | null>;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  drawMode: boolean;
  manipulateMode: boolean;
  assignMode: boolean;
}

/**
 * Active/désactive OrbitControls selon le mode (draw/manipulate/assign).
 * Gère les pointer events du canvas WebGL.
 *
 * Mutation impérative de refs Three.js — pas besoin de useEffect car :
 * - ce sont des refs (pas du DOM React)
 * - la mutation est idempotente et cheap
 * - pas de cleanup nécessaire
 */
export function useInteractionModes({
  controlsRef,
  rendererRef,
  drawMode,
  manipulateMode,
  assignMode,
}: UseInteractionModesParams) {
  const interactMode = drawMode || manipulateMode || assignMode;
  if (controlsRef.current) {
    controlsRef.current.enabled = !interactMode;
  }
  // Le canvas WebGL reçoit les events seulement quand OrbitControls est actif
  // (sinon les couches draw/manipulate au-dessus s'en chargent)
  if (rendererRef.current) {
    rendererRef.current.domElement.style.pointerEvents = interactMode ? 'none' : 'auto';
  }
}
