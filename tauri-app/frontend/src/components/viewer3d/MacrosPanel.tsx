import React from 'react';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { MacrosSurface } from '../show/MacrosSurface';

/// Overlay "Manipulate" du canvas 3D — macros globales via MacrosSurface
/// partagé (plus de 3e surface divergente) + clear des overrides manuels,
/// qui est la vraie fonction "manipulate" du panneau.
export const MacrosPanel: React.FC<{ isPlaying: boolean; hasMovements: boolean }> = ({
  isPlaying,
  hasMovements,
}) => {
  return (
    <div className="absolute top-2 left-2 z-overlay bg-gray-900/90 backdrop-blur rounded-lg p-3 border border-stagespace-border min-w-[200px] space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Manipulate</span>
        {isPlaying && <span className="text-stagespace-live text-xs font-bold animate-pulse">LIVE</span>}
      </div>
      <MacrosSurface layout="stack" live={hasMovements} includeRadius={false} />
      {hasMovements && (
        <button
          onClick={() =>
            safeInvoke('clear_all_manual_positions').catch((e) => toast.error('Clear overrides failed: ' + e))
          }
          className="w-full text-xs text-gray-400 hover:text-stagespace-warning py-1 transition-colors"
        >
          Clear All Overrides
        </button>
      )}
    </div>
  );
};

export default MacrosPanel;
