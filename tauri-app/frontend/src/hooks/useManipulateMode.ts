import { useRef, useState, useCallback, MutableRefObject } from 'react';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';

interface UseManipulateModeParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  objectsRef: MutableRefObject<THREE.Mesh[]>;
  handleRef: MutableRefObject<THREE.Mesh | null>;
  manipulateMode: boolean;
  assignMode: boolean;
}

/**
 * Gère le mode manipulation : drag des objets 3D et du handle,
 * rotation (shift+drag), scale (scroll), et mode assign (clic pour sélectionner).
 */
export function useManipulateMode({
  cameraRef,
  containerRef,
  objectsRef,
  handleRef,
  manipulateMode,
  assignMode,
}: UseManipulateModeParams) {
  const [draggingObject, setDraggingObject] = useState<number | null>(null);
  const draggingObjectRef = useRef<number | null>(null);
  const [draggingHandle, setDraggingHandle] = useState(false);
  // Track shift state for rotate vs move
  const shiftHeldRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartYawRef = useRef(0);

  const positions = useGraphStore((s) => s.positions);
  const movements = useGraphStore((s) => s.movements);
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const isPlaying = useGraphStore((s) => s.isPlaying);

  // Refs pour les valeurs lues dans les callbacks — évite les stale closures
  const positionsRef = useRef(positions);
  const movementsRef = useRef(movements);

  // Animation store ref — pour la manipulation directe 3D (offset, scale, rotation)
  const animStoreRef = useRef(useAnimationStore.getState());
  animStoreRef.current = useAnimationStore.getState();

  // Sync des refs à chaque render React (cheap — pas d'effet de bord)
  // movementPositions est lu via getState() dans les callbacks pour éviter
  // 60 re-renders/seconde (event global-positions à 60fps).
  positionsRef.current = positions;
  movementsRef.current = movements;
  draggingObjectRef.current = draggingObject;

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
      const objHits = raycaster.intersectObjects(objectsRef.current, true);
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
          if (assignMode) {
            // Mode assign: toggle cet objet dans la sélection de tracks
            const holProj = useGraphStore.getState().holProject;
            const manualIds = useGraphStore.getState().manualOscIds;
            let trackId: number | null = null;
            if (holProj && idx < holProj.tracks.length) {
              trackId = holProj.tracks[idx].id;
            } else if (idx < manualIds.length) {
              trackId = manualIds[idx];
            }
            if (trackId !== null) {
              useGraphStore.getState().toggleTrackSelection(trackId);
              // Sync l'animation store : si la track devient sélectionnée, ajouter un assignment à 100%
              const isSelected = useGraphStore.getState().selectedTrackIds.has(trackId);
              const animStore = animStoreRef.current;
              const existing = animStore.current.assignments.find((a) => a.track_id === trackId);
              if (isSelected && !existing) {
                animStore.updateAssignment(trackId, { depth: 1.0, phase_offset: 0 });
              }
            }
          } else {
            setDraggingObject(idx);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
        }
      }
    },
    [manipulateMode, assignMode],
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
          const globalPos = mvPosMap['global'];
          if (globalPos) {
            for (const p of globalPos) { cx += p.x; cy += p.y; count++; }
            if (count > 0) { cx /= count; cy /= count; }
          }
        }

        if (count > 0) {
          // Les positions sont déjà transformées par le backend — pas de macros
          const newShiftX = intersection.x - cx;
          const newShiftY = intersection.y - cy;
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
        const mesh = objectsRef.current[draggingObject];
        if (mesh) {
          mesh.position.x = intersection.x;
          mesh.position.z = intersection.z;
        }
        // Persister la position dans le store (manualPositions)
        useGraphStore.getState().setManualPosition(draggingObject, [
          intersection.x,
          mesh?.position.y ?? 0,
          intersection.z,
        ]);
        // Envoyer l'override au runtime (MergeRuntime — set_manual_position)
        if (isPlaying || movementsRef.current.length > 0) {
          invoke('set_manual_position', {
            objectIndex: draggingObject,
            position: [intersection.x, mesh?.position.y ?? 0, intersection.z],
          }).catch(console.error);
        }
      }
    },
    [manipulateMode, draggingObject, draggingHandle, positions, macros, setMacros, isPlaying],
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
      } catch {}
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
