/// Picker d'ajout de clip — conductor → événements-barrières
/// (cues, stopAll, panic) ; globalfx → markers ; lane objet →
/// slots. La couverture du clip suit l'assignation : slot → ses
/// trackIds, cue → le blast radius dérivé du snapshot.
import React from 'react';
import { GLOBALFX_LANE, CONDUCTOR_LANE, OSC_LANE } from '../../store/useScoreStore';
import { useModalGuard } from '../../utils/modalGuard';
import { usePoseStore } from '../../store/usePoseStore';
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

const PoseSection: React.FC<{ onPick: (ref: ScoreClipDoc['ref']) => void }> = ({ onPick }) => {
  const poses = usePoseStore((s) => s.poses);
  const refreshPoses = usePoseStore((s) => s.refreshPoses);
  React.useEffect(() => { refreshPoses(); }, [refreshPoses]);
  if (!poses.length) return null;
  return (
    <>
      <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Poses — rappel de positions nommées</div>
      {poses.map((p) => (
        <button
          key={p.name}
          className="w-full text-left px-3 py-1 text-xs hover:bg-teal-700/40"
          title={`Pose '${p.name}' (${Object.keys(p.positions).length} tracks) — crée un clip goto ; le mode (snap/goto/morph), la durée et l'easing s'éditent dans l'inspector`}
          onClick={() => onPick({ type: 'pose', name: p.name, mode: 'goto', duration: 2, easing: 'smooth' })}
        >◆ {p.name}</button>
      ))}
    </>
  );
};

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
            className="w-full text-left px-3 py-1 text-xs hover:bg-teal-700/40"
            title={`Geste balistique "${g}" sur tous les objets émis (/stagespace/gesture)`}
            onClick={() => onPick({ type: 'gesture', name: g, strength: 3 })}
          >
            ◈ {g.toUpperCase()}
          </button>
        ))}
        <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Contrôle — cibles = couverture</div>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-fuchsia-700/40"
          title="Fige les objets couverts — exempts des recalls (/stagespace/park). Vide = tout le patch."
          onClick={() => onPick({ type: 'park' })}
        >◉ PARK — figer les objets couverts</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-fuchsia-700/40"
          title="Relâche les objets couverts ; couverture vide = relâche tout (/stagespace/unpark)"
          onClick={() => onPick({ type: 'unpark' })}
        >◯ UNPARK — relâcher</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-fuchsia-700/40"
          title="Lance balistique (m/s) des objets couverts (/stagespace/throw) — vélocité éditable dans l'inspector"
          onClick={() => onPick({ type: 'throw', vel: [3, 0, 0] })}
        >↷ THROW — lancer</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-fuchsia-700/40"
          title="Relâche les positions manuelles couvertes ; couverture vide = tout (/stagespace/position/clearall)"
          onClick={() => onPick({ type: 'manualClear' })}
        >◇ MANUEL OFF — rendre la main</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-fuchsia-700/40"
          title="Stase : tout fige sauf le 1er objet couvert ; couverture vide = release (/stagespace/attention)"
          onClick={() => onPick({ type: 'attention' })}
        >◎ ATTENTION — stase</button>
        <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Actions live — le score appuie sur le bouton</div>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40"
          title="Sonde cyclique par objet (/stagespace/soundcheck start) — ping de position tour à tour, identification spatiale"
          onClick={() => onPick({ type: 'soundcheck', action: 'start' })}
        >♪ SOUNDCHECK — start (sonde cyclique)</button>
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40"
          title="Arrête la sonde (/stagespace/soundcheck stop) — nettoie le ping courant"
          onClick={() => onPick({ type: 'soundcheck', action: 'stop' })}
        >♪ SOUNDCHECK — stop</button>
        {moveSlots.length > 0 && (
          <div className="px-3 py-0.5 text-[9px] text-gray-600 mt-0.5">Solo — coupe les autres slots, joue celui-là</div>
        )}
        {moveSlots.map((s) => (
          <button
            key={`solo-${s.id}`}
            className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40 truncate"
            title={`Solo slot « ${s.name} » (oscIndex ${s.oscIndex}) — fade-out les autres slots jouants puis le joue (/stagespace/solo)`}
            onClick={() => onPick({ type: 'solo', n: s.oscIndex })}
          >◈ SOLO {s.oscIndex} — {s.name}</button>
        ))}
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40"
          title="Rejoue les slots stoppés par le dernier solo (/stagespace/unsolo)"
          onClick={() => onPick({ type: 'unsolo' })}
        >◈ UNSOLO — restaurer le mix</button>
        <div className="px-3 py-0.5 text-[9px] text-gray-600 mt-0.5">Surface — bascule l'écran opérateur</div>
        {(['atelier', 'conduite', 'jeu', 'score'] as const).map((v) => (
          <button
            key={v}
            className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40"
            title={`Bascule la surface opérateur → ${v} (/stagespace/view)`}
            onClick={() => onPick({ type: 'view', surface: v })}
          >▣ VIEW — {v.toUpperCase()}</button>
        ))}
        <button
          className="w-full text-left px-3 py-1 text-xs hover:bg-lime-700/40"
          title="GO — tire la cue armée (ou la suivante si rien d'armé) : modèle console (/stagespace/cue/go)"
          onClick={() => onPick({ type: 'cueGo' })}
        >▶ CUE GO — feu sur l'armée</button>
        <PoseSection onPick={onPick} />
        {cues.length > 0 && <div className="px-3 py-0.5 text-[9px] text-gray-600 uppercase mt-1">Cues — recall barrière · ⇥ = armer sans tirer</div>}
        {cues.map((c, i) => (
          <div key={c.id} className="flex items-stretch">
            <button
              className="flex-1 text-left px-3 py-1 text-xs hover:bg-amber-700/40 truncate"
              onClick={() => onPick({ type: 'cue', cueId: String(c.id) })}
            >
              ◆ CUE {c.cue_number ?? i + 1} {c.name}
            </button>
            <button
              className="px-2 text-xs hover:bg-amber-700/40 text-amber-300"
              title="Armer cette cue sans la tirer (/stagespace/cue/arm — modèle console, GO la tire ensuite)"
              onClick={() => onPick({ type: 'cueArm', cueId: String(c.id) })}
            >⇥</button>
          </div>
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
