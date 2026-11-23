import React, { useState } from 'react';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu';
import { effectiveTrackIds } from '../../utils/scoreResolve';
import { sharedClipCount } from '../../utils/scoreDetach';

/// Toolbar d'édition du score — les verbes qui agissent sur la
/// sélection (split/duplicate/delete/détacher/rendre unique/suivi).
/// Le même menu contextuel que le clic-droit pour « Détacher » : la
/// piste est choisie dans le dropdown (couverture effective du clip).
export const ScoreToolbar: React.FC<{
  selClip: ScoreClipDoc | null;
  cursorMs: number;
  onSplit: (id: string, ms: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDetachLane: (clipId: string, trackId: number, asNewMove: boolean) => void;
  onMakeUnique: (clipId: string) => void;
  onFlattenCue: (clipId: string) => void;
  onToggleFollow: (clipId: string) => void;
}> = ({ selClip, cursorMs, onSplit, onDuplicate, onDelete, onDetachLane, onMakeUnique, onFlattenCue, onToggleFollow }) => {
  const [detachMenu, setDetachMenu] = useState<{ x: number; y: number } | null>(null);
  const eff = selClip ? effectiveTrackIds(selClip) : [];
  const isSlot = selClip?.ref.type === 'slot';
  const isCue = selClip?.ref.type === 'cue';
  const canSplit =
    !!selClip && isSlot && cursorMs > selClip.startMs &&
    (selClip.durationMs == null || cursorMs < selClip.startMs + selClip.durationMs);
  const canDetach = isSlot && eff.length > 1;
  const n = selClip ? sharedClipCount(selClip.ref) : 0;

  const btn = 'px-1.5 py-0.5 rounded text-[10px] font-bold border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent';
  const detachItems: ContextMenuItem[] = eff.flatMap((tid) => [
    {
      label: `Détacher T${tid}`,
      title: 'Cette piste devient un clip indépendant — même move, placement libre',
      onClick: () => onDetachLane(selClip!.id, tid, false),
    },
    {
      label: `Détacher T${tid} → nouveau move`,
      title: 'La piste devient un clip suivant un move frais en banque (contenu divergent)',
      onClick: () => onDetachLane(selClip!.id, tid, true),
    },
  ]);

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 border-b border-gray-800 bg-gray-900/60">
      <span className="text-[9px] text-gray-600 uppercase mr-1">clip</span>
      <button
        className={btn}
        disabled={!canSplit}
        title={canSplit ? 'Couper le clip au curseur (S)' : 'Curseur hors du clip sélectionné (ou marker insécable)'}
        onClick={() => selClip && onSplit(selClip.id, cursorMs)}
      >✂ split</button>
      <button className={btn} disabled={!selClip} title="Copie indépendante, décalée de sa durée" onClick={() => selClip && onDuplicate(selClip.id)}>⧉ dup</button>
      <button className={btn} disabled={!selClip} title="Supprimer le clip (Del)" onClick={() => selClip && onDelete(selClip.id)}>⌫</button>
      <span className="w-px h-3 bg-gray-800 mx-0.5" />
      <button
        className={btn}
        disabled={!canDetach}
        title={canDetach ? 'Détacher une piste de la couverture' : 'Détachable sur un clip multi-objets'}
        onClick={(e) => setDetachMenu({ x: e.clientX, y: e.clientY })}
      >⇱ détacher ▾</button>
      <button
        className={btn}
        disabled={!isSlot && !isCue}
        title={isSlot
          ? `Clone le move en banque — ce clip suit la copie (lié ×${n})`
          : isCue
            ? 'Duplique la cue dans la cuelist — ce clip suit la copie'
            : 'Pas d\'entité à dupliquer sur un marker'}
        onClick={() => selClip && onMakeUnique(selClip.id)}
      >⬡ unique{(isSlot || isCue) && n > 1 ? ` ×${n}` : ''}</button>
      {selClip?.ref.type === 'cue' && (
        <button
          className={btn}
          title="Explose le snapshot en arrangement éditable (moves → clips suivis, macros → keyframes GLOBALFX) — la cue d'origine reste intacte"
          onClick={() => selClip && onFlattenCue(selClip.id)}
        >◆ flatten</button>
      )}
      {selClip && (selClip.ref.type === 'slot' || selClip.ref.type === 'cue') && (
        <button
          className={`${btn} ${selClip.trackIds === undefined ? 'text-cyan-300 border-cyan-800' : 'text-orange-300 border-orange-800'}`}
          title={selClip.trackIds === undefined
            ? 'Couverture SUIVIE — dérive de l\'entité vivante (cliquer = geler en override)'
            : 'Couverture GELÉE — override du clip (cliquer = repasser en suivi)'}
          onClick={() => onToggleFollow(selClip.id)}
        >{selClip.trackIds === undefined ? '⇄ suivi' : '⇄ gelé'}</button>
      )}
      {detachMenu && (
        <ContextMenu
          x={detachMenu.x}
          y={detachMenu.y}
          header="Détacher la piste"
          items={detachItems}
          onClose={() => setDetachMenu(null)}
        />
      )}
    </div>
  );
};

export default ScoreToolbar;
