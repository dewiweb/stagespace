/// Strip gestes live — les gestes du jeu, pas des réglages :
/// compression spatiale (slider live k) + release de la stase attention.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { doAttention, doSpatial } from '../../utils/liveActions';
import { useGraphStore } from '../../store/useGraphStore';

export const GestureStrip: React.FC = () => {
  const [spatialK, setSpatialK] = React.useState(1);
  // Un objet en stase attention = source 'freeze' (frozen_attn côté
  // merge) — le bouton reflète l'état réel au lieu d'être toujours actif.
  const attnActive = useGraphStore((s) => Object.values(s.objectStates).includes('freeze'));

  return (
    <div className="flex gap-3 items-stretch">
      <div className="flex-1 bg-gray-900 rounded-lg px-4 py-2.5 flex items-center gap-3">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest flex-shrink-0">spatial</span>
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.05}
          value={spatialK}
          onChange={(e) => {
            const k = parseFloat(e.target.value);
            setSpatialK(k);
            doSpatial(k);
          }}
          className="flex-1 accent-indigo-500"
          title="Compresseur spatial — k<1 resserre le champ, k>1 l'étend"
        />
        <span className="text-[10px] text-gray-600 w-14 text-right">×{spatialK.toFixed(2)}</span>
      </div>
      <button
        onClick={() => doAttention(null)}
        className={`px-4 rounded-lg text-xs font-bold ${
          attnActive
            ? 'bg-amber-800 hover:bg-amber-700 text-amber-100 animate-pulse'
            : 'bg-gray-800 text-gray-600'
        }`}
        title={
          attnActive
            ? 'Libère la stase attention (tous les objets redeviennent vivants)'
            : 'Pas de stase attention active'
        }
      >
        ATTN ✕
      </button>
    </div>
  );
};

export default GestureStrip;
