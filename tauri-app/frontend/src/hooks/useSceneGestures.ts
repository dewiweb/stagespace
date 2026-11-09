import { useCallback, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { doClearPosition } from '../utils/liveActions';

interface UseSceneGesturesParams {
  /// De useScenePicking — pick objet (raycast + fallback proximité).
  pickObjectIndexAt: (
    e: { clientX: number; clientY: number },
    opts?: { proximityPx?: number },
  ) => number | null;
}

/**
 * Gestes transverses du viewer 3D — au niveau conteneur, dans TOUS les modes :
 * - clic-gauche SANS drag = sélection de l'objet le plus proche (tap-select,
 *   parité radar — hors modes interactifs qui gèrent leur propre clic)
 * - clic-droit SANS drag = release de la position manuelle de l'objet
 * Le clic se distingue du drag par déplacement <6px et durée <500ms
 * (OrbitControls pan/rotate utilisent le drag — le contexte natif est
 * supprimé globalement dans App.tsx).
 */
export function useSceneGestures({ pickObjectIndexAt }: UseSceneGesturesParams) {
  const leftDownRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const rightDownRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const handleScenePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 0) leftDownRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (e.button === 2) rightDownRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);

  const handleScenePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) {
        const d = rightDownRef.current;
        rightDownRef.current = null;
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 500) return;
        const idx = pickObjectIndexAt(e, { proximityPx: 40 });
        if (idx !== null) doClearPosition(idx);
        return;
      }
      if (e.button === 0) {
        const d = leftDownRef.current;
        leftDownRef.current = null;
        // Clic-gauche sans drag SÉLECTIONNE — seulement hors modes
        // interactifs (manipulate drag/assign/draw gèrent leur propre clic).
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 500) return;
        const s = useGraphStore.getState();
        if (s.manipulateMode || s.assignMode || s.drawMode || s.zonePlaceMode || s.zoneEditMode) return;
        const idx = pickObjectIndexAt(e, { proximityPx: 40 });
        s.setSelectedObjIndex(idx);
      }
    },
    [pickObjectIndexAt],
  );

  // Assign — clic sur un objet = toggle de sa track via la même source de
  // vérité que la TrackGrid (toggleTrackSelection → sélection + Objects
  // node + slot en édition : pas de chemin parallèle).
  const handleAssignDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas assign
      const idx = pickObjectIndexAt(e, { proximityPx: 40 });
      if (idx === null) return;
      const s = useGraphStore.getState();
      const trackId = s.holProject?.tracks[idx]?.id ?? s.manualOscIds[idx] ?? idx + 1;
      s.toggleTrackSelection(trackId);
    },
    [pickObjectIndexAt],
  );

  return { handleScenePointerDown, handleScenePointerUp, handleAssignDown };
}
