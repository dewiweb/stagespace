/// Partition & bande — la capture/rejeu de la mise en boîte :
/// SCORE = bande de commandes horodatée (le busking devient un cue
/// rejouable, exportable .sscore.json) ; TAPE = positions émises ~30Hz
/// (le flux positions, pour bounce/rejeu chez un renderer externe).
import React from 'react';
import { doRehearsal, scoreExport, scoreImport, doTape, tapeImport } from '../utils/liveActions';

const btn = 'px-1.5 py-0.5 text-[10px] rounded';
const rec = `${btn} bg-red-900/50 hover:bg-red-800/70 text-red-300`;
const stp = `${btn} bg-gray-800 hover:bg-gray-700 text-gray-400`;
const ply = `${btn} bg-green-900/50 hover:bg-green-800/70 text-green-300`;

export const ScorePanel: React.FC = () => {
  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-3 py-2 border-b border-stagespace-border text-gray-300 font-semibold">
        Partition &amp; bande
      </div>
      <div className="p-3 space-y-4">
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">Score — commandes horodatées</div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => doRehearsal('record')} title="Record — capture le busking (actions live)" className={rec}>⏺ rec</button>
            <button onClick={() => doRehearsal('stop')} title="Stop — fin de capture" className={stp}>⏹</button>
            <button onClick={() => doRehearsal('play')} title="Play — rejoue la partition" className={ply}>▶</button>
            <button onClick={scoreExport} title="Export — télécharge le score .sscore.json" className={stp}>↓ export</button>
            <label title="Import — charge un score JSON" className={`${stp} cursor-pointer`}>
              ↑ import
              <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && scoreImport(e.target.files[0])} />
            </label>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            Enregistre chaque action live (slots, gestes, positions) → rejouée
            comme une partition. Export = fichier .sscore.json partageable.
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
