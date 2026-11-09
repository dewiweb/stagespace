import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/// Retire `obj` de `parent` en détachant d'abord ses CSS2DObject descendants.
///
/// THREE.Object3D.remove() dispatche l'event 'removed' UNIQUEMENT sur l'objet
/// retiré — pas sur ses enfants. Or CSS2DObject écoute 'removed' pour détacher
/// son element du DOM : retirer un mesh sans détacher ses labels laisse des
/// divs orphelins dans le domElement du CSS2DRenderer — figés à la dernière
/// position, visibles pour toujours.
export function removeWithLabels(parent: THREE.Object3D, obj: THREE.Object3D) {
  const labels: THREE.Object3D[] = [];
  obj.traverse((o) => {
    if ((o as { isCSS2DObject?: boolean }).isCSS2DObject) labels.push(o);
  });
  labels.forEach((l) => l.removeFromParent());
  parent.remove(obj);
}

/// Dolly la caméra vers/depuis `controls.target` (clampé à min/maxDistance).
/// Zoom manuel utilisé quand OrbitControls.enabled=false — les overlays des
/// modes interactifs capturaient la molette : sans ça, impossible de zoomer
/// tant qu'un mode (draw/manipulate/assign/zone) était armé.
export function dollyCamera(controls: OrbitControls | null, factor: number) {
  if (!controls) return;
  const camera = controls.object;
  const dir = camera.position.clone().sub(controls.target);
  const len = dir.length();
  if (len < 1e-9) return;
  const newLen = THREE.MathUtils.clamp(len * factor, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).addScaledVector(dir.normalize(), newLen);
}
