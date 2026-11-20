import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { ModeButtons } from './ModeButtons';
import { DrawToolbarTools, DrawToolbarOptions, drawToolHint } from './DrawToolbar';
import { MacrosSurface } from '../show/MacrosSurface';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { isDetachedWindow } from '../../utils/safeStorage';

interface ViewerToolbarProps {
  isPlaying: boolean;
}

/**
 * Toolbar dockée en haut de la surface 3D — remplace l'accumulation
 * d'overlays flottants (mode buttons, bannières de mode, panneau macros,
 * barre studio) qui couvraient la vue.
 *
 * Structure : [modes] | [outils contextuels du mode] ····· [hint]
 * + une 2e ligne d'options en draw mode uniquement.
 */
export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ isPlaying }) => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const zonePlaceMode = useGraphStore((s) => s.zonePlaceMode);
  const zoneEditMode = useGraphStore((s) => s.zoneEditMode);
  const splineTool = useGraphStore((s) => s.splineTool);
  const drawView = useGraphStore((s) => s.drawView);
  const movements = useGraphStore((s) => s.movements);
  const detached = isDetachedWindow();

  let hint: string | null = null;
  if (drawMode) hint = drawToolHint(splineTool, drawView);
  else if (manipulateMode) hint = 'drag objects · drag handle = move · wheel = zoom/scale (Esc)';
  else if (assignMode) hint = 'click objects to toggle their track for this move (Esc)';
  else if (zonePlaceMode) hint = 'click on the floor to set the zone center (Esc)';
  else if (zoneEditMode) hint = 'drag a zone to move it · wheel over it = resize (Esc)';

  return (
    <div className="flex-shrink-0 bg-gray-900/95 border-b border-gray-700/60">
      {/* Row 1 : modes + outils contextuels + hint */}
      <div className="flex items-center gap-2 px-2 py-1 flex-wrap">
        <ModeButtons />
        {(drawMode || manipulateMode || assignMode || zonePlaceMode || zoneEditMode) && (
          <span className="w-px h-5 bg-gray-700" />
        )}
        {drawMode && <DrawToolbarTools />}
        {manipulateMode && (
          <>
            {isPlaying && <span className="text-stagespace-live text-[10px] font-bold animate-pulse">LIVE</span>}
            {movements.length > 0 && (
              <button
                onClick={() =>
                  safeInvoke('clear_all_manual_positions').catch((e) => toast.error('Clear overrides failed: ' + e))
                }
                className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 text-gray-300 hover:text-stagespace-warning"
              >
                Clear overrides
              </button>
            )}
          </>
        )}
        <span className="flex-1" />
        {hint && (
          <span className="text-orange-400/90 text-[10px] font-medium truncate max-w-[45%]">
            <span className={detached ? 'opacity-60' : ''}>{hint}</span>
          </span>
        )}
      </div>
      {/* Row 2 : options du spline studio / macros globales */}
      {drawMode && (
        <div className="flex items-center gap-2 px-2 pb-1.5 flex-wrap">
          <DrawToolbarOptions />
        </div>
      )}
      {manipulateMode && (
        <div className="px-2 pb-1.5">
          <MacrosSurface horizontal layout="row" live={movements.length > 0} includeRadius={false} />
        </div>
      )}
    </div>
  );
};

export default ViewerToolbar;
