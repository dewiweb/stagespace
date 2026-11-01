/// Release flottante des objets tenus en manuel — visible sur toutes les
/// surfaces (App-level). Une position manuelle a priorité au merge : un
/// objet dragué reste figé tant qu'elle n'est pas retirée. C'est le seul
/// chemin GUI fiable : clic-droit = menu natif webview, Alt = WM Linux,
/// les gestes modificateurs sont tous captés avant l'app.
import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { doClearPosition, doClearAllPositions, doUnpark, doAttention } from '../utils/liveActions';

export const ManualReleaseBar: React.FC = () => {
  // Tous les états override qui figent un objet — chacun avec son release :
  //   manual/hold → clear_manual_position · park → unpark · freeze →
  //   attention/clear. Un objet dragué/thrown peut tomber dans n'importe
  //   lequel selon le chemin de prise.
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualPositions = useGraphStore((s) => s.manualPositions);
  const RELEASE: Record<string, (i: number) => void> = {
    manual: doClearPosition, hold: doClearPosition,
    park: doUnpark, freeze: () => doAttention(null),
  };
  const held = Object.entries(objectStates)
    .filter(([i, s]) => RELEASE[s] != null || manualPositions[Number(i)] != null)
    .map(([i]) => Number(i))
    .sort((a, b) => a - b);
  if (held.length === 0) return null;
  return (
    <div className="fixed bottom-11 left-3 z-40 flex items-center gap-1.5 bg-gray-900/95 border border-orange-500/50 rounded-lg px-2.5 py-1.5 shadow-xl">
      <span className="text-orange-400 text-[9px] font-bold uppercase tracking-wider">manual</span>
      {held.slice(0, 12).map((i) => (
        <button
          key={i}
          className="text-[11px] px-1.5 py-0.5 rounded bg-orange-900/60 text-orange-200 hover:bg-orange-600 hover:text-white transition-colors"
          title={`Release obj ${i} (${objectStates[i] ?? 'manual'}) — le moteur reprend la main`}
          onClick={() => (RELEASE[objectStates[i] ?? ''] ?? doClearPosition)(i)}
        >
          {i}×
        </button>
      ))}
      {held.length > 12 && <span className="text-orange-300 text-[10px]">+{held.length - 12}</span>}
      <button
        className="text-[10px] px-1.5 text-gray-400 hover:text-white underline underline-offset-2"
        title="Release ALL manual positions"
        onClick={doClearAllPositions}
      >
        all
      </button>
    </div>
  );
};
