import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { toThree } from '../utils/coords';


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
  const currentAnim = useMoveEditorStore((s) => s.current);

  // Trouver le movementId du slot sélectionné
  const selectedMovementId = editingSlotId
    ? moveSlots.find((s) => s.id === editingSlotId)?.movementId ?? null
    : null;
  // Focus cohérent avec la scène : slot sélectionné → son path seulement
  // (stoppé = aucun path) ; aucun slot sélectionné → tous les paths.
  // useMemo : identité stable entre renders (le filter sinon crée un tableau
  // neuf à chaque render → l'effet ci-dessous re-samplerait en boucle).
  const movementsToShow = useMemo(
    () => (editingSlotId ? movements.filter((m) => m.id === selectedMovementId) : movements),
    [movements, selectedMovementId, editingSlotId],
  );

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
            const durationNode = useGraphStore.getState().nodes.find((n) => n.data.type === 'Duration');
            const duration = (durationNode?.data as any)?.params?.duration ?? 4.0;
            // Échantillonner chaque movement à afficher — UN invoke batché
            // par move (sample_movement_trajectories retourne tous les paths
            // avec leur track_index global). Avant : nObjs invokes séquentiels
            // par move, dont la plupart échouaient silencieusement pour les
            // moves couvrant peu de tracks.
            for (const movement of movementsToShow) {
              if (cancelled) return;
              try {
                const paths = await invoke<Array<{ track_index: number; points: Array<[number, number, number, number]> }>>(
                  'sample_movement_trajectories',
                  { movementId: movement.id, nSamples, duration },
                );
                for (const path of paths) {
                  if (cancelled) return;
                  if (path.points.length < 2) continue;

                  const points = path.points.map((s) => {
                    const [tx, ty, tz] = toThree(s[1], s[2], s[3]);
                    return new THREE.Vector3(tx, ty, tz);
                  });
                  const geo = new THREE.BufferGeometry().setFromPoints(points);
                  // Teinte par track_index global — stable entre moves
                  const hue = path.track_index / Math.max(nObjs, 1);
                  const mat = new THREE.LineBasicMaterial({
                    color: new THREE.Color().setHSL(hue, 0.7, 0.5),
                    transparent: true, opacity: movement.is_preview ? 0.2 : 0.35,
                  });
                  const line = new THREE.Line(geo, mat);
                  scene.add(line);
                  pathLinesRef.current.push(line);
                }
              } catch {
                // Un movement peut ne pas avoir de runtime — silencieux
              }
            }
            return;
          }
          // Pas de movement actif → rien à tracer (l'ancienne branche
          // "graph-main" legacy a été retirée : les workers graph-main/
          // graph-preview n'existent plus, la commande était morte).
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
  }, [isPlaying, hasMovements, movementIdsKey, animKey, graphCompileVersion, nObjects, macrosKey, movementsToShow, sceneRef, objectsRef]);

  // Cleanup à l'unmount — removeFromParent détache du parent réel (le ref
  // scene peut avoir été réassigné entre-temps).
  useEffect(() => {
    return () => {
      pathLinesRef.current.forEach((l) => {
        l.removeFromParent();
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
      pathLinesRef.current = [];
    };
  }, []);

  return null;
};
