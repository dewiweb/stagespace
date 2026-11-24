/// Picker d'ajout de clip — conductor → événements-barrières
/// (cues, stopAll, panic) ; globalfx → markers ; lane objet →
/// slots. La couverture du clip suit l'assignation : slot → ses
/// trackIds, cue → le blast radius dérivé du snapshot.
import React from 'react';
import { GLOBALFX_LANE, CONDUCTOR_LANE, OSC_LANE } from '../../store/useScoreStore';
import { useModalGuard } from '../../utils/modalGuard';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import type { MoveSlot } from '../../store/slices/moveSlotsTypes';
import type { Cue } from '../../types/generated/Cue';
import { extractDuration } from '../../store/slices/moveSlotsTypes';

export interface ScorePickerState {
  laneId: string;
  x: number;
  y: number;
  /// Position d'insertion — "ajouter un clip ici" du menu contextuel
  /// pose le clip à cet instant ; absent = curseur (comportement +).
  startMs?: number;
}

export const ScoreClipPicker: React.FC<{
  picker: ScorePickerState;
  moveSlots: MoveSlot[];
  cues: Cue[];

  onPick: (ref: ScoreClipDoc['ref'], opts?: { durationMs?: number; trackIds?: number[]; repeatEveryMs?: number }) => void;
  /// Appelé quand Esc est pressé alors que le picker est au sommet de
  /// la stack de modals — le picker est monté/démonté, useModalGuard
  /// suffit (pas de panic global quand il est ouvert).
  onClose: () => void;
}> = ({ picker, moveSlots, cues, onPick, onClose }) => {
  useModalGuard(onClose);
  return (
  <div
    className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 max-h-64 overflow-auto min-w-52"
    style={{ left: picker.x, top: picker.y }}
    onClick={(e) => e.stopPropagation()}
  >
    {picker.laneId === CONDUCTOR_LANE ? (
      <>
        <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-800/40" onClick={() => onPick({ type: 'stopAll' })}>
          ■ STOP ALL — coupe tous les moves
        </button>
        <button className="w-full text-left px-3 py-1 text-xs hover:bg-red-900/40" onClick={() => onPick({ type: 'panic' })}>
          ■ PANIC — arrêt d'urgence (origines)
        </button>
        <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Gestes — impulsion globale</div>
        {(['explode', 'converge', 'orbit', 'front'] as const).map((g) => (
          <button
            key={g}
            className="w-full text-left px-3 py-1 text-xs hover:bg-orange-700/40"
            title={`Geste balistique "${g}" sur tous les objets émis (/stagespace/gesture)`}
            onClick={() => onPick({ type: 'gesture', name: g, strength: 3 })}
          >
            ◈ {g.toUpperCase()}
          </button>
        ))}
        <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Contrôle — cibles = couverture</div>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-sky-700/40"
          title="Fige les objets couverts — exempts des recalls (/stagespace/park). Vide = tout le patch."
          onClick={() => onPick({ type: 'park' })}
        >◉ PARK — figer les objets couverts</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-sky-700/40"
          title="Relâche les objets couverts ; couverture vide = relâche tout (/stagespace/unpark)"
          onClick={() => onPick({ type: 'unpark' })}
        >◯ UNPARK — relâcher</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-sky-700/40"
          title="Lance balistique (m/s) des objets couverts (/stagespace/throw) — vélocité éditable dans l'inspector"
          onClick={() => onPick({ type: 'throw', vel: [3, 0, 0] })}
        >↷ THROW — lancer</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-sky-700/40"
          title="Relâche les positions manuelles couvertes ; couverture vide = tout (/stagespace/position/clearall)"
          onClick={() => onPick({ type: 'manualClear' })}
        >◇ MANUEL OFF — rendre la main</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-sky-700/40"
          title="Stase : tout fige sauf le 1er objet couvert ; couverture vide = release (/stagespace/attention)"
          onClick={() => onPick({ type: 'attention' })}
        >◎ ATTENTION — stase</button>
        {cues.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Cues — recall barrière</div>}
        {cues.map((c, i) => (
          <button
            key={c.id}
            className="w-full text-left px-3 py-1 text-xs hover:bg-amber-700/40 truncate"
            onClick={() => onPick({ type: 'cue', cueId: String(c.id) })}
          >
            ◆ CUE {c.cue_number ?? i + 1} {c.name}
          </button>
        ))}
        {cues.length === 0 && (
          <div className="px-3 py-2 text-[10px] text-gray-500">Aucune cue — capturez-en une dans Atelier</div>
        )}
      </>
    ) : picker.laneId === OSC_LANE ? (
      <>
        <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">OSC-out — message externe</div>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-emerald-700/40"
          title="Message OSC arbitraire émis au tir — adresse/args/cible éditables dans l'inspector (défaut = la sortie OSC du show)"
          onClick={() => onPick({ type: 'osc', addr: '/cue/go', args: '' })}
        >→OSC message — lumières/vidéo/consoles</button>
      </>
    ) : picker.laneId === GLOBALFX_LANE ? null : (
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
                // trackIds omis = suivi live : la couverture dérive
                // du slot à chaque play (réassignations reflétées).
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
      </>
    )}
  </div>
  );
};
