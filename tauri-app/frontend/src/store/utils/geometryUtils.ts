import type { HolProject } from '../types/index';

/// Calcule l'isobarycentre des tracks ciblées
/// Si trackIndices est vide, utilise toutes les tracks
/// Si pas de .hol, retourne [0, 0, 0]
export function computeCentroid(
  holProject: HolProject | null,
  trackIndices: number[],
  _manualOscIds: number[],
): [number, number, number] {
  if (holProject && holProject.tracks.length > 0) {
    const indices = trackIndices.length > 0
      ? trackIndices
      : holProject.tracks.map((_, i) => i);
    const tracks = indices
      .filter((i) => i >= 0 && i < holProject.tracks.length)
      .map((i) => holProject.tracks[i]);
    if (tracks.length === 0) return [0, 0, 0];
    const sum = tracks.reduce(
      (acc, t) => [acc[0] + t.position[0], acc[1] + t.position[1], acc[2] + t.position[2]],
      [0, 0, 0],
    );
    return [sum[0] / tracks.length, sum[1] / tracks.length, sum[2] / tracks.length];
  }
  // Sans .hol : origin à 0, les tracks virtuelles partent de l'origine
  return [0, 0, 0];
}

// ── Douglas-Peucker simplification for drawn trajectories ───────────────────
export function perpendicularDistance(
  point: [number, number, number],
  lineStart: [number, number, number],
  lineEnd: [number, number, number],
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const dz = lineEnd[2] - lineStart[2];
  const lineLenSq = dx * dx + dy * dy + dz * dz;
  if (lineLenSq === 0) {
    return Math.sqrt(
      (point[0] - lineStart[0]) ** 2 +
      (point[1] - lineStart[1]) ** 2 +
      (point[2] - lineStart[2]) ** 2,
    );
  }
  const t = Math.max(0, Math.min(1, (
    (point[0] - lineStart[0]) * dx +
    (point[1] - lineStart[1]) * dy +
    (point[2] - lineStart[2]) * dz
  ) / lineLenSq));
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  const projZ = lineStart[2] + t * dz;
  return Math.sqrt(
    (point[0] - projX) ** 2 +
    (point[1] - projY) ** 2 +
    (point[2] - projZ) ** 2,
  );
}

export function douglasPeucker(
  points: Array<[number, number, number]>,
  tolerance: number,
): Array<[number, number, number]> {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

export function simplifyPoints(
  points: Array<[number, number, number]>,
  tolerance: number,
): Array<[number, number, number]> {
  return douglasPeucker(points, tolerance);
}
