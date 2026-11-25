/// Helpers purs de la surface score — formatage, couleurs, labels.

/// La cible d'un keydown est-elle un champ de SAISIE de texte ?
/// Utilisé pour ne pas détourner Delete/Backspace (ni les raccourcis)
/// pendant que l'opérateur tape. Les INPUT non-textuels (range,
/// checkbox, boutons…) n'entrent pas dans cette catégorie — un slider
/// qui garde le focus ne doit pas bloquer la suppression d'un clip.
const NON_TEXT_INPUT_TYPES = new Set([
  'range', 'checkbox', 'radio', 'button', 'color', 'submit', 'reset',
]);
export function isTextEntryTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.isContentEditable) return true;
  if (t.tagName === 'INPUT')
    return !NON_TEXT_INPUT_TYPES.has((t as HTMLInputElement).type);
  return false;
}
import type { ScoreClipDoc } from '../../store/useScoreStore';
import type { MoveSlot } from '../../store/slices/moveSlotsTypes';
import type { Cue } from '../../types/generated/Cue';

export const fmtMs = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/// Snap magnétique — `snap ≤ 0` = libre (arrondi à la ms près).
export const snapTo = (ms: number, snap: number) =>
  snap > 0 ? Math.round(ms / snap) * snap : Math.round(ms);

/// Affichage timecode HH:MM:SS:FF (le chase parle TC — défaut 25fps,
/// même référence que `/stagespace/timecode`).
export const fmtTc = (ms: number, fps = 25) => {
  const totalF = Math.floor((ms / 1000) * fps);
  const s = Math.floor(totalF / fps);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(totalF % fps)}`;
};

/// Graduation adaptative de la règle — la majeure (labellisée) vise
/// ~80–160 px selon le zoom ; la mineure la subdivise (×4 ou ×5).
/// Retourne `{ minorMs, majorMs }`.
export function rulerTicks(pxPerSec: number): { minorMs: number; majorMs: number } {
  // (major s, subdivisions) — divisions 4/5/6 gardent des mineurs ronds.
  const MAJORS: [number, number][] = [
    [100, 4], [250, 5], [500, 5], [1000, 4], [2000, 4], [5000, 5],
    [10000, 5], [15000, 5], [30000, 6], [60000, 4],
  ];
  const pick = MAJORS.find(([s]) => (s / 1000) * pxPerSec >= 80) ?? [60000, 4];
  return { minorMs: pick[0] / pick[1], majorMs: pick[0] };
}

/// Couleurs des types de clips — mapping par FAMILLES FONCTIONNELLES
/// (design : docs/color-harmonization.md). Famille = teinte, intensité
/// = sous-type. Les 24 types ne peuvent pas avoir 24 hues lisibles :
///   conduite  (amber)   — transitions de show : cue/cueArm/cueGo
///   danger    (red)     — stopAll/panic
///   placement (teal)    — placer dans l'espace : pose/positions/throw/gesture
///   objectCtl (emerald) — contrôle doux des objets : park/solo/attention…
///   graphs    (indigo→fuchsia) — pipelines de traitement
///   system    (cyan)    — utilitaires : osc/soundcheck/view
///   slot      (purple)  — le contenu (moves)
/// Les projections de lanes (blast/spans) reprennent la teinte de la
/// famille du clip parent — cf. ScoreTimeline.
export const CLIP_COLORS: Record<string, string> = {
  slot: 'bg-purple-600/80 border-purple-400',
  cue: 'bg-amber-600/80 border-amber-400',
  cueArm: 'bg-amber-800/80 border-amber-500',
  cueGo: 'bg-amber-700/80 border-amber-400',
  stopAll: 'bg-red-700/80 border-red-500',
  panic: 'bg-red-900/80 border-red-400',
  pose: 'bg-teal-600/80 border-teal-300',
  positions: 'bg-teal-700/80 border-teal-400',
  throw: 'bg-teal-800/80 border-teal-500',
  gesture: 'bg-teal-500/80 border-teal-300',
  park: 'bg-emerald-800/80 border-emerald-500',
  unpark: 'bg-emerald-600/80 border-emerald-400',
  solo: 'bg-emerald-500/80 border-emerald-300',
  unsolo: 'bg-emerald-500/80 border-emerald-300',
  attention: 'bg-emerald-700/80 border-emerald-400',
  manualClear: 'bg-emerald-900/80 border-emerald-500',
  modGraph: 'bg-indigo-700/80 border-indigo-400',
  postGraph: 'bg-indigo-600/80 border-indigo-300',
  chanMods: 'bg-indigo-500/80 border-indigo-300',
  zones: 'bg-fuchsia-700/80 border-fuchsia-400',
  osc: 'bg-cyan-700/80 border-cyan-400',
  soundcheck: 'bg-cyan-500/80 border-cyan-300',
  view: 'bg-cyan-900/80 border-cyan-500',
};

/// Label affiché d'un clip — nom du slot/cue ou marqueur.
/// `⚠` = référence cassée (orphelin).
export function clipLabel(
  clip: ScoreClipDoc,
  moveSlots: MoveSlot[],
  cues: Cue[],
): string {
  switch (clip.ref.type) {
    case 'slot': {
      const sl = moveSlots.find((x) => x.id === (clip.ref as { slotId: string }).slotId);
      return sl ? sl.name : '⚠ slot perdu';
    }
    case 'cue': {
      const cue = cues.find((x) => String(x.id) === String((clip.ref as { cueId: string }).cueId));
      return cue ? `CUE ${cue.cue_number != null ? `${cue.cue_number} ` : ''}${cue.name}` : '⚠ cue perdue';
    }
    case 'stopAll': return 'STOP ALL';
    case 'panic': return 'PANIC';
    case 'positions': {
      const n = Object.keys(clip.ref.positions).length;
      return `POS ×${n}`;
    }
    case 'modGraph': return 'MOD graph';
    case 'postGraph': return 'POST graph';
    case 'chanMods': return `MODS ×${clip.ref.modulations.length}`;
    case 'zones': return `ZONES ×${clip.ref.zones.length}`;
    case 'gesture': return `◈ ${clip.ref.name.toUpperCase()}`;
    case 'throw': return 'THROW';
    case 'park': return 'PARK';
    case 'unpark': return 'UNPARK';
    case 'manualClear': return 'MANUEL OFF';
    case 'attention': return 'ATTENTION';
    case 'osc': return `→OSC ${clip.ref.addr}`;
    case 'soundcheck': return `♪ SOUNDCHECK ${clip.ref.action.toUpperCase()}`;
    case 'solo': return `◈ SOLO ${clip.ref.n}`;
    case 'unsolo': return '◈ UNSOLO';
    case 'view': return `▣ VIEW ${clip.ref.surface.toUpperCase()}`;
    case 'cueArm': {
      const cue = cues.find((x) => String(x.id) === String((clip.ref as { cueId: string }).cueId));
      return cue ? `⇥ ARM ${cue.cue_number != null ? `${cue.cue_number} ` : ''}${cue.name}` : '⇥ ARM ⚠ cue morte';
    }
    case 'cueGo': return '▶ CUE GO';
    case 'pose': {
      const r = clip.ref;
      if (r.mode === 'snap') return `◆ SNAP ${r.name}`;
      if (r.mode === 'morph') return `◆ MORPH ${r.fromPose ?? '?'}→${r.name}`;
      return `◆ GOTO ${r.name}`;
    }
  }
}
