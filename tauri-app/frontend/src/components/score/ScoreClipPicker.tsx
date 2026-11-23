/// Picker d'ajout de clip — globalfx → markers ; lane objet →
/// slots/cues. La couverture du clip suit l'assignation : slot →
/// ses trackIds, cue → la couverture dérivée du snapshot.
import React from 'react';
import { GLOBALFX_LANE } from '../../store/useScoreStore';
import { useModalGuard } from '../../utils/modalGuard';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import type { MoveSlot } from '../../store/slices/moveSlotsTypes';
import type { Cue } from '../../types/generated/Cue';
import { extractDuration } from '../../store/slices/moveSlotsTypes';
import { cueCoverage } from '../../utils/scoreResolve';

export interface ScorePickerState {
  laneId: string;
  x: number;
  y: number;
}

export const ScoreClipPicker: React.FC<{
  picker: ScorePickerState;
  moveSlots: MoveSlot[];
  cues: Cue[];
  manualOscIds: number[];
  onPick: (ref: ScoreClipDoc['ref'], opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => void;
  /// Appelé quand Esc est pressé alors que le picker est au sommet de
  /// la stack de modals — le picker est monté/démonté, useModalGuard
  /// suffit (pas de panic global quand il est ouvert).
  onClose: () => void;
}> = ({ picker, moveSlots, cues, manualOscIds, onPick, onClose }) => {
  useModalGuard(onClose);
  return (
  <div
    className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 max-h-64 overflow-auto min-w-52"
    style={{ left: picker.x, top: picker.y }}
    onClick={(e) => e.stopPropagation()}
  >
    {picker.laneId === GLOBALFX_LANE ? (
      <>
        <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-800/40" onClick={() => onPick({ type: 'stopAll' })}>
          ■ STOP ALL — coupe tous les moves
        </button>
        <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-900/40" onClick={() => onPick({ type: 'panic' })}>
          ■ PANIC — arrêt d'urgence (origines)
        </button>
      </>
    ) : (
      <>
        {moveSlots.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase">Moves</div>}
        {moveSlots.map((s) => (
          <button
            key={s.id}
            title={`Assignation : tracks ${s.trackIds.join(', ') || '—'}`}
            className="w-full text-left px-3 py-1 text-xs hover:bg-purple-700/40 truncate"
            onClick={() => {
              const dur = s.graphJson ? extractDuration(s.graphJson.nodes) * 1000 : 30_000;
              onPick({ type: 'slot', slotId: s.id }, {
                durationMs: dur,
                trackIds: s.trackIds,
                // Défaut score = tuile du motif : un move LOOPÉ
                // s'insère déjà en copies liées (une par cycle,
                // période = durée du graphe) — étendre le clip
                // en ajoute. oneshot → clip simple, pas de tuile.
                repeatEveryMs: s.loopMode !== 'oneshot' ? dur : undefined,
              });
            }}
          >
            ⬤ {s.name}
          </button>
        ))}
        {moveSlots.length === 0 && (
          <div className="px-3 py-2 text-[10px] text-gray-500">Aucun slot — créez-en un dans Atelier</div>
        )}
        {cues.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase">Cues</div>}
        {cues.map((c, i) => (
          <button
            key={c.id}
            className="w-full text-left px-3 py-1 text-xs hover:bg-amber-700/40 truncate"
            onClick={() => onPick({ type: 'cue', cueId: String(c.id) }, { trackIds: cueCoverage(c, manualOscIds) })}
          >
            ◆ CUE {c.cue_number ?? i + 1} {c.name}
          </button>
        ))}
        {cues.length === 0 && (
          <div className="px-3 py-2 text-[10px] text-gray-500">Aucune cue — capturez-en une dans Atelier</div>
        )}
      </>
    )}
  </div>
  );
};
