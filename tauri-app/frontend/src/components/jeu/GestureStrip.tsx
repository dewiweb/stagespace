/// Strip gestes live — les gestes du jeu, pas des réglages :
/// compression spatiale (slider live k) + release de la stase attention.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { doAttention, doSpatial } from '../../utils/liveActions';

export const GestureStrip: React.FC = () => {
  const [spatialK, setSpatialK] = React.useState(1);

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
        className="px-4 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold"
        title="Libère la stase attention (tous les objets redeviennent vivants)"
      >
        ATTN ✕
      </button>
    </div>
  );
};

export default GestureStrip;
