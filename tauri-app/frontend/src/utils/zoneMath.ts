import type { Zone } from '../store/slices/spatialFxSlice';

/// Mirror exact de zones.rs — distance signée au bord de la zone.
/// Backend coords (x, y, z, z=up) — pas de conversion Three.js ici.
function signedDistance(zone: Zone, x: number, y: number, z: number): number {
  const shape = zone.shape;
  if (shape.shape === 'sphere') {
    const [cx, cy, cz] = shape.center;
    const d = Math.hypot(x - cx, y - cy, z - cz);
    return d - shape.radius;
  }
  const { min, max } = shape;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2;
  const hy = (max[1] - min[1]) / 2;
  const hz = (max[2] - min[2]) / 2;
  const qx = Math.abs(x - cx) - hx;
  const qy = Math.abs(y - cy) - hy;
  const qz = Math.abs(z - cz) - hz;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

function smoothstep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/// Influence d'une zone sur un point : 1 à l'intérieur, décroissance
/// smoothstep sur `falloff` unités au-delà du bord, 0 ensuite.
/// Mirror de Zone::influence côté Rust.
export function zoneInfluence(zone: Zone, x: number, y: number, z: number): number {
  const d = signedDistance(zone, x, y, z);
  if (zone.falloff <= 0) return d <= 0 ? 1 : 0;
  return 1 - smoothstep(d / zone.falloff);
}

/// Vrai si la zone s'applique à cet objet (enabled + filtre objects).
export function zoneAppliesTo(zone: Zone, objIdx: number): boolean {
  return zone.enabled && (zone.objects == null || zone.objects.includes(objIdx));
}

/// Plus forte influence parmi les zones applicables à cet objet/point.
export function strongestZoneInfluence(
  zones: Zone[],
  objIdx: number,
  x: number,
  y: number,
  z: number,
): number {
  let best = 0;
  for (const zone of zones) {
    if (!zoneAppliesTo(zone, objIdx)) continue;
    const infl = zoneInfluence(zone, x, y, z);
    if (infl > best) best = infl;
  }
  return best;
}
