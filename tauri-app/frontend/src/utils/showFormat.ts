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

const pad2 = (v: number) => String(v).padStart(2, '0');

/// Timecode secondes → "HH:MM:SS:FF" (fps paramétrable, défaut 25).
export function tcStr(seconds: number, fps: number): string {
  const s = Math.max(0, seconds);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(Math.floor(s % 60))}:${pad2(Math.floor((s % 1) * fps))}`;
}

/// Types de nodes dessinables au crayon (spline libre ou flux dessiné) —
/// source unique pour ModeButtons.hasDrawableNode et le finalize draw.
export const DRAWABLE_NODE_TYPES = ['DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline'] as const;
