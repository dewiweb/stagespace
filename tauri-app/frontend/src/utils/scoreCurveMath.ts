/// Math des courbes du score — miroir de `sample_curve` (commands/score/) :
/// mêmes règles de clamp et d'interpolation pour que le ghost editor
/// et le backend évaluent la même chose.
import type { ScoreKeyframe } from '../store/useScoreStore';

/// Échantillonne une courbe à `t` — clamp avant/après les bornes,
/// `None`/undefined = courbe vide.
export function sampleKfs(kfs: ScoreKeyframe[] | undefined, t: number): number | undefined {
  if (!kfs || kfs.length === 0) return undefined;
  if (kfs.length === 1) return kfs[0].v;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  // partition_point : premier index avec k.t > t → segment [i-1, i).
  let lo = 0, hi = kfs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= t) lo = mid + 1; else hi = mid;
  }
  const i = lo;
  const a = kfs[i - 1], b = kfs[i];
  const f = (t - a.t) / (b.t - a.t);
  switch (a.interp ?? 'linear') {
    case 'step': return a.v;
    case 'smooth': {
      const s = f * f * (3 - 2 * f);
      return a.v + (b.v - a.v) * s;
    }
    default: return a.v + (b.v - a.v) * f;
  }
}

/// Points SVG d'une courbe échantillonnée — `x(t)`, `y(v)` fournis
/// par l'appelant (mapping de l'éditeur). `n` échantillons + les
/// keyframes exacts pour que step/smooth rendosnet juste.
export function curvePolyline(
  kfs: ScoreKeyframe[],
  endMs: number,
  n: number,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  if (kfs.length === 0) return '';
  const ts = new Set<number>();
  for (let i = 0; i <= n; i++) ts.add(Math.round((endMs * i) / n));
  for (const k of kfs) ts.add(k.t);
  const sorted = [...ts].sort((a, b) => a - b);
  return sorted
    .map((t) => `${x(t)},${y(sampleKfs(kfs, t) ?? 0)}`)
    .join(' ');
}
