/// Conversion de coordonnées backend ↔ Three.js — point unique.
///
/// Le backend spatial audio utilise Z-up (x=right, y=depth, z=up).
/// Three.js utilise Y-up (x=right, y=up, z=depth).
/// Permutation : (x, y, z)_backend → (x, z, y)_three.
///
/// IMPORTANT : ne jamais réécrire cette permutation inline — un axe
/// inversé produit un bug silencieux (trajectoire couchée sur le côté).

/** backend (x, y=depth, z=up) → Three.js (x, y=up, z=depth) */
export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/** Three.js (x, y=up, z=depth) → backend (x, y=depth, z=up) */
export function fromThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}
