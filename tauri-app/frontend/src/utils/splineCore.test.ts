import { describe, it, expect } from 'vitest';
import {
  evalSpline,
  sampleSpline,
  resampleByArcLength,
  fitStroke,
  insertCpAtU,
  deleteCp,
  moveCp,
  nearestU,
  primCircle,
  primLemniscate,
  primLine,
  strokeLooksClosed,
  polylineLength,
  dist3,
  type Vec3,
} from './splineCore';

const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];

describe('evalSpline — miroir du backend Rust', () => {
  it('passe par les CPs (u=0 et u=1 aux extrémités, open)', () => {
    const p0 = evalSpline(line, 0, false);
    const p1 = evalSpline(line, 1, false);
    expect(dist3(p0, line[0])).toBeLessThan(1e-9);
    expect(dist3(p1, line[2])).toBeLessThan(1e-9);
  });

  it('interpole les CPs intermédiaires', () => {
    const mid = evalSpline(line, 0.5, false);
    expect(dist3(mid, line[1])).toBeLessThan(1e-9);
  });

  it('closed : u=0 et u→1 sont continus (wrap)', () => {
    const cps = primCircle(8, 1, 0);
    const a = evalSpline(cps, 0, true);
    const b = evalSpline(cps, 0.9999, true);
    expect(dist3(a, b)).toBeLessThan(0.05);
  });

  it('closed : la courbe repasse près des CPs', () => {
    const cps = primCircle(8, 1, 0);
    for (let i = 0; i < cps.length; i++) {
      const p = evalSpline(cps, i / cps.length, true);
      expect(dist3(p, cps[i])).toBeLessThan(1e-9);
    }
  });

  it('cas dégénérés : vide et singleton', () => {
    expect(evalSpline([], 0.5, false)).toEqual([0, 0, 0]);
    expect(evalSpline([[1, 2, 3]], 0.5, false)).toEqual([1, 2, 3]);
  });
});

describe('sampleSpline / longueurs', () => {
  it('produit steps+1 échantillons', () => {
    expect(sampleSpline(line, false, 0.5, 64)).toHaveLength(65);
  });

  it('polylineLength d\'un cercle ≈ circonférence échantillonnée', () => {
    const cps = primCircle(12, 1, 0);
    const samples = sampleSpline(cps, true, 0.5, 400);
    const len = polylineLength(samples, true);
    expect(len).toBeGreaterThan(5.5); // 2π ≈ 6.28 — CR sous-échantillonne un peu
    expect(len).toBeLessThan(7.0);
  });
});

describe('fitStroke', () => {
  const rough: Vec3[] = [];
  for (let i = 0; i < 200; i++) {
    const t = (i / 200) * Math.PI * 2;
    // Cercle bruité (±3cm)
    rough.push([
      Math.cos(t) + (Math.random() - 0.5) * 0.06,
      Math.sin(t) + (Math.random() - 0.5) * 0.06,
      0,
    ]);
  }

  it('réduit un stroke bruité à un budget de CPs', () => {
    const cps = fitStroke(rough, { maxCps: 16, closed: true });
    expect(cps.length).toBeLessThanOrEqual(16);
    expect(cps.length).toBeGreaterThanOrEqual(4);
  });

  it('les CPs fittés restent proches du cercle idéal', () => {
    const cps = fitStroke(rough, { maxCps: 16, closed: true, smoothing: 0.8 });
    cps.forEach((p) => {
      expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(0.08);
    });
  });

  it('préserve les petits strokes', () => {
    expect(fitStroke([[0, 0, 0]], {})).toEqual([[0, 0, 0]]);
  });
});

describe('resampleByArcLength', () => {
  it('échantillons uniformes en distance sur une ligne', () => {
    const pts = resampleByArcLength(line, 5);
    expect(pts).toHaveLength(5);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(dist3(pts[i], pts[i - 1]) - 0.5)).toBeLessThan(1e-9);
    }
  });
});

describe('ops d\'édition', () => {
  const square: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];

  it('insertCpAtU ajoute un CP sur la courbe', () => {
    const out = insertCpAtU(square, 0.5, false);
    expect(out).toHaveLength(5);
    // Le point inséré est sur la courbe évaluée
    const onCurve = evalSpline(square, 0.5, false);
    expect(dist3(out[2], onCurve)).toBeLessThan(0.4); // proche (CR approchée)
  });

  it('deleteCp retire le bon CP', () => {
    const out = deleteCp(square, 1);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([1, 1, 0]);
  });

  it('moveCp remplace la position', () => {
    const out = moveCp(square, 0, [5, 5, 5]);
    expect(out[0]).toEqual([5, 5, 5]);
    expect(out[1]).toEqual([1, 0, 0]);
  });

  it('nearestU trouve le paramètre du point le plus proche', () => {
    const u = nearestU(square, [0.5, 1.05, 0], true);
    const p = evalSpline(square, u, true);
    expect(p[1]).toBeGreaterThan(0.9); // proche du haut du carré
  });
});

describe('primitives', () => {
  it('primCircle produit n CPs à rayon r', () => {
    const cps = primCircle(8, 2, 1.5);
    expect(cps).toHaveLength(8);
    cps.forEach((p) => {
      expect(Math.abs(Math.hypot(p[0], p[1]) - 2)).toBeLessThan(1e-9);
      expect(p[2]).toBe(1.5);
    });
  });

  it('primLemniscate croise l\'origine', () => {
    const cps = primLemniscate(16, 1.5, 0);
    // t=0 → (0,0) ; t=π → (0, ~0)
    expect(dist3(cps[0], [0, 0, 0])).toBeLessThan(1e-9);
    expect(dist3(cps[8], [0, 0, 0])).toBeLessThan(1e-9);
  });

  it('primLine est alignée', () => {
    const cps = primLine(-1, 0, 1, 0, 0);
    cps.forEach((p) => expect(p[1]).toBe(0));
  });
});

describe('strokeLooksClosed', () => {
  it('détecte un stroke refermé', () => {
    const stroke: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.05, 0.02, 0]];
    expect(strokeLooksClosed(stroke)).toBe(true);
  });

  it('rejette un stroke ouvert', () => {
    const stroke: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]];
    expect(strokeLooksClosed(stroke)).toBe(false);
  });
});
