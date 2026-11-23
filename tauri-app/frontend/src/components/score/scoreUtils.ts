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

export const CLIP_COLORS: Record<string, string> = {
  slot: 'bg-purple-600/80 border-purple-400',
  cue: 'bg-amber-600/80 border-amber-400',
  stopAll: 'bg-red-700/80 border-red-500',
  panic: 'bg-red-900/80 border-red-400',
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
  }
}
