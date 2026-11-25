import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { DrawMenuBar } from './DrawToolbar';
import { GlobalTransformSurface } from '../show/GlobalTransformSurface';
import { MACRO_NEUTRAL } from '../../store/slices/macrosSlice';
import { SlidersHorizontal, ChevronDown, RotateCcw, Box } from 'lucide-react';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import { tbAction, tbGroup, tbBtn, tbSep, tbIdle } from './toolbarStyles';
import type { DrawView } from '../../utils/splineCore';

interface ViewerToolbarProps {
  isPlaying: boolean;
}

/**
 * Menu bar du viewer 3D — ligne unique dockée en haut du canvas, dans
 * le layout "éditeur" (palette à gauche, status bar en bas).
 *
 * Contenu :
 * - tous les modes : vues Free/Top/Front/Side — en dehors du draw elles
 *   servent de vues d'inspection ortho (snap caméra + rotation verrouillée,
 *   pan/zoom libres) ; en draw elles choisissent la feuille de travail.
 * - draw       : sélecteur/reload DrawSpline + Done/Cancel (DrawMenuBar)
 * - manipulate : popover macros + LIVE + clear overrides
 *
 * Les hints contextuels vivent dans la status bar (bas), les outils
 * dans la palette (gauche).
 */
export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ isPlaying }) => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const drawView = useGraphStore((s) => s.drawView);
  const setDrawView = useGraphStore((s) => s.setDrawView);
  const movements = useGraphStore((s) => s.movements);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const [macrosOpen, setMacrosOpen] = React.useState(false);

  // Les macros ne vivent plus en pilules dans la toolbar (illisibles en
  // live) — le geste est l'outil principal, le panneau complet s'ouvre
  // à la demande. Le popover meurt avec le mode (render conditionnel).
  const toggleMacros = () => setMacrosOpen((o) => !o);
  const resetMacros = () => {
    setMacros({ ...MACRO_NEUTRAL });
    void pushMacrosToRuntime();
  };

  return (
    <div className="flex-shrink-0 relative bg-gray-900/95 border-b border-gray-700/60">
      <div className="flex items-center gap-2 px-1.5 py-1 flex-nowrap overflow-hidden">
        <div className={tbGroup}>
          <span className="h-6 px-1.5 flex items-center text-stagespace-accent" title="View — Free = orbit, Top/Front/Side = fixed ortho (rotate locked)"><Box size={11} /></span>
          {(['free', 'top', 'front', 'side'] as DrawView[]).map((v) => (
            <button
              key={v}
              title={`${v[0].toUpperCase() + v.slice(1)} view — snap camera${v === 'free' ? ', free orbit' : ', rotation locked'}`}
              onClick={() => setDrawView(v)}
              className={`${tbBtn} ${drawView === v ? 'bg-stagespace-accent text-white' : tbIdle}`}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <span className={tbSep} />
        {drawMode && <DrawMenuBar />}
        {manipulateMode && (
          <>
            <button
              onClick={toggleMacros}
              title="Global transform — merge scope (speed, scale, shift, rotation, radius, height)"
              className={`${tbAction} border ${
                macrosOpen
                  ? 'bg-stagespace-accent/80 border-stagespace-accent/60 text-white'
                  : 'bg-gray-800/70 border-gray-700/70 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <SlidersHorizontal size={11} /> Transform <ChevronDown size={10} className={macrosOpen ? 'rotate-180' : ''} />
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
        {!drawMode && !manipulateMode && (
          <>
            <span
              className="text-gray-500 text-[10px] font-mono tracking-wider select-none cursor-default opacity-70"
              title="Read-only 3D preview — pick Select/Manipulate/Draw in the tools to interact with objects"
            >
              · 3D PREVIEW
            </span>
            <span className="flex-1" />
          </>
        )}
      </div>
      {manipulateMode && macrosOpen && (
        <>
          {/* Backdrop — clic dehors = fermer, sans capter le scroll/pan */}
          <div className="fixed inset-0 z-[55]" onPointerDown={() => setMacrosOpen(false)} />
          {/* Popover ancré à la toolbar — le vrai panneau macros, pas des
              mini-sliders compressés dans le bandeau. */}
          <div className="absolute left-1.5 top-full z-[60] mt-1 w-64 rounded-md border border-gray-700/80 bg-gray-900/98 shadow-2xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Global transform</span>
              <button
                onClick={resetMacros}
                title="Reset global transform to neutral"
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
              >
                <RotateCcw size={10} /> Reset
              </button>
            </div>
            <GlobalTransformSurface layout="stack" live={movements.length > 0} includeRadius />
          </div>
        </>
      )}
    </div>
  );
};

export default ViewerToolbar;
