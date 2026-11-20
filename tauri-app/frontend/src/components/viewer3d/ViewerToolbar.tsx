import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { ModeButtons } from './ModeButtons';
import { DrawToolbarTools, DrawToolbarOptions, drawToolHint } from './DrawToolbar';
import { MacrosSurface } from '../show/MacrosSurface';
import { MACRO_NEUTRAL } from '../../store/slices/macrosSlice';
import { SlidersHorizontal, ChevronDown, RotateCcw } from 'lucide-react';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { isDetachedWindow } from '../../utils/safeStorage';
import { tbAction } from './toolbarStyles';

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
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const [macrosOpen, setMacrosOpen] = React.useState(false);
  const detached = isDetachedWindow();

  // Les macros ne vivent plus en pilules dans la toolbar (illisibles en
  // live) — le geste est l'outil principal, le panneau complet s'ouvre
  // à la demande. Le popover meurt avec le mode (render conditionnel).
  const toggleMacros = () => setMacrosOpen((o) => !o);
  const resetMacros = () => {
    setMacros({ ...MACRO_NEUTRAL });
    void pushMacrosToRuntime();
  };

  let hint: string | null = null;
  if (drawMode) hint = drawToolHint(splineTool, drawView);
  else if (manipulateMode) hint = 'drag = move · Shift+click = multi-select · handle = move all · wheel = zoom/scale (Esc)';
  else if (assignMode) hint = 'click objects to toggle their track for this move (Esc)';
  else if (zonePlaceMode) hint = 'click on the floor to set the zone center (Esc)';
  else if (zoneEditMode) hint = 'drag a zone to move it · wheel over it = resize (Esc)';

  return (
    <div className="flex-shrink-0 relative bg-gray-900/95 border-b border-gray-700/60">
      {/* Row 1 : modes + outils contextuels + hint */}
      <div className="flex items-center gap-2 px-1.5 py-1 flex-wrap">
        <ModeButtons />
        {(drawMode || manipulateMode || assignMode || zonePlaceMode || zoneEditMode) && (
          <span className="w-px h-4 bg-gray-700/70" />
        )}
        {drawMode && <DrawToolbarTools />}
        {manipulateMode && (
          <>
            <button
              onClick={toggleMacros}
              title="Global field macros (speed, scale, shift, rotation, radius, height)"
              className={`${tbAction} border ${
                macrosOpen
                  ? 'bg-purple-700/80 border-purple-500/60 text-white'
                  : 'bg-gray-800/70 border-gray-700/70 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <SlidersHorizontal size={11} /> Macros <ChevronDown size={10} className={macrosOpen ? 'rotate-180' : ''} />
            </button>
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
        {hint && !drawMode && (
          <span className="text-orange-400/90 text-[10px] font-medium truncate max-w-[45%]">
            <span className={detached ? 'opacity-60' : ''}>{hint}</span>
          </span>
        )}
      </div>
      {/* Row 2 : options du spline studio / macros globales */}
      {drawMode && (
        <div className="flex items-center gap-2 px-1.5 pb-1 flex-nowrap overflow-hidden">
          <DrawToolbarOptions />
          <span className="flex-1 min-w-2" />
          {hint && (
            <span
              className="text-orange-400/90 text-[10px] font-medium truncate min-w-0 shrink"
              title={hint}
            >
              {hint}
            </span>
          )}
        </div>
      )}
      {manipulateMode && macrosOpen && (
        <>
          {/* Backdrop — clic dehors = fermer, sans capter le scroll/pan */}
          <div className="fixed inset-0 z-[55]" onPointerDown={() => setMacrosOpen(false)} />
          {/* Popover ancré à la toolbar — le vrai panneau macros, pas des
              mini-sliders compressés dans le bandeau. */}
          <div className="absolute left-1.5 top-full z-[60] mt-1 w-64 rounded-md border border-gray-700/80 bg-gray-900/98 shadow-2xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Global macros</span>
              <button
                onClick={resetMacros}
                title="Reset all macros to neutral"
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
              >
                <RotateCcw size={10} /> Reset
              </button>
            </div>
            <MacrosSurface layout="stack" live={movements.length > 0} includeRadius />
          </div>
        </>
      )}
    </div>
  );
};

export default ViewerToolbar;
