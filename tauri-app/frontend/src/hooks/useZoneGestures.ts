import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useGraphStore } from '../store/useGraphStore';
import { fromThree, toThree } from '../utils/coords';
import { zoneToParams, zoneToParamsResized } from '../store/slices/spatialFxSlice';

interface UseZoneGesturesParams {
  /// De useScenePicking — raycaster NDC générique + index zone au point.
  raycastAt: (e: { clientX: number; clientY: number }) => THREE.Raycaster | null;
  zoneIndexAt: (r: THREE.Raycaster) => number | null;
}

/**
 * Gestes des modes zone — place (clic sol → pendingZonePoint) et edit
 * (drag centre sur le plan à la hauteur de la zone, wheel = resize).
 * updateZone throttlé ~30Hz — un invoke par pointermove saturerait l'IPC
 * (même discipline que le drag d'objets dans useManipulateMode).
 */
export function useZoneGestures({ raycastAt, zoneIndexAt }: UseZoneGesturesParams) {
  const draggingZoneRef = useRef<number | null>(null);
  const lastZoneUpdateRef = useRef(0);

  // Zone place — clic sur le sol (plan y=0 côté Three = z=0 backend)
  // → enregistre le centre en coords backend pour le formulaire SpatialFX.
  const handleZonePlaceDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas place
      const r = raycastAt(e);
      if (!r) return;
      const pt = new THREE.Vector3();
      if (!r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) return;
      const s = useGraphStore.getState();
      const [bx, by, bz] = fromThree(pt.x, pt.y, pt.z);
      s.setPendingZonePoint([bx, by, bz]);
      s.setZonePlaceMode(false);
    },
    [raycastAt],
  );

  const handleZoneEditDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas edit
      const r = raycastAt(e);
      if (!r) return;
      const idx = zoneIndexAt(r);
      if (idx !== null) {
        draggingZoneRef.current = idx;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [raycastAt, zoneIndexAt],
  );

  // Drag d'un mesh de zone : le centre suit le curseur sur le plan
  // horizontal à la hauteur de la zone (backend z = three y).
  const handleZoneEditMove = useCallback(
    (e: React.PointerEvent) => {
      const zi = draggingZoneRef.current;
      if (zi === null) return;
      const r = raycastAt(e);
      if (!r) return;
      const s = useGraphStore.getState();
      const zone = s.zones[zi];
      if (!zone) return;
      const centerB = zone.shape.shape === 'sphere'
        ? zone.shape.center
        : zone.shape.shape === 'box'
          ? [(zone.shape.min[0] + zone.shape.max[0]) / 2, (zone.shape.min[1] + zone.shape.max[1]) / 2, (zone.shape.min[2] + zone.shape.max[2]) / 2] as [number, number, number]
          : [0, 0, 0] as [number, number, number];
      const [, cy] = toThree(centerB[0], centerB[1], centerB[2]);
      const pt = new THREE.Vector3();
      if (!r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -cy), pt)) return;
      const now = performance.now();
      if (now - lastZoneUpdateRef.current < 33) return;
      lastZoneUpdateRef.current = now;
      const [bx, by, bz] = fromThree(pt.x, pt.y, pt.z);
      s.updateZone(zi, zoneToParams(zone, [bx, by, bz]))
        .catch((err) => console.error('zone drag update failed:', err));
    },
    [raycastAt],
  );

  const handleZoneEditUp = useCallback(() => { draggingZoneRef.current = null; }, []);

  const handleZoneEditWheel = useCallback(
    (e: React.WheelEvent) => {
      const r = raycastAt(e);
      if (!r) return;
      const zi = zoneIndexAt(r);
      if (zi === null) return;
      const s = useGraphStore.getState();
      const zone = s.zones[zi];
      if (!zone) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      const params = zone.shape.shape === 'sphere'
        ? zoneToParamsResized(zone, { radius: zone.shape.radius + dir * 0.25 })
        : zoneToParamsResized(zone, { scale: 1 + dir * 0.05 });
      s.updateZone(zi, params).catch((err) => console.error('zone resize failed:', err));
    },
    [raycastAt, zoneIndexAt],
  );

  return {
    handleZonePlaceDown,
    handleZoneEditDown,
    handleZoneEditMove,
    handleZoneEditUp,
    handleZoneEditWheel,
  };
}
