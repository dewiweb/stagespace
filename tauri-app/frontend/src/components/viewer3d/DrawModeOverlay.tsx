import React from 'react';
import { Pencil, MousePointerClick, Spline, Undo2, Circle, Infinity as InfinityIcon, Minus, Trash2, Box } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import Slider from '../ui/Slider';
import { primCircle, primEllipse, primLemniscate, primLine, primArc, remapCps, type DrawView, type Vec3 } from '../../utils/splineCore';
import type { SplineTool } from '../../store/slices/drawModeSlice';

/**
 * Spline studio — overlay du mode Draw.
 * Outils : freehand (stroke→fit→edit) / place (clic = CP) / edit (drag CP,
 * clic-droit = delete, double-clic = insert). Primitives = jeux de CPs
 * initiaux. Done écrit `points`+`closed`+`tension` dans le node.
 */
export const DrawModeOverlay: React.FC = () => {
  const drawZ = useGraphStore((s) => s.drawZ);
  const setDrawZ = useGraphStore((s) => s.setDrawZ);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const splineTool = useGraphStore((s) => s.splineTool);
  const setSplineTool = useGraphStore((s) => s.setSplineTool);
  const drawView = useGraphStore((s) => s.drawView);
  const setDrawView = useGraphStore((s) => s.setDrawView);
  const controlPoints = useGraphStore((s) => s.controlPoints);
  const splineClosed = useGraphStore((s) => s.splineClosed);
  const setSplineClosed = useGraphStore((s) => s.setSplineClosed);
  const smoothing = useGraphStore((s) => s.smoothing);
  const setSmoothing = useGraphStore((s) => s.setSmoothing);
  const cpHistory = useGraphStore((s) => s.cpHistory);
  const cpUndo = useGraphStore((s) => s.cpUndo);
  const loadPrimitive = useGraphStore((s) => s.loadPrimitive);
  const clearSpline = useGraphStore((s) => s.clearSpline);

  const toolBtn = (tool: SplineTool, label: string, icon: React.ReactNode, title: string) => (
    <button
      key={tool}
      title={title}
      onClick={() => setSplineTool(tool)}
      className={`px-1.5 py-0.5 text-xs rounded font-medium flex items-center gap-1 ${
        splineTool === tool ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }`}
    >
      {icon}{label}
    </button>
  );

  // Primitives : générées dans le plan "top" puis remappées vers le plan
  // de la vue active — un cercle en vue Front est vertical.
  const primBtn = (label: string, icon: React.ReactNode, title: string, mk: () => Vec3[], closed: boolean) => (
    <button
      key={label}
      title={title}
      onClick={() => loadPrimitive(remapCps(mk(), drawView, drawZ), closed)}
      className="px-1.5 py-0.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 flex items-center gap-1"
    >
      {icon}{label}
    </button>
  );

  // Label du slider d'offset = axe normal au plan de la vue (backend Z-up).
  const offsetAxis: Record<DrawView, string> = { free: 'Z', top: 'Z', front: 'Y', side: 'X' };

  const viewBtn = (v: DrawView, label: string) => (
    <button
      key={v}
      title={`${label} view`}
      onClick={() => setDrawView(v)}
      className={`px-1.5 py-0.5 text-xs rounded font-medium ${
        drawView === v ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  );

  const toolHint: Record<SplineTool, string> = {
    freehand: 'Draw mode — click & drag; stroke becomes editable on release',
    place: 'Place mode — click to append control points',
    edit: 'Edit mode — drag CP · right-click CP deletes · double-click inserts',
  };

  return (
    <>
      {/* Barre studio */}
      <div className="absolute top-2 left-2 z-overlay bg-gray-900/80 backdrop-blur rounded-lg p-2 border border-orange-600/50 flex flex-col gap-1.5 max-w-[320px]">
        {/* Outils */}
        <div className="flex items-center gap-1 flex-wrap">
          {toolBtn('freehand', 'Draw', <Pencil size={11} />, 'Freehand stroke → fitted control points')}
          {toolBtn('place', 'Place', <MousePointerClick size={11} />, 'Click to place control points')}
          {toolBtn('edit', 'Edit', <Spline size={11} />, 'Drag / delete / insert control points')}
          <span className="w-px h-4 bg-gray-600 mx-0.5" />
          {primBtn('O', <Circle size={11} />, 'Circle primitive', () => primCircle(12, 1.5, drawZ), true)}
          {primBtn('8', <InfinityIcon size={11} />, 'Lemniscate (figure-8) primitive', () => primLemniscate(16, 1.6, drawZ), true)}
          {primBtn('—', <Minus size={11} />, 'Line primitive', () => primLine(-1.5, 0, 1.5, 0, drawZ), false)}
          {primBtn('◠', <Spline size={11} />, 'Arc primitive', () => primArc(5, 1.8, Math.PI * 0.8, drawZ), false)}
          {primBtn('⬭', <Circle size={11} />, 'Ellipse primitive', () => primEllipse(12, 2.0, 1.0, drawZ), true)}
        </div>
        {/* Vues fixées */}
        <div className="flex items-center gap-1 flex-wrap">
          <Box size={11} className="text-cyan-400" />
          {viewBtn('free', 'Free')}
          {viewBtn('top', 'Top')}
          {viewBtn('front', 'Front')}
          {viewBtn('side', 'Side')}
        </div>
        {/* Options */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={splineClosed}
              onChange={(e) => setSplineClosed(e.target.checked)}
              className="accent-orange-500"
            />
            Closed
          </label>
          <span className="text-orange-400 text-xs font-mono">{offsetAxis[drawView]}</span>
          <Slider
            layout="bare" min={-3} max={3} step={0.1} value={drawZ}
            onChange={setDrawZ} accent="orange" className="w-16"
          />
          <span className="text-white text-xs font-mono w-7">{drawZ.toFixed(1)}</span>
          <span className="text-cyan-400 text-xs font-mono">sm</span>
          <Slider
            layout="bare" min={0} max={1} step={0.05} value={smoothing}
            onChange={setSmoothing} accent="cyan" className="w-14"
          />
          <button
            title="Undo last edit"
            disabled={cpHistory.length === 0}
            onClick={cpUndo}
            className="p-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40"
          >
            <Undo2 size={11} />
          </button>
          <button
            title="Clear control points"
            onClick={clearSpline}
            className="p-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            <Trash2 size={11} />
          </button>
          <span className="text-gray-400 text-[10px] font-mono">{controlPoints.length} cp</span>
        </div>
        {/* Done / Cancel */}
        <div className="flex items-center gap-1.5">
          <button
            // Finalize AVANT de clearer — finalizeDrawing lit drawnPoints/CPs.
            // (finalizeDrawing sort déjà du drawMode en cas de succès)
            onClick={async () => { await finalizeDrawing(); clearDrawnPoints(); clearSpline(); setDrawMode(false); }}
            className="px-2 py-0.5 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded font-medium"
          >
            Done
          </button>
          <button
            onClick={() => { clearDrawnPoints(); clearSpline(); setDrawMode(false); }}
            className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
      {/* Instructions contextuelles */}
      <div className="absolute top-2 right-2 z-overlay bg-gray-900/80 backdrop-blur rounded-lg px-3 py-1.5 border border-orange-600/50">
        <span className="text-orange-400 text-xs font-medium">
          <Pencil size={11} className="inline -mt-0.5" /> {toolHint[splineTool]}
          {drawView !== 'free' && <span className="text-cyan-300"> — {drawView} view (rot locked)</span>}
        </span>
      </div>
    </>
  );
};
