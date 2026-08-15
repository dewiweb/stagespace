import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';

/// Conversion backend (x, y, z) où z=up → Three.js (x, z, y) où y=up
function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

interface TrajectoryVisualizationProps {
  sceneRef: React.RefObject<THREE.Scene | null>;
  objectsRef: React.RefObject<THREE.Mesh[]>;
  isPlaying: boolean;
  hasMovements: boolean;
  nObjects: number;
}

/**
 * Visualisation des trajectoires — échantillonne le runtime et dessine des lignes 3D.
 * Se déclenche à la compilation, au changement de macros (debounce 200ms), ou au changement d'objets.
 * Extrait de Scene3D.
 */
export const TrajectoryVisualization: React.FC<TrajectoryVisualizationProps> = ({
  sceneRef, objectsRef, isPlaying, hasMovements, nObjects,
}) => {
  const pathLinesRef = useRef<THREE.Line[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const macros = useGraphStore((s) => s.macros);
  const graphCompileVersion = useGraphStore((s) => s.graphCompileVersion);
  const movements = useGraphStore((s) => s.movements);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const currentAnim = useAnimationStore((s) => s.current);

  // Trouver le movementId du slot sélectionné
  const selectedMovementId = editingSlotId
    ? moveSlots.find((s) => s.id === editingSlotId)?.movementId ?? null
    : null;
  // Si un move est sélectionné, n'afficher que son path ; sinon afficher tous
  const movementsToShow = selectedMovementId
    ? movements.filter((m) => m.id === selectedMovementId)
    : movements;

  const macrosKey = `${macros.speed},${macros.scale},${macros.shiftX},${macros.shiftY},${macros.shiftZ},${macros.yaw},${macros.pitch},${macros.roll},${macros.radius_scale},${macros.height_offset}`;
  const movementIdsKey = movementsToShow.map((m) => m.id).join(',');
  // animKey capture tous les params qui affectent la forme du path (live ou non)
  const animKey = [
    JSON.stringify(currentAnim.graph_json),
    currentAnim.duration,
    currentAnim.scale,
    currentAnim.offset_x, currentAnim.offset_y, currentAnim.offset_z,
    currentAnim.yaw, currentAnim.pitch, currentAnim.roll,
    currentAnim.phase_spread,
    currentAnim.direction, currentAnim.loop_mode,
    JSON.stringify(currentAnim.assignments.map((a) => `${a.track_id}:${a.depth}`)),
  ].join(',');

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!(isPlaying || hasMovements) || !objectsRef.current || objectsRef.current.length === 0) return;

    const timer = setTimeout(() => {
      // Nettoyer les anciennes lignes
      pathLinesRef.current.forEach((l) => {
        scene.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
      pathLinesRef.current = [];

      let cancelled = false;

      const fetchTrajectory = async () => {
        try {
          const nObjs = objectsRef.current?.length ?? 0;
          const nSamples = 128;

          // Mode movement (système multi-move) : échantillonner depuis les movements à afficher
          // (uniquement le move sélectionné si editingSlotId pointe vers un move actif, sinon tous)
          if (hasMovements && movementsToShow.length > 0) {
            const durationNode = useGraphStore.getState().nodes.find((n) => (n.data as any)?.type === 'Duration');
            const duration = (durationNode?.data as any)?.params?.duration ?? 4.0;
            // Échantillonner chaque movement à afficher
            for (const movement of movementsToShow) {
              for (let i = 0; i < nObjs; i++) {
                if (cancelled) return;
                try {
                  const samples = await invoke<Array<[number, number, number, number]>>('sample_movement_trajectory', {
                    movementId: movement.id, objectIndex: i, nSamples, duration,
                  });
                  if (cancelled || samples.length < 2) continue;

                  const points = samples.map((s) => {
                    const [tx, ty, tz] = toThree(s[1], s[2], s[3]);
                    return new THREE.Vector3(tx, ty, tz);
                  });
                  const geo = new THREE.BufferGeometry().setFromPoints(points);
                  const hue = i / nObjs;
                  const mat = new THREE.LineBasicMaterial({
                    color: new THREE.Color().setHSL(hue, 0.7, 0.5),
                    transparent: true, opacity: movement.is_preview ? 0.2 : 0.35,
                  });
                  const line = new THREE.Line(geo, mat);
                  scene.add(line);
                  pathLinesRef.current.push(line);
                } catch {
                  // Un movement peut ne pas avoir de runtime — silencieux
                }
              }
            }
            return;
          }

          // Mode legacy (graphe expert) : échantillonner depuis le runtime global
          const graphNodes = useGraphStore.getState().nodes;
          const durationNode = graphNodes.find((n) => (n.data as any)?.type === 'Duration');
          const duration = (durationNode?.data as any)?.params?.duration ?? 4.0;

          for (let i = 0; i < nObjs; i++) {
            if (cancelled) return;
            const samples = await invoke<Array<[number, number, number, number]>>('sample_trajectory', {
              objectIndex: i, nSamples, duration,
            });
            if (cancelled || samples.length < 2) continue;

            const points = samples.map((s) => {
              const [tx, ty, tz] = toThree(s[1], s[2], s[3]);
              return new THREE.Vector3(tx, ty, tz);
            });
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const hue = i / nObjs;
            const mat = new THREE.LineBasicMaterial({
              color: new THREE.Color().setHSL(hue, 0.7, 0.5),
              transparent: true, opacity: 0.35,
            });
            const line = new THREE.Line(geo, mat);
            scene.add(line);
            pathLinesRef.current.push(line);
          }
        } catch {
          // invoke peut échouer si pas de runtime — silencieux
        }
      };

      fetchTrajectory();
      cancelRef.current = () => { cancelled = true; };
    }, 200);

    return () => {
      clearTimeout(timer);
      if (cancelRef.current) {
        cancelRef.current();
        cancelRef.current = null;
      }
    };
  }, [isPlaying, hasMovements, movementIdsKey, animKey, graphCompileVersion, nObjects, macrosKey, sceneRef, objectsRef]);

  // Cleanup à l'unmount
  useEffect(() => {
    return () => {
      const scene = sceneRef.current;
      if (!scene) return;
      pathLinesRef.current.forEach((l) => {
        scene.remove(l);
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
      pathLinesRef.current = [];
    };
  }, [sceneRef]);

  return null;
};
