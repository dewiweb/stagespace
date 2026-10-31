import React from 'react';
import { PanicButton } from '../ui/PanicButton';

/// Transport de show unifié — Prev / GO / Next / Panic.
///
/// Sémantique unique, partagée par toutes les surfaces :
///   GO   = GO setlist (crossfade vers le prochain move — doGo)
///   Prev/Next = recall cue précédente/suivante (kill+respawn — doCuePrev/Next)
///   Panic = stop-all + origines (PanicButton partagé)
///
/// Les callbacks sont injectés — la même barre sert l'overlay conduite de
/// PerformView (liveActions directs) et la fenêtre ConduitePage (emit
/// conduite:cmd) sans dupliquer ni diverger la sémantique.
interface ShowTransportProps {
  onPrev: () => void;
  onGo: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /// Élément panic custom — défaut : PanicButton partagé.
  panic?: React.ReactNode;
  /// 'lg' = surface conduite (gros doigt), 'sm' = barre compacte.
  size?: 'lg' | 'sm';
  className?: string;
}

export const ShowTransport: React.FC<ShowTransportProps> = ({
  onPrev,
  onGo,
  onNext,
  prevDisabled,
  nextDisabled,
  panic,
  size = 'lg',
  className = '',
}) => {
  const lg = size === 'lg';
  const sideCls = lg
    ? 'px-10 py-6 rounded-2xl text-2xl font-bold'
    : 'px-3 py-1.5 rounded-lg text-xs font-bold';
  const goCls = lg
    ? 'px-16 py-6 rounded-2xl text-3xl font-black'
    : 'px-6 py-1.5 rounded-lg text-lg font-black';
  return (
    <div className={`flex items-center justify-center ${lg ? 'gap-6' : 'gap-2'} ${className}`}>
      <button
        onClick={onPrev}
        disabled={prevDisabled}
        className={`${sideCls} bg-gray-800 text-gray-200 disabled:opacity-30 active:scale-95`}
        title="Recall previous cue"
      >
        ◀ Prev
      </button>
      <button
        onClick={onGo}
        className={`${goCls} bg-green-600 text-white active:scale-95`}
        title="GO — crossfade to next move in setlist"
      >
        GO ▶
      </button>
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className={`${sideCls} bg-gray-800 text-gray-200 disabled:opacity-30 active:scale-95`}
        title="Recall next cue"
      >
        Next ▶
      </button>
      {panic !== undefined ? panic : <PanicButton size={lg ? 'lg' : 'sm'} />}
    </div>
  );
};

export default ShowTransport;
