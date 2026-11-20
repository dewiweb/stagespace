/// Coeur spline — moteur de dessin/édition dédié.
///
/// MIRROIR EXACT de `rust-engines/src/engines/spline.rs` : même base
/// Catmull-Rom (coefficients identiques), même wrap/clamp des indices,
/// même paramétrage — la preview rendue ici est la courbe que le backend
/// émettra, au rounding près. Ne pas diverger sans porter le changement
/// côté Rust (et inversement).
///
/// Pur / sans dépendance Three.js — testable unitairement.

export type Vec3 = [number, number, number];

// ── Évaluation Catmull-Rom (miroir Rust) ────────────────────────────────────

function catmullRomSeg(
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number, a: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const c0 = -a * t3 + 2 * a * t2 - a * t;
  const c1 = (2 - a) * t3 + (a - 3) * t2 + 1;
  const c2 = (a - 2) * t3 + (3 - 2 * a) * t2 + a * t;
  const c3 = a * t3 - a * t2;
  return [
    c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
    c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
    c0 * p0[2] + c1 * p1[2] + c2 * p2[2] + c3 * p3[2],
  ];
}

function getPoint(cps: Vec3[], i: number, closed: boolean): Vec3 {
  const n = cps.length;
  const idx = closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1);
  return cps[idx];
}

/** Position sur la spline — u ∈ [0,1]. Miroir de `evaluate_raw`. */
export function evalSpline(cps: Vec3[], u: number, closed: boolean, tension = 0.5): Vec3 {
  const n = cps.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return cps[0];

  const numSeg = closed ? n : n - 1;
  const segF = u * numSeg;
  let seg = Math.floor(segF);
  let localT = segF - seg;
  if (seg >= numSeg) {
    seg = numSeg - 1;
    localT = 1;
  }
  return catmullRomSeg(
    getPoint(cps, seg - 1, closed),
    getPoint(cps, seg, closed),
    getPoint(cps, seg + 1, closed),
    getPoint(cps, seg + 2, closed),
    localT,
    tension,
  );
}

/** Échantillonnage uniforme en u — polyline de preview. */
export function sampleSpline(
  cps: Vec3[], closed: boolean, tension = 0.5, steps = 160,
): Vec3[] {
  if (cps.length < 2) return [...cps];
  const out: Vec3[] = [];
  for (let i = 0; i <= steps; i++) out.push(evalSpline(cps, i / steps, closed, tension));
  return out;
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Longueur d'une polyligne (open : n-1 segments, closed : n). */
export function polylineLength(pts: Vec3[], closed = false): number {
  let len = 0;
  const segCount = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segCount; i++) len += dist3(pts[i], pts[(i + 1) % pts.length]);
  return len;
}

// ── Fit : stroke brut → CPs propres ─────────────────────────────────────────

/** Lissage 3-tap (moyenne glissante) — retire le bruit du geste freehand. */
export function smoothPolyline(pts: Vec3[], passes: number, closed = false): Vec3[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    if (n < 3) break;
    const next: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = closed ? cur[(i - 1 + n) % n] : cur[Math.max(0, i - 1)];
      const nextP = closed ? cur[(i + 1) % n] : cur[Math.min(n - 1, i + 1)];
      next.push([
        (prev[0] + 2 * cur[i][0] + nextP[0]) / 4,
        (prev[1] + 2 * cur[i][1] + nextP[1]) / 4,
        (prev[2] + 2 * cur[i][2] + nextP[2]) / 4,
      ]);
    }
    cur = next;
  }
  return cur;
}

/**
 * Resample uniforme par arc-length — l'espacement régulier des CPs est le
 * facteur dominant de stabilité de forme pour Catmull-Rom.
 */
export function resampleByArcLength(pts: Vec3[], target: number, closed = false): Vec3[] {
  const n = pts.length;
  if (n < 2 || target < 2) return [...pts];
  const segCount = closed ? n : n - 1;
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const l = dist3(pts[i], pts[(i + 1) % n]);
    lens.push(l);
    total += l;
  }
  if (total <= 1e-9) return [pts[0]];

  const out: Vec3[] = [];
  let segIdx = 0;
  let acc = 0;
  for (let k = 0; k < target; k++) {
    // closed : on prend target échantillons sans répéter le dernier (wrap)
    const goal = closed ? (k / target) * total : (k / (target - 1)) * total;
    while (segIdx < segCount - 1 && acc + lens[segIdx] < goal) {
      acc += lens[segIdx];
      segIdx++;
    }
    const l = lens[segIdx];
    const t = l > 1e-9 ? (goal - acc) / l : 0;
    const a = pts[segIdx];
    const b = pts[(segIdx + 1) % n];
    out.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  return out;
}

export interface FitOptions {
  /** 0..1 — intensité du lissage pré-fit (défaut 0.5). */
  smoothing?: number;
  /** Budget de points de contrôle (défaut 16, min 4, max 64). */
  maxCps?: number;
  closed?: boolean;
}

/**
 * Fit d'un stroke freehand → jeu de CPs propre :
 * 1. lissage 3-tap proportionnel à `smoothing`
 * 2. resample uniforme arc-length au budget CP
 */
export function fitStroke(raw: Vec3[], opts: FitOptions = {}): Vec3[] {
  const { smoothing = 0.5, maxCps = 16, closed = false } = opts;
  if (raw.length < 2) return [...raw];
  const passes = 1 + Math.round(smoothing * 3);
  const smoothed = smoothPolyline(raw, passes, closed);
  const target = Math.min(Math.max(4, maxCps), 64, Math.max(2, smoothed.length));
  return resampleByArcLength(smoothed, target, closed);
}

// ── Ops d'édition sur CPs ───────────────────────────────────────────────────

/** u du segment le plus proche de `p` (échantillonné — assez fin pour l'UX). */
export function nearestU(cps: Vec3[], p: Vec3, closed: boolean, tension = 0.5): number {
  const samples = sampleSpline(cps, closed, tension, 240);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = dist3(samples[i], p);
    if (d < bestD) {
      bestD = d;
      best = i / (samples.length - 1);
    }
  }
  return best;
}

/**
 * Insère un CP sur la courbe au paramètre u — le nouveau CP est placé SUR
 * la courbe évaluée : la forme ne bouge quasi pas (insertion standard).
 */
export function insertCpAtU(cps: Vec3[], u: number, closed: boolean, tension = 0.5): Vec3[] {
  const n = cps.length;
  if (n < 2) return [...cps];
  const numSeg = closed ? n : n - 1;
  const segF = Math.min(Math.max(u, 0), 1) * numSeg;
  const seg = Math.min(Math.floor(segF), numSeg - 1);
  const pos = evalSpline(cps, u, closed, tension);
  const out = [...cps];
  out.splice(seg + 1, 0, pos);
  return out;
}

export function deleteCp(cps: Vec3[], index: number): Vec3[] {
  if (index < 0 || index >= cps.length) return [...cps];
  return cps.filter((_, i) => i !== index);
}

export function moveCp(cps: Vec3[], index: number, to: Vec3): Vec3[] {
  if (index < 0 || index >= cps.length) return cps;
  const out = [...cps];
  out[index] = to;
  return out;
}

// ── Primitives (jeux de CPs initiaux, plan x/y, altitude z) ─────────────────

export function primCircle(n: number, r: number, z: number, cx = 0, cy = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t), z]);
  }
  return out;
}

export function primEllipse(n: number, rx: number, ry: number, z: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([rx * Math.cos(t), ry * Math.sin(t), z]);
  }
  return out;
}

/** Lemniscate de Bernoulli — le "8" classique du spatial. */
export function primLemniscate(n: number, a: number, z: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([a * Math.sin(t), a * Math.sin(t) * Math.cos(t), z]);
  }
  return out;
}

/** Segment droit — 3 CPs alignés (CR d'une ligne = la ligne). */
export function primLine(x0: number, y0: number, x1: number, y1: number, z: number): Vec3[] {
  return [
    [x0, y0, z],
    [(x0 + x1) / 2, (y0 + y1) / 2, z],
    [x1, y1, z],
  ];
}

/** Arc — `sweep` en radians (≤ ~π pour rester sain avec peu de CPs). */
export function primArc(n: number, r: number, sweep: number, z: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * sweep - sweep / 2;
    out.push([r * Math.cos(t), r * Math.sin(t), z]);
  }
  return out;
}

/** Le stroke se referme-t-il sur lui-même ? (début ≈ fin → suggère closed). */
export function strokeLooksClosed(raw: Vec3[], thresh = 0.25): boolean {
  if (raw.length < 4) return false;
  return dist3(raw[0], raw[raw.length - 1]) < thresh;
}

// ── Vues fixées (top/front/side) — plan de dessin par vue ───────────────────

/**
 * Vue gizmo fixée du draw mode. Chaque vue définit son plan de dessin :
 * - `top`   : plan (x, y) à z=offset — la vue plan (défaut historique)
 * - `front` : plan (x, z) à y=offset — élévation vue depuis l'upstage
 * - `side`  : plan (y, z) à x=offset — élévation latérale
 * `free` = caméra libre, plan top (comportement legacy).
 */
export type DrawView = 'free' | 'top' | 'front' | 'side';

/** Embarque un point 2D (u,v) dans le plan de la vue — coords backend. */
export function mapToViewPlane(u: number, v: number, view: DrawView, offset: number): Vec3 {
  switch (view) {
    case 'front':
      return [u, offset, v]; // x=u, y=offset(depth), z=v(up)
    case 'side':
      return [offset, u, v]; // x=offset(lateral), y=u(depth), z=v(up)
    case 'top':
    case 'free':
    default:
      return [u, v, offset]; // x=u, y=v(depth), z=offset(up)
  }
}

/** Remappe un jeu de CPs orienté "top" (x,y plan, z=up) vers le plan d'une vue. */
export function remapCps(cps: Vec3[], view: DrawView, offset: number): Vec3[] {
  return cps.map(([x, y]) => mapToViewPlane(x, y, view, offset));
}
