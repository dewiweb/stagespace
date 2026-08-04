import { useRef, useState, useCallback, MutableRefObject } from 'react';
import * as THREE from 'three';
import { useGraphStore } from '../store/useGraphStore';

interface UseDrawModeParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
}

/**
 * Gère le mode dessin libre : conversion screen → world coords,
 * handlers de draw (start/move/end) sur le canvas overlay.
 */
export function useDrawMode({ cameraRef, containerRef }: UseDrawModeParams) {
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawStartTimeRef = useRef<number>(0);

  const drawMode = useGraphStore((s) => s.drawMode);
  const drawZ = useGraphStore((s) => s.drawZ);
  const addDrawnPoint = useGraphStore((s) => s.addDrawnPoint);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);

  // Convert screen coords to world coords on the Y=drawZ plane
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): [number, number, number] | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return null;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((screenX - rect.left) / rect.width) * 2 - 1,
        -((screenY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);

      // Intersect with horizontal plane at y = drawZ
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -drawZ);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        return [intersection.x, intersection.y, intersection.z];
      }
      return null;
    },
    [drawZ],
  );

  // Draw canvas handlers
  const handleDrawStart = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      clearDrawnPoints();
      drawStartTimeRef.current = performance.now();
      addDrawnPoint(world);
      setIsDrawing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [drawMode, screenToWorld, clearDrawnPoints, addDrawnPoint],
  );

  const handleDrawMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode || !isDrawing) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      // Threshold to avoid too many points
      const pts = useGraphStore.getState().drawnPoints;
      const last = pts[pts.length - 1];
      if (last) {
        const dist = Math.sqrt(
          (world[0] - last[0]) ** 2 +
          (world[1] - last[1]) ** 2 +
          (world[2] - last[2]) ** 2,
        );
        if (dist < 0.05) return;
      }
      addDrawnPoint(world);
    },
    [drawMode, isDrawing, screenToWorld, addDrawnPoint],
  );

  const handleDrawEnd = useCallback(
    async (e: React.PointerEvent) => {
      if (!drawMode || !isDrawing) return;
      setIsDrawing(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      await finalizeDrawing();
    },
    [drawMode, isDrawing, finalizeDrawing],
  );

  return { isDrawing, drawCanvasRef, handleDrawStart, handleDrawMove, handleDrawEnd };
}
