import React, { MutableRefObject } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useMoveEditorStore } from '../../store/useMoveEditorStore';
import { debugPerf } from '../../utils/debugPerf';
import { ModChips } from '../ModChips';
import { ObjectInspectBar } from './ObjectInspectBar';
import { drawToolHint } from './DrawToolbar';

/// Métriques perf en une ligne — remplace l'ancien overlay flottant
/// top-left. Opt-in via le toggle canvas (debugPerfVisible).
const PerfStrip: React.FC = () => {
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    let raf: number;
    let lastUpdate = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Update ~5x/sec (pas 60fps — inutile)
      if (t - lastUpdate > 200) {
        forceRender((n) => n + 1);
        lastUpdate = t;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fpsCls = debugPerf.renderStutter > 0 ? 'text-red-400' : 'text-green-400';
  const ipcCls = debugPerf.ipcMaxGap > 25 ? 'text-red-400' : 'text-green-400';
  const glCls = debugPerf.glMs > 15 ? 'text-red-400' : 'text-green-400';
  const animCls = debugPerf.animateMs > 15 ? 'text-red-400' : 'text-green-400';

  return (
    <span
      className="flex items-center gap-1.5 text-[10px] font-mono whitespace-nowrap"
      title={`Render ${debugPerf.renderFps.toFixed(0)}fps stutter:${debugPerf.renderStutter} · IPC ${debugPerf.ipcFps.toFixed(0)}fps maxGap:${debugPerf.ipcMaxGap.toFixed(0)}ms · GL ${debugPerf.glMs.toFixed(1)}ms labels ${debugPerf.labelMs.toFixed(1)}ms anim ${debugPerf.animateMs.toFixed(1)}ms`}
    >
      <span className="text-gray-600">PERF</span>
      <span className={fpsCls}>{debugPerf.renderFps.toFixed(0)}fps</span>
      <span className={ipcCls} title="IPC position rate / max gap">ipc{debugPerf.ipcFps.toFixed(0)}·{debugPerf.ipcMaxGap.toFixed(0)}ms</span>
      <span className="text-cyan-400" title="positions / movements">p{debugPerf.posLen}·m{debugPerf.mvts}</span>
      <span className={glCls} title="GL frame / labels ms">gl{debugPerf.glMs.toFixed(1)}·lb{debugPerf.labelMs.toFixed(1)}</span>
      <span className={animCls} title="Animate ms">an{debugPerf.animateMs.toFixed(1)}</span>
    </span>
  );
};

interface ViewerStatusBarProps {
  // Span muté directement par les handlers pointer (coords monde du
  // curseur) — pas de re-render React à 60Hz pour une position lue.
  cursorReadoutRef: MutableRefObject<HTMLSpanElement | null>;
}

/**
 * Status bar dockée en bas de la surface 3D — footer permanent du
 * layout éditeur : hint contextuel (gauche), compteurs du document,
 * chips movements, inspect objet, coords curseur, perf (droite).
 */
export const ViewerStatusBar: React.FC<ViewerStatusBarProps> = ({ cursorReadoutRef }) => {
  const movements = useGraphStore((s) => s.movements);
  const selectedObjIndex = useGraphStore((s) => s.selectedObjIndex);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const drawMode = useGraphStore((s) => s.drawMode);
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const zonePlaceMode = useGraphStore((s) => s.zonePlaceMode);
  const zoneEditMode = useGraphStore((s) => s.zoneEditMode);
  const splineTool = useGraphStore((s) => s.splineTool);
  const drawView = useGraphStore((s) => s.drawView);
  const controlPoints = useGraphStore((s) => s.controlPoints);
  const cpSelection = useGraphStore((s) => s.cpSelection);
  const debugPerfVisible = useMoveEditorStore((s) => s.debugPerfVisible);
  const perfActive = debugPerfVisible && (debugPerf.mvts > 0 || debugPerf.renderFps > 0);

  // Hint contextuel — les gestes du mode actif, ou l'aide orbit au neutre.
  let hint = 'orbit: drag · zoom: scroll';
  if (drawMode) hint = drawToolHint(splineTool, drawView);
  else if (manipulateMode) hint = 'drag = move · Shift+click = multi-select · handle = move all · wheel = zoom/scale (Esc)';
  else if (assignMode) hint = 'click objects to toggle their track for this move (Esc)';
  else if (zonePlaceMode) hint = 'click on the floor to set the zone center (Esc)';
  else if (zoneEditMode) hint = 'drag a zone to move it · wheel over it = resize (Esc)';

  return (
    <div className="flex-shrink-0 flex items-center gap-2.5 px-1.5 py-0.5 bg-gray-900/95 border-t border-gray-700/60 min-h-[24px]">
      <span className="text-orange-400/90 text-[10px] font-medium truncate min-w-0 max-w-[38%]" title={hint}>
        {hint}
      </span>
      {drawMode && controlPoints.length > 0 && (
        <span className="text-gray-500 text-[10px] font-mono whitespace-nowrap">
          {controlPoints.length} cp{cpSelection.size > 0 && <span className="text-orange-400"> · {cpSelection.size} sel</span>}
        </span>
      )}
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
      <ModChips />
      <span className="flex-1" />
      {selectedObjIndex !== null && <ObjectInspectBar positions={emittedPositions} />}
      {/* Coords monde du curseur — span muté par les handlers pointer
          (pas de React state : les mousemove sont à 60Hz). */}
      <span ref={cursorReadoutRef} className="text-gray-500 text-[10px] font-mono whitespace-nowrap" />
      {perfActive && <PerfStrip />}
    </div>
  );
};

export default ViewerStatusBar;
