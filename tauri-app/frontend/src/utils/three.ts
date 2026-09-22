import * as THREE from 'three';

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
