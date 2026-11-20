import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { ObjectInspectBar } from './ObjectInspectBar';

/**
 * Status bar dockée en bas de la surface 3D — remplace les indicateurs
 * flottants (chips movements bottom-right, inspect bar bottom-center).
 * Rendue uniquement quand il y a du contenu.
 */
export const ViewerStatusBar: React.FC = () => {
  const movements = useGraphStore((s) => s.movements);
  const selectedObjIndex = useGraphStore((s) => s.selectedObjIndex);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);

  if (movements.length === 0 && selectedObjIndex === null) return null;

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-2 py-0.5 bg-gray-900/95 border-t border-gray-700/60 min-h-[26px]">
      {movements.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500 text-[10px] font-mono">MOVEMENTS</span>
          {movements.map((mv, idx) => (
            <span
              key={mv.id}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                mv.is_preview ? 'bg-cyan-900 text-cyan-400' : 'bg-green-900 text-green-400'
              }`}
              title={`${mv.name} — ${mv.track_count} tracks`}
            >
              {idx + 1}{mv.is_preview ? '👁' : '▶'}
            </span>
          ))}
        </div>
      )}
      <span className="flex-1" />
      {selectedObjIndex !== null && <ObjectInspectBar positions={emittedPositions} />}
    </div>
  );
};

export default ViewerStatusBar;
