import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';

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
  const currentAnim = useAnimationStore((s) => s.current);

  const macrosKey = `${macros.speed},${macros.scale},${macros.shiftX},${macros.shiftY},${macros.shiftZ},${macros.yaw},${macros.pitch},${macros.roll},${macros.radius_scale},${macros.height_offset}`;
  const movementIdsKey = movements.map((m) => m.id).join(',');
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
    if (!(isPlaying || hasMovements) || objectsRef.current.length === 0) return;

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
          const nObjs = objectsRef.current.length;
          const nSamples = 128;

          // Mode movement (système Animation) : échantillonner depuis le movement actif
          if (hasMovements && movements.length > 0) {
            const movement = movements[0]; // premier movement actif
            const duration = movement.track_count > 0 ? currentAnim.duration : 4.0;
            for (let i = 0; i < Math.min(nObjs, 9); i++) {
              if (cancelled) return;
              const samples = await invoke<Array<[number, number, number, number]>>('sample_movement_trajectory', {
                movementId: movement.id, objectIndex: i, nSamples, duration,
              });
              if (cancelled || samples.length < 2) continue;

              const points = samples.map((s) => new THREE.Vector3(s[1], s[2], s[3]));
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
            return;
          }

          // Mode legacy (graphe expert) : échantillonner depuis le runtime global
          const graphNodes = useGraphStore.getState().nodes;
          const durationNode = graphNodes.find((n) => (n.data as any)?.type === 'Duration');
          const duration = (durationNode?.data as any)?.params?.duration ?? 4.0;

          for (let i = 0; i < Math.min(nObjs, 9); i++) {
            if (cancelled) return;
            const samples = await invoke<Array<[number, number, number, number]>>('sample_trajectory', {
              objectIndex: i, nSamples, duration,
            });
            if (cancelled || samples.length < 2) continue;

            const points = samples.map((s) => new THREE.Vector3(s[1], s[2], s[3]));
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
