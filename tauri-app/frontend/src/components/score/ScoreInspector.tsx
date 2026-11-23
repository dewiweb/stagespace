/// Bandeau info bas du score — inspector du clip sélectionné :
/// couverture (objets pilotés, réassignation), début/durée/fades/
/// repeat en saisie numérique, duplication, vidage du score.
import React from 'react';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import { useScoreStore } from '../../store/useScoreStore';
import { toast } from '../../utils/toast-helpers';

export const ScoreInspector: React.FC<{
  clipsCount: number;
  selected: ScoreClipDoc | null;
  clipLabel: (c: ScoreClipDoc) => string;
  /// Objets patchés + déjà couverts (pour le select d'assignation).
  manualOscIds: number[];
  covered: Set<number>;
  durationMs: number;
  onMoveClip: (id: string, startMs: number) => void;
  onResizeClip: (id: string, durationMs: number | undefined) => void;
  onSetClipFades: (id: string, inMs: number | undefined, outMs: number | undefined) => void;
  onSetClipRepeat: (id: string, everyMs: number | undefined) => void;
  onSetClipTrackIds: (id: string, trackIds: number[]) => void;
  onDuplicateClip: (id: string) => void;
}> = ({
  clipsCount, selected, clipLabel, manualOscIds, covered, durationMs,
  onMoveClip, onResizeClip, onSetClipFades, onSetClipRepeat, onSetClipTrackIds, onDuplicateClip,
}) => {
  const c = selected;
  /// Champ numérique secondes → ms (vide = undefined).
  const numIn = (label: string, val: number | undefined, onSet: (v: number | undefined) => void, title?: string) => (
    <label className="flex items-center gap-1" title={title}>
      {label}
      <input
        key={`${c?.id}-${label}`}
        type="number" min={0} step={0.5} defaultValue={val != null ? val / 1000 : ''}
        placeholder="—"
        onBlur={(e) => {
          const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) * 1000);
          onSet(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
      />
      s
    </label>
  );
  return (
    <div className="px-3 py-1 border-t border-gray-800 text-[10px] text-gray-500 flex items-center gap-4">
      <span>{clipsCount} clip{clipsCount > 1 ? 's' : ''} — exécution backend (survit au reload)</span>
      {c && (
        <span className="flex items-center gap-3 text-gray-400 border-l border-gray-800 pl-4">
          <span className="font-bold text-gray-300">{clipLabel(c)}</span>
          {/* Couverture — les objets pilotés par ce clip. × retire
              l'objet (réassignation) ; slot → + ajoute un objet. */}
          {(c.ref.type === 'slot' || c.ref.type === 'cue') && (
            <span className="flex items-center gap-1" title="Objets pilotés (copies liées sur les lanes)">
              obj:
              {c.trackIds.map((tid) => (
                <span key={tid} className="px-1 rounded bg-gray-800 border border-gray-700 flex items-center">
                  {tid}
                  <button
                    className="ml-0.5 text-gray-500 hover:text-red-400"
                    title={`Retirer l'objet ${tid} de la couverture`}
                    onClick={() => onSetClipTrackIds(c.id, c.trackIds.filter((x) => x !== tid))}
                  >×</button>
                </span>
              ))}
              {c.ref.type === 'slot' && (
                <select
                  className="bg-gray-800 border border-gray-700 rounded text-[10px]"
                  value=""
                  onChange={(e) => {
                    const tid = Number(e.target.value);
                    if (tid) onSetClipTrackIds(c.id, [...c.trackIds, tid]);
                  }}
                  title="Assigner un objet supplémentaire à ce clip"
                >
                  <option value="">+</option>
                  {[...new Set([...manualOscIds, ...covered])]
                    .filter((tid) => !c.trackIds.includes(tid))
                    .sort((a, b) => a - b)
                    .map((tid) => <option key={tid} value={tid}>{tid}</option>)}
                </select>
              )}
            </span>
          )}
          {numIn('début', c.startMs, (v) => v != null && onMoveClip(c.id, v))}
          {numIn('durée', c.durationMs, (v) => onResizeClip(c.id, v && v > 0 ? v : undefined))}
          {c.ref.type === 'slot' && numIn('fade in', c.fadeInMs,
            (v) => onSetClipFades(c.id, v, c.fadeOutMs),
            'Fade-in clip-local — vide = hérite le fade du slot')}
          {c.ref.type === 'slot' && numIn('fade out', c.fadeOutMs,
            (v) => onSetClipFades(c.id, c.fadeInMs, v),
            'Fade-out clip-local (tail après la fin) — vide = hérite le fade du slot')}
          {numIn('⟳ toutes les', c.repeatEveryMs, (v) => {
            // Repeat exige une fenêtre (durationMs) — un clip
            // ouvert qui devient bouclé prend le reste du score
            // comme fenêtre.
            if (v != null && v > 0 && c.durationMs == null) {
              onResizeClip(c.id, Math.max(v, durationMs - c.startMs));
            }
            onSetClipRepeat(c.id, v && v > 0 ? v : undefined);
          }, 'Tuile du motif — copies liées du move toutes les N s dans la fenêtre (défaut = un cycle pour les moves loopés)')}
          <button
            className="hover:text-gray-200 border border-gray-700 rounded px-1.5 py-0.5"
            title="Dupliquer le clip (copie indépendante, décalée de sa durée)"
            onClick={() => onDuplicateClip(c.id)}
          >⧉</button>
        </span>
      )}
      <div className="flex-1" />
      <button className="hover:text-gray-300" onClick={() => {
        useScoreStore.getState().clearScore();
        toast.info('Score vidé');
      }}>Vider le score</button>
    </div>
  );
};
