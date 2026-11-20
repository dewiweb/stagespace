import { useRef, useState, useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useGraphStore } from '../store/useGraphStore';
import { fromThree, toThree } from '../utils/coords';
import { moveCp, deleteCp, insertCpAtU, nearestU, type DrawView } from '../utils/splineCore';

interface UseDrawModeParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  controlsRef: MutableRefObject<OrbitControls | null>;
}

/** Seuil de hit CP en pixels — cohérent avec la proximité objet (~40px). */
const CP_HIT_PX = 24;

/** Plan de dessin Three.js par vue — drawZ = offset le long de la normale. */
function drawPlane(view: DrawView, offset: number): THREE.Plane {
  switch (view) {
    case 'front':
      // Élévation : plan (x, z) à backend y = offset → three z = offset.
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -offset);
    case 'side':
      // Élévation latérale : plan (y, z) à backend x = offset → three x = offset.
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -offset);
    case 'top':
    case 'free':
    default:
      // Plan : (x, y) à backend z = offset → three y = offset.
      return new THREE.Plane(new THREE.Vector3(0, 1, 0), -offset);
  }
}

interface SavedCam {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  up: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Spline studio — mode dessin/édition de trajectoires.
 *
 * Trois outils (drawModeSlice.splineTool) :
 * - `freehand` : drag = stroke brut → pointerup fit en CPs → bascule `edit`
 * - `place`    : clic = ajout de point de contrôle
 * - `edit`     : drag CP / clic-droit CP = delete / double-clic = insert
 * Le commit (écriture dans le node) est explicité par le bouton Done.
 */
export function useDrawMode({ cameraRef, containerRef, controlsRef }: UseDrawModeParams) {
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const draggingCpRef = useRef<number | null>(null);
  const savedCamRef = useRef<SavedCam | null>(null);

  const drawMode = useGraphStore((s) => s.drawMode);
  const drawZ = useGraphStore((s) => s.drawZ);
  const drawView = useGraphStore((s) => s.drawView);

  // ── Vues fixées : snap caméra + verrou rotation + restore à la sortie ──
  // Le snap préserve la cible et la distance courantes (framing gardé) ;
  // pan/zoom restent actifs, seule la rotation est verrouillée.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const view = drawView;
    if (!drawMode || view === 'free') {
      if (savedCamRef.current) {
        camera.position.copy(savedCamRef.current.pos);
        camera.quaternion.copy(savedCamRef.current.quat);
        camera.up.copy(savedCamRef.current.up);
        controls.target.copy(savedCamRef.current.target);
        savedCamRef.current = null;
      }
      controls.enableRotate = true;
      controls.update();
      return;
    }
    if (!savedCamRef.current) {
      savedCamRef.current = {
        pos: camera.position.clone(),
        quat: camera.quaternion.clone(),
        up: camera.up.clone(),
        target: controls.target.clone(),
      };
    }
    const t = controls.target;
    const d = Math.max(camera.position.distanceTo(t), 2);
    camera.up.set(0, 1, 0);
    // Epsilon latéral sur la vue top — évite la singularité de pôle exacte
    // d'OrbitControls (azimuth indéterminé à polar=0).
    if (view === 'top') {
      camera.up.set(0, 0, 1); // upstage (+y backend = +z three) en haut de l'écran
      camera.position.set(t.x, t.y + d, t.z + d * 0.001);
    } else if (view === 'front') {
      camera.position.set(t.x, t.y, t.z + d);
    } else {
      camera.position.set(t.x + d, t.y, t.z);
    }
    controls.enableRotate = false;
    controls.update();
  }, [drawMode, drawView, cameraRef, controlsRef]);

  // Convert screen coords to world coords on the view's drawing plane
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

      const plane = drawPlane(useGraphStore.getState().drawView, drawZ);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        // Convertir Three.js (x, y=up, z=depth) → backend (x, y=depth, z=up)
        return fromThree(intersection.x, intersection.y, intersection.z);
      }
      return null;
    },
    [drawZ, cameraRef, containerRef],
  );

  // Index du CP le plus proche du curseur (< CP_HIT_PX écran) — projection
  // world→NDC→pixels, pas de raycast : les CPs sont des positions connues.
  const cpIndexAt = useCallback(
    (screenX: number, screenY: number): number | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      const cps = useGraphStore.getState().controlPoints;
      if (!camera || !container || cps.length === 0) return null;

      const rect = container.getBoundingClientRect();
      const px = screenX - rect.left;
      const py = screenY - rect.top;
      const v = new THREE.Vector3();
      let best: number | null = null;
      let bestD = CP_HIT_PX;
      for (let i = 0; i < cps.length; i++) {
        const [tx, ty, tz] = toThree(cps[i][0], cps[i][1], cps[i][2]);
        v.set(tx, ty, tz).project(camera);
        const cx = ((v.x + 1) / 2) * rect.width;
        const cy = ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(cx - px, cy - py);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [cameraRef, containerRef],
  );

  const handleDrawStart = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();

      if (st.splineTool === 'edit' && e.button === 2) {
        // Clic-droit sur un CP = suppression.
        const idx = cpIndexAt(e.clientX, e.clientY);
        if (idx !== null) st.setControlPoints(deleteCp(st.controlPoints, idx));
        return;
      }
      if (e.button !== 0) return; // autres boutons : release/gestes transverses

      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;

      if (st.splineTool === 'place') {
        st.setControlPoints([...st.controlPoints, world]);
        return;
      }

      if (st.splineTool === 'edit') {
        const idx = cpIndexAt(e.clientX, e.clientY);
        if (idx !== null) {
          st.pushCpSnapshot(); // un seul snapshot pour tout le drag
          draggingCpRef.current = idx;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
        return;
      }

      // freehand — collecte du stroke brut
      st.clearDrawnPoints();
      st.addDrawnPoint(world);
      setIsDrawing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [drawMode, screenToWorld, cpIndexAt],
  );

  const handleDrawMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();

      // Drag d'un CP en mode edit
      const cpIdx = draggingCpRef.current;
      if (cpIdx !== null) {
        const world = screenToWorld(e.clientX, e.clientY);
        if (world) st.setControlPoints(moveCp(st.controlPoints, cpIdx, world), false);
        return;
      }

      if (st.splineTool !== 'freehand' || !isDrawing) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      // Threshold to avoid too many points
      const pts = st.drawnPoints;
      const last = pts[pts.length - 1];
      if (last) {
        const dist = Math.sqrt(
          (world[0] - last[0]) ** 2 +
          (world[1] - last[1]) ** 2 +
          (world[2] - last[2]) ** 2,
        );
        if (dist < 0.05) return;
      }
      st.addDrawnPoint(world);
    },
    [drawMode, isDrawing, screenToWorld],
  );

  const handleDrawEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // capture déjà relâchée (sortie de canvas, unmount) — pas bloquant
      }
      if (draggingCpRef.current !== null) {
        draggingCpRef.current = null;
        return;
      }
      if (!isDrawing) return;
      setIsDrawing(false);
      // Le stroke devient un jeu de CPs éditable — commit explicite via Done.
      useGraphStore.getState().commitStroke();
    },
    [drawMode, isDrawing],
  );

  // Double-clic en mode edit = insertion d'un CP sur la courbe au point
  // cliqué (nearest-u → splice). En mode place : rien (clics simples suffisent).
  const handleDrawDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();
      if (st.splineTool !== 'edit' || st.controlPoints.length < 2) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      const u = nearestU(st.controlPoints, world, st.splineClosed);
      st.setControlPoints(insertCpAtU(st.controlPoints, u, st.splineClosed));
    },
    [drawMode, screenToWorld],
  );

  return {
    isDrawing,
    drawCanvasRef,
    handleDrawStart,
    handleDrawMove,
    handleDrawEnd,
    handleDrawDoubleClick,
  };
}
