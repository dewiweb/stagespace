/// Formatage show partagé — cueLabel/tcStr étaient dupliqués à l'identique
/// entre PerformView et useConduiteBroadcast (deux implémentations à faire
/// évoluer en parallèle).

export interface CueLike {
  cue_number?: string | null;
  name: string;
}

/// Label affiché d'une cue : "4 Tempête" (numéro OSC si présent, index+1 sinon).
export function cueLabel(c: CueLike | null, idx: number): string {
  return c ? `${c.cue_number ?? String(idx + 1)} ${c.name}` : '—';
}
/// Méta opérationnelle compacte d'une cue — mode/fade/timing visibles en
/// conduite SANS interaction (U3 : l'opérateur FOH doit savoir ce qu'il
/// tire). Ex: "TRK · 2s · w3 · f5 · TC".
export function cueMeta(c: {
  mode?: string | null;
  fade_duration?: number | null;
  pre_wait?: number | null;
  follow?: number | null;
  timecode?: number | null;
}): string {
  const parts: string[] = [];
  if (c.mode === 'Tracking') parts.push('TRK');
  // Fade toujours visible — c'est la donnée la plus critique au moment
  // du GO (combien de temps dure la transition).
  if (c.fade_duration != null) parts.push(`${c.fade_duration}s`);
  if (c.pre_wait != null && c.pre_wait > 0) parts.push(`w${c.pre_wait}`);
  if (c.follow != null && c.follow > 0) parts.push(`f${c.follow}`);
  if (c.timecode != null) parts.push('TC');
  return parts.join(' · ');
}

const pad2 = (v: number) => String(v).padStart(2, '0');

/// Timecode secondes → "HH:MM:SS:FF" (fps paramétrable, défaut 25).
export function tcStr(seconds: number, fps: number): string {
  const s = Math.max(0, seconds);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(Math.floor(s % 60))}:${pad2(Math.floor((s % 1) * fps))}`;
}

/// Types de nodes dessinables au crayon (spline libre ou flux dessiné) —
/// source unique pour ViewerToolPalette.hasDrawableNode et le finalize draw.
export const DRAWABLE_NODE_TYPES = ['DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline'] as const;
