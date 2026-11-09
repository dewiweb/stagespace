import React from 'react';
import { doUnpark } from '../../utils/liveActions';

/// Chip objets parkés : affiche le count, au clic un mini-panneau liste
/// chaque objet avec unpark individuel + "Unpark all". `compact` =
/// variante topbar petite.
export const ParkedChip: React.FC<{ parked: number[]; compact?: boolean }> = ({ parked, compact }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-lg bg-cyan-800/70 hover:bg-cyan-700 text-cyan-100 font-bold transition-colors active:scale-95 ${
          compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-lg'
        }`}
        title={`Objets parkés (hors recalls) : ${parked.join(', ')} — cliquer pour dégeler`}
      >
        {parked.length} PARKED
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-menu bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[180px]">
          <div className="text-gray-400 text-[10px] uppercase tracking-wider px-1 pb-1">
            Parked — hors recalls
          </div>
          {parked.map((obj) => (
            <div key={obj} className="flex items-center justify-between gap-2 px-1 py-1">
              <span className="text-cyan-200 font-mono text-sm">obj {obj}</span>
              <button
                onClick={() => doUnpark(obj)}
                className="px-2 py-0.5 rounded bg-gray-700 hover:bg-cyan-700 text-xs text-gray-200"
              >
                unpark
              </button>
            </div>
          ))}
          {parked.length > 1 && (
            <button
              onClick={() => parked.forEach((obj) => doUnpark(obj))}
              className="w-full mt-1 px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-xs font-semibold text-white"
            >
              Unpark all
            </button>
          )}
        </div>
      )}
    </div>
  );
};
