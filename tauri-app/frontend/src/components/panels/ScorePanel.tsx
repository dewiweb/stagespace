/// Partition & bande — RECORDER du séquenceur : la capture du busking
/// devient des clips/courbes de la timeline Score (refs vivantes —
/// rejouer la prise rejoue les entités, pas des commandes opaques) ;
/// TAPE = positions émises ~30Hz (flux brut pour bounce/renderer
/// externe — le rendu audio reste chez le renderer).
import React from 'react';
import { doRehearsal, doTape, tapeImport } from '../../utils/liveActions';

const btn = 'px-1.5 py-0.5 text-[10px] rounded';
const rec = `${btn} bg-stagespace-danger/15 hover:bg-stagespace-danger/25 text-stagespace-danger`;
const stp = `${btn} bg-gray-800 hover:bg-gray-700 text-gray-400`;
const ply = `${btn} bg-stagespace-live/15 hover:bg-stagespace-live/25 text-stagespace-live`;

export const ScorePanel: React.FC = () => {
  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-3 py-2 border-b border-stagespace-border text-gray-300 font-semibold">
        Partition &amp; bande
      </div>
      <div className="p-3 space-y-4">
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">Score — recorder</div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => doRehearsal('record')} title="REC — capture le busking (actions live → clips)" className={rec}>⏺ rec</button>
            <button onClick={() => doRehearsal('stop')} title="STOP — matérialise la prise en clips de la timeline" className={stp}>⏹</button>
            <button onClick={() => doRehearsal('play')} title="PLAY — lit la partition (transport Score)" className={ply}>▶</button>
            <button onClick={() => doRehearsal('clear')} title="Clear — vide la partition" className={stp}>✕</button>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            Enregistre les actions live (slots, cues, gestes, positions, macros)
            puis les matérialise en clips/courbes éditables de la timeline —
            la prise s'ajoute en fin de partition (sauvegardée dans le .hfg).
          </p>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">Tape — positions (30 Hz)</div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => doTape('record')} title="Tape rec — positions réellement émises" className={rec}>⏺ rec</button>
            <button onClick={() => doTape('stop')} title="Tape stop" className={stp}>⏹</button>
            <button onClick={() => doTape('play')} title="Tape play — rejoue le flux au rythme réel" className={ply}>▶</button>
            <button onClick={() => doTape('export')} title="Tape export — positions JSON" className={stp}>↓ export</button>
            <label title="Tape import — rejoue une bande de positions" className={`${stp} cursor-pointer`}>
              ↑ import
              <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && tapeImport(e.target.files[0])} />
            </label>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            Enregistre le flux positions tel qu'émis → répétition distante
            ou bounce chez un renderer externe (le rendu audio est chez eux).
          </p>
        </div>
      </div>
    </div>
  );
};

export default ScorePanel;
