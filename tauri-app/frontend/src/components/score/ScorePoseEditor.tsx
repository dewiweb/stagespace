/// Fiche pose de la bibliothèque score — SEULE fiche éditable (les
/// slots/cues sont read-only) : table x/y/z par track, ajout/retrait
/// de tracks. Édition numérique pure — la pose peut être construite
/// sans placer les objets physiquement (design §8 « Édition »).
/// Sauvegarde explicite via pose_save (remplacement atomique backend).
import React, { useState } from 'react';
import { usePoseStore } from '../../store/usePoseStore';
import { useGraphStore } from '../../store/useGraphStore';
import type { Pose } from '../../types/generated/Pose';

const AXIS = ['x', 'y', 'z'] as const;

export const ScorePoseEditor: React.FC<{
  pose: Pose;
  /// Insère le clip au playhead (même payload que le drag & drop).
  onInsert: () => void;
}> = ({ pose, onInsert }) => {
  const savePose = usePoseStore((s) => s.savePose);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  // Brouillon local — copie des positions ; dirty = divergence avec la
  // pose backend. Sauvegarde explicite : l'opérateur peut expérimenter
  // et abandonner (revert) sans toucher la table backend.
  const [draft, setDraft] = useState<Record<string, [number, number, number]>>(
    () => ({ ...pose.positions }),
  );
  const [newTrack, setNewTrack] = useState('');
  // Reset du brouillon quand la pose change (sélection ou refresh
  // post-save) — même pattern key-remount que les fiches du score.
  const [prevKey, setPrevKey] = useState(pose.name + JSON.stringify(pose.positions));
  const curKey = pose.name + JSON.stringify(pose.positions);
  if (prevKey !== curKey) {
    setPrevKey(curKey);
    setDraft({ ...pose.positions });
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(pose.positions);
  const tracks = Object.keys(draft)
    .map(Number)
    .sort((a, b) => a - b);

  const setAxis = (track: number, axis: number, v: number) => {
    const pos = [...(draft[track] ?? [0, 0, 0])] as [number, number, number];
    pos[axis] = v;
    setDraft({ ...draft, [track]: pos });
  };

  const removeTrack = (track: number) => {
    const next = { ...draft };
    delete next[track];
    setDraft(next);
  };

  const addTrack = () => {
    const t = Number(newTrack);
    if (!t || draft[t] !== undefined) return;
    setDraft({ ...draft, [t]: [0, 0, 0] });
    setNewTrack('');
  };

  const save = () => {
    void savePose({ name: pose.name, positions: draft });
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-3 py-2 text-[10px] text-gray-400">
      <div className="font-bold text-gray-200 mb-2 flex items-center gap-2">
        {pose.name}
        {dirty && <span className="text-amber-400 font-normal">modifié</span>}
      </div>

      {/* Table x/y/z par track — la track non patchée (absente du
          mapping courant) est marquée amber : elle serait skippée au
          recall, mais reste éditable (le patch peut changer). */}
      <div className="flex flex-col gap-0.5 max-w-md">
        <div className="flex items-center gap-1 text-gray-600 uppercase tracking-wider text-[9px]">
          <span className="w-12">track</span>
          {AXIS.map((a) => (
            <span key={a} className="w-14 text-center">{a}</span>
          ))}
          <span className="w-6" />
        </div>
        {tracks.map((t) => {
          const patched = manualOscIds.includes(t);
          return (
            <div key={t} className="flex items-center gap-1">
              <span className={`w-12 font-mono ${patched ? 'text-gray-300' : 'text-amber-500'}`}
                title={patched ? undefined : 'Track not patched — skipped at recall'}>
                T{t}{patched ? '' : ' ⚠'}
              </span>
              {AXIS.map((_, axis) => (
                <input
                  key={axis}
                  type="number"
                  step={0.1}
                  value={draft[t]?.[axis] ?? 0}
                  onChange={(e) => setAxis(t, axis, Number(e.target.value) || 0)}
                  className="w-14 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-200 focus:border-violet-600 focus:outline-none text-right"
                />
              ))}
              <button
                onClick={() => removeTrack(t)}
                className="w-6 text-gray-600 hover:text-red-400"
                title={`Remove track ${t} from the pose`}
              >×</button>
            </div>
          );
        })}
        {tracks.length === 0 && (
          <div className="text-gray-600 italic py-1">pose vide — ajoute une track</div>
        )}

        {/* Ajout de track — id numérique direct (le mapping connu est
            suggéré en placeholder) ; pas de validation de patch : une
            pose peut préparer des tracks pas encore patchées. */}
        <div className="flex items-center gap-1 mt-1">
          <input
            value={newTrack}
            onChange={(e) => setNewTrack(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') addTrack(); }}
            placeholder={`+ track (ex ${manualOscIds[0] ?? 1})`}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-600 focus:border-violet-600 focus:outline-none"
          />
          <button
            onClick={addTrack}
            disabled={!newTrack}
            className="px-2 py-0.5 rounded bg-gray-800 hover:bg-violet-900/60 text-gray-300 text-[10px] disabled:opacity-30"
          >+ add</button>
        </div>

        {/* Actions — save explicite (dirty) / revert + insertion. */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty}
            className="px-2 py-0.5 rounded bg-violet-900/60 hover:bg-violet-800/60 text-violet-200 disabled:opacity-30 disabled:cursor-not-allowed border border-violet-800/50"
            title="Save the pose (atomic backend replace)"
          >✓ save</button>
          <button
            onClick={() => setDraft({ ...pose.positions })}
            disabled={!dirty}
            className="px-2 py-0.5 rounded text-gray-400 hover:text-gray-200 disabled:opacity-30"
            title="Discard the draft — back to the backend pose"
          >revert</button>
          <span className="text-gray-700">·</span>
          <button
            className="hover:text-gray-200 border border-gray-700 rounded px-2 py-0.5"
            title="Insérer un clip pose au playhead sur la lane CONDUCTOR"
            onClick={onInsert}
          >⤵ insérer au playhead</button>
          <span className="text-gray-600 italic">ou glisser sur la timeline</span>
        </div>
      </div>
    </div>
  );
};
