import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGraphStore } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import type { Zone } from '../store/slices/spatialFxSlice';
import { toThree } from '../utils/coords';


const MANUAL_COLOR = 0x22d3ee; // cyan — zones manuelles (FX panel / CLI / OSC IN)
const GRAPH_COLOR = 0x8b5cf6; // violet — zones déclarées dans le graph global (nodes Zone)

interface ZoneVisualizationProps {
  sceneRef: React.RefObject<THREE.Scene | null>;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else (m as THREE.Material).dispose();
    }
  });
}

/// Construit les meshes d'une zone : volume translucide + wireframe,
/// plus une enveloppe externe étendue de `falloff` (zone de transition).
function buildZoneMeshes(zone: Zone, color: number): THREE.Object3D[] {
  const enabled = zone.enabled;
  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: enabled ? 0.07 : 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: enabled ? 0.3 : 0.08,
    depthWrite: false,
  });
  const shellMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: enabled ? 0.12 : 0.04,
    depthWrite: false,
  });

  const meshes: THREE.Object3D[] = [];

  if (zone.shape.shape === 'sphere') {
    const { center, radius } = zone.shape;
    const [x, y, z] = toThree(center[0], center[1], center[2]);
    const geo = new THREE.SphereGeometry(Math.max(radius, 0.01), 24, 16);
    const solid = new THREE.Mesh(geo, fillMat);
    const wire = new THREE.Mesh(geo.clone(), wireMat);
    solid.position.set(x, y, z);
    wire.position.set(x, y, z);
    meshes.push(solid, wire);
    if (zone.falloff > 0) {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(radius + zone.falloff, 24, 16),
        shellMat,
      );
      shell.position.set(x, y, z);
      meshes.push(shell);
    }
  } else {
    const { min, max } = zone.shape;
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const [x, y, z] = toThree(c[0], c[1], c[2]);
    // backend (dx, dy, dz) → three (dx, dz, dy) — permutation d'axes comme toThree
    const sx = Math.max(max[0] - min[0], 0.01);
    const sy = Math.max(max[2] - min[2], 0.01);
    const sz = Math.max(max[1] - min[1], 0.01);
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const solid = new THREE.Mesh(geo, fillMat);
    const wire = new THREE.Mesh(geo.clone(), wireMat);
    solid.position.set(x, y, z);
    wire.position.set(x, y, z);
    meshes.push(solid, wire);
    if (zone.falloff > 0) {
      const f = zone.falloff * 2;
      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(sx + f, sy + f, sz + f),
        shellMat,
      );
      shell.position.set(x, y, z);
      meshes.push(shell);
    }
  }
  return meshes;
}

/**
 * Visualisation 3D des zones d'effets spatiaux — volumes translucides
 * (sphere/box) + enveloppe de falloff, pour voir où l'effet agit.
 * Cyan = zones manuelles, violet = zones déclarées dans le graph global.
 */
export const ZoneVisualization: React.FC<ZoneVisualizationProps> = ({ sceneRef }) => {
  const zones = useGraphStore((s) => s.zones);
  const graphZones = useGraphStore((s) => s.graphZones);
  const refreshSpatialFx = useGraphStore((s) => s.refreshSpatialFx);
  const globalNodes = useGlobalGraphStore((s) => s.nodes);
  const groupRef = useRef<THREE.Group | null>(null);

  // Rafraîchit les effets quand le graph global change (params des nodes
  // Zone édités → pushGlobalGraph → nouveaux graph_zones côté backend)
  const globalKey = JSON.stringify(
    globalNodes.map((n) => [(n.data as any)?.type, (n.data as any)?.params]),
  );
  useEffect(() => {
    refreshSpatialFx().catch((e) => console.error(e));
  }, [globalKey, refreshSpatialFx]);

  // (Re)construit les meshes quand la liste des zones change
  const zonesKey = JSON.stringify([zones, graphZones]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (groupRef.current) {
      scene.remove(groupRef.current);
      disposeObject(groupRef.current);
    }
    const group = new THREE.Group();
    group.name = 'spatial-zones';
    zones.forEach((z) => buildZoneMeshes(z, MANUAL_COLOR).forEach((m) => group.add(m)));
    graphZones.forEach((z) => buildZoneMeshes(z, GRAPH_COLOR).forEach((m) => group.add(m)));
    scene.add(group);
    groupRef.current = group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesKey, sceneRef]);

  // Cleanup à l'unmount — removeFromParent détache du parent réel (le ref
  // scene peut avoir été réassigné entre-temps).
  useEffect(() => {
    return () => {
      if (groupRef.current) {
        groupRef.current.removeFromParent();
        disposeObject(groupRef.current);
        groupRef.current = null;
      }
    };
  }, []);

  return null;
};
