import { useRef, useState, useCallback, MutableRefObject } from 'react';
import * as THREE from 'three';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { throttleTrailingKeyed } from '../utils/throttle';
import { fromThree } from '../utils/coords';

interface UseManipulateModeParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  objectsRef: MutableRefObject<THREE.Mesh[]>;
  handleRef: MutableRefObject<THREE.Mesh | null>;
  manipulateMode: boolean;
}

/**
 * Gère le mode manipulation : drag des objets 3D et du handle,
 * rotation (shift+drag), scale (scroll).
 * (L'assignation de tracks se fait dans la TrackGrid — mode assign retiré.)
 */
export function useManipulateMode({
  cameraRef,
  containerRef,
  objectsRef,
  handleRef,
  manipulateMode,
}: UseManipulateModeParams) {
  const [draggingObject, setDraggingObject] = useState<number | null>(null);
  const draggingObjectRef = useRef<number | null>(null);
  const [draggingHandle, setDraggingHandle] = useState(false);
  // Track shift state for rotate vs move
  const shiftHeldRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartYawRef = useRef(0);

  const movements = useGraphStore((s) => s.movements);
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const isPlaying = useGraphStore((s) => s.movements.length > 0);

  // Refs pour les valeurs lues dans les callbacks — évite les stale closures
  const movementsRef = useRef(movements);

  // Move store ref — pour la manipulation directe 3D (offset, scale, rotation)
  const animStoreRef = useRef(useMoveEditorStore.getState());
  animStoreRef.current = useMoveEditorStore.getState();

  // Sync des refs à chaque render React (cheap — pas d'effet de bord)
  // movementPositions est lu via getState() dans les callbacks pour éviter
  // 60 re-renders/seconde (event global-positions à 60fps).
  movementsRef.current = movements;
  draggingObjectRef.current = draggingObject;

  // Drag 3D : un invoke par pointermove saturerait l'IPC — throttle trailing
  // ~33ms (30fps suffit pour le merge, la dernière position est toujours poussée).
  const pushManualPositionThrottled = useRef(
    throttleTrailingKeyed((objectIndex: number, position: [number, number, number]) => {
      invoke('set_manual_position', { objectIndex, position }).catch(console.error);
    }, 33),
  );

  // Manipulate handlers — drag objects or handle
  const handleManipulateDown = useCallback(
    (e: React.PointerEvent) => {
      if (!manipulateMode) return;
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);

      // Check handle first
      if (handleRef.current) {
        const hits = raycaster.intersectObject(handleRef.current);
        if (hits.length > 0) {
          setDraggingHandle(true);
          shiftHeldRef.current = e.shiftKey;
          dragStartPosRef.current = { x: e.clientX, y: e.clientY };
          dragStartYawRef.current = animStoreRef.current.current.yaw;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      }

      // Check objects — recursive:true pour traverser les enfants (labels CSS2DObject)
      // IMPORTANT: Raycaster ne teste PAS le flag `visible` — sans ce filtre,
      // les tracks cachées par le focus slot restent cliquables/draggables.
      const visibleObjs = objectsRef.current.filter((o) => o.visible);
      const objHits = raycaster.intersectObjects(visibleObjs, true);
      if (objHits.length > 0) {
        // Trouver l'objet parent dans objectsRef (peut être un enfant si labels ajoutés)
        let hitObj = objHits[0].object as THREE.Mesh;
        let idx = objectsRef.current.indexOf(hitObj);
        // Si l'objet touché est un enfant (ex: label), remonter au parent
        while (idx < 0 && hitObj.parent) {
          hitObj = hitObj.parent as THREE.Mesh;
          idx = objectsRef.current.indexOf(hitObj);
        }
        if (idx >= 0) {
          setDraggingObject(idx);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
      }
    },
    [manipulateMode, cameraRef, containerRef, handleRef, objectsRef],
  );

  const handleManipulateMove = useCallback(
    (e: React.PointerEvent) => {
      if (!manipulateMode) return;
      if (draggingObject === null && !draggingHandle) return;

      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);

      // Project on Y = current Y plane
      const currentY = draggingHandle
        ? handleRef.current?.position.y ?? 0
        : (draggingObject !== null ? objectsRef.current?.[draggingObject]?.position.y ?? 0 : 0);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -currentY);
      const intersection = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, intersection)) return;

      if (draggingHandle) {
        // Shift+drag = rotation (yaw) de la trajectoire
        if (shiftHeldRef.current && dragStartPosRef.current) {
          const dx = e.clientX - dragStartPosRef.current.x;
          // 1 pixel = 0.5° de rotation
          const newYaw = dragStartYawRef.current + dx * 0.5;
          // Clamp à -180..180
          const clampedYaw = Math.max(-180, Math.min(180, newYaw));
          // Mettre à jour l'animation store (nouveau système)
          animStoreRef.current.updateCurrent({ yaw: clampedYaw });
          // Aussi mettre à jour les macros legacy pour compat
          setMacros({ ...macros, yaw: clampedYaw });
          return;
        }

        // Normal drag = move the whole trajectory (offset)
        // Utilise les positions du backend (global-positions) — pas de recalcul
        const mvts = movementsRef.current;
        const mvPosMap = useGraphStore.getState().movementPositions;
        let cx = 0, cy = 0, count = 0;

        if (mvts.length > 0) {
          // Multi-movement: utiliser les positions mergées du backend
          // Les positions du backend sont en coords Z-up (x, y=depth, z=up)
          // intersection est en coords Three.js Y-up (x, y=up, z=depth)
          // Pour le centroid, on utilise x et z (depth) du backend
          const globalPos = mvPosMap['global'];
          if (globalPos) {
            for (const p of globalPos) { cx += p.x; cy += p.y; count++; }
            if (count > 0) { cx /= count; cy /= count; }
          }
        }

        if (count > 0) {
          // intersection.x = Three.js x = backend x
          // intersection.z = Three.js z (depth) = backend y
          const newShiftX = intersection.x - cx;
          const newShiftY = intersection.z - cy;
          // Mettre à jour les macros legacy
          setMacros({
            ...macros,
            shiftX: newShiftX,
            shiftY: newShiftY,
            shiftZ: 0,
          });
          // Mettre à jour l'animation store (nouveau système)
          animStoreRef.current.updateCurrent({
            offset_x: newShiftX,
            offset_y: newShiftY,
          });
        }
      } else if (draggingObject !== null) {
        // Move individual object — update mesh + persist to store
        // Three.js: intersection est en coords Y-up (x=right, y=up, z=depth)
        // Backend: stocke en coords Z-up (x=right, y=depth, z=up)
        const mesh = objectsRef.current[draggingObject];
        if (mesh) {
          mesh.position.x = intersection.x;
          mesh.position.z = intersection.z;
        }
        // Conversion Three.js (x, y=up, z=depth) → backend (x, y=depth, z=up)
        const backendPos = fromThree(intersection.x, mesh?.position.y ?? 0, intersection.z);
        useGraphStore.getState().setManualPosition(draggingObject, backendPos);
        // Toujours invoquer — depuis P1.1 une position manuelle émet même
        // sans move live ; sinon le drag-while-stopped divergeait en silence.
        pushManualPositionThrottled.current(draggingObject, backendPos);
      }
    },
    [manipulateMode, draggingObject, draggingHandle, macros, setMacros, isPlaying, cameraRef, containerRef, handleRef, objectsRef],
  );

  const handleManipulateUp = useCallback(
    (e: React.PointerEvent) => {
      // Si on relâche un objet draggé, garder l'override (ne pas effacer)
      setDraggingObject(null);
      setDraggingHandle(false);
      shiftHeldRef.current = false;
      dragStartPosRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // capture déjà relâchée (sortie de canvas, unmount) — pas bloquant
      }
    },
    [],
  );

  // Scroll = scale la trajectoire (quand on est sur le handle en manipulate mode)
  const handleManipulateWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!manipulateMode) return;
      // deltaY < 0 = scroll up = agrandir
      const factor = e.deltaY < 0 ? 1.05 : 0.95;
      const animStore = animStoreRef.current;
      const newScale = Math.max(0.1, Math.min(4.0, animStore.current.scale * factor));
      animStore.updateCurrent({ scale: newScale });
      // Aussi mettre à jour les macros legacy
      setMacros({ ...useGraphStore.getState().macros, scale: newScale });
    },
    [manipulateMode, setMacros],
  );

  return {
    draggingObject,
    setDraggingObject,
    draggingHandle,
    setDraggingHandle,
    draggingObjectRef,
    handleManipulateDown,
    handleManipulateMove,
    handleManipulateUp,
    handleManipulateWheel,
  };
}
