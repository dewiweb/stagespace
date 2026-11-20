import React from 'react';
import { Pencil, MousePointerClick, Spline, Undo2, Circle, Infinity as InfinityIcon, Minus, Trash2, Box, FolderOpen } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { primCircle, primEllipse, primLemniscate, primLine, primArc, remapCps, type DrawView, type Vec3 } from '../../utils/splineCore';
import type { SplineTool } from '../../store/slices/drawModeSlice';
import { tbGroup, tbBtn, tbAction, tbIcon, tbSep, tbIdle } from './toolbarStyles';

/**
 * Outils du spline studio — rendu INLINE dans la ViewerToolbar (plus
 * d'overlay flottant sur la scène). Deux lignes : `DrawToolbarTools`
 * (outils + primitives + Done/Cancel) et `DrawToolbarOptions` (vues +
 * options + undo/load/clear + compteur).
 */
export const DrawToolbarTools: React.FC = () => {
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const splineTool = useGraphStore((s) => s.splineTool);
  const setSplineTool = useGraphStore((s) => s.setSplineTool);
  const drawView = useGraphStore((s) => s.drawView);
  const loadPrimitive = useGraphStore((s) => s.loadPrimitive);
  const clearSpline = useGraphStore((s) => s.clearSpline);

  const toolBtn = (tool: SplineTool, label: string, icon: React.ReactNode, title: string) => (
    <button
      key={tool}
      title={`${label} — ${title}`}
      onClick={() => setSplineTool(tool)}
      className={`${tbBtn} ${splineTool === tool ? 'bg-orange-600 text-white' : tbIdle}`}
    >
      {icon}
    </button>
  );

  // Primitives : générées dans le plan "top" puis remappées vers le plan
  // de la vue active — un cercle en vue Front est vertical.
  const primBtn = (label: string, icon: React.ReactNode, title: string, mk: () => Vec3[], closed: boolean) => (
    <button
      key={label}
      title={title}
      onClick={() => loadPrimitive(remapCps(mk(), drawView, 0), closed)}
      className={`${tbBtn} ${tbIdle}`}
    >
      {icon}{label}
    </button>
  );

  return (
    <>
      <div className={tbGroup}>
        {toolBtn('freehand', 'Draw', <Pencil size={11} />, 'Freehand stroke → fitted control points')}
        {toolBtn('place', 'Place', <MousePointerClick size={11} />, 'Click to place control points')}
        {toolBtn('edit', 'Edit', <Spline size={11} />, 'Drag / delete / insert control points')}
      </div>
      <div className={tbGroup}>
        {primBtn('O', <Circle size={11} />, 'Circle primitive', () => primCircle(12, 1.5, 0), true)}
        {primBtn('8', <InfinityIcon size={11} />, 'Lemniscate (figure-8) primitive', () => primLemniscate(16, 1.6, 0), true)}
        {primBtn('—', <Minus size={11} />, 'Line primitive', () => primLine(-1.5, 0, 1.5, 0, 0), false)}
        {primBtn('◠', <Spline size={11} />, 'Arc primitive', () => primArc(5, 1.8, Math.PI * 0.8, 0), false)}
        {primBtn('⬭', <Circle size={11} />, 'Ellipse primitive', () => primEllipse(12, 2.0, 1.0, 0), true)}
      </div>
      <button
        // Finalize AVANT de clearer — finalizeDrawing lit drawnPoints/CPs.
        // (finalizeDrawing sort déjà du drawMode en cas de succès)
        onClick={async () => { await finalizeDrawing(); clearDrawnPoints(); clearSpline(); setDrawMode(false); }}
        className={`${tbAction} bg-orange-600 hover:bg-orange-700 text-white`}
      >
        Done
      </button>
      <button
        onClick={() => { clearDrawnPoints(); clearSpline(); setDrawMode(false); }}
        className={`${tbAction} bg-gray-800/70 border border-gray-700/70 hover:bg-gray-700 text-gray-300`}
      >
        Cancel
      </button>
    </>
  );
};

export const DrawToolbarOptions: React.FC = () => {
  const drawView = useGraphStore((s) => s.drawView);
  const setDrawView = useGraphStore((s) => s.setDrawView);
  const controlPoints = useGraphStore((s) => s.controlPoints);
  const cpSelection = useGraphStore((s) => s.cpSelection);
  const splineClosed = useGraphStore((s) => s.splineClosed);
  const setSplineClosed = useGraphStore((s) => s.setSplineClosed);
  const cpHistory = useGraphStore((s) => s.cpHistory);
  const cpUndo = useGraphStore((s) => s.cpUndo);
  const loadFromNode = useGraphStore((s) => s.loadFromNode);
  const clearSpline = useGraphStore((s) => s.clearSpline);
  // ATTENTION : filter() dans le sélecteur = nouveau tableau à chaque
  // appel → snapshot jamais stable → boucle de re-render infinie. On
  // souscrit la référence nodes (stable) puis on mémoise le filtre.
  const nodes = useGraphStore((s) => s.nodes);
  const drawSplineNodes = React.useMemo(
    () => nodes.filter((n) => n.data.type === 'DrawSpline'),
    [nodes],
  );
  const loadedSplineNodeId = useGraphStore((s) => s.loadedSplineNodeId);

  const viewBtn = (v: DrawView, label: string) => (
    <button
      key={v}
      title={`${label} view`}
      onClick={() => setDrawView(v)}
      className={`${tbBtn} ${drawView === v ? 'bg-cyan-600 text-white' : tbIdle}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className={tbGroup}>
        <span className="h-6 px-1.5 flex items-center text-cyan-400" title="Working plane"><Box size={11} /></span>
        {viewBtn('free', 'Free')}
        {viewBtn('top', 'Top')}
        {viewBtn('front', 'Front')}
        {viewBtn('side', 'Side')}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-gray-300 cursor-pointer h-6">
        <input
          type="checkbox"
          checked={splineClosed}
          onChange={(e) => setSplineClosed(e.target.checked)}
          className="accent-orange-500"
        />
        Closed
      </label>
      <span className={tbSep} />
      <button title="Undo last edit" disabled={cpHistory.length === 0} onClick={cpUndo} className={tbIcon}>
        <Undo2 size={11} />
      </button>
      <button title="Clear control points" onClick={clearSpline} className={tbIcon}>
        <Trash2 size={11} />
      </button>
      {drawSplineNodes.length > 1 && (
        <select
          title="DrawSpline node to edit"
          value={loadedSplineNodeId ?? ''}
          onChange={(e) => e.target.value && loadFromNode(e.target.value)}
          className="h-6 text-[11px] bg-gray-800 border border-gray-700 rounded px-1 text-gray-200 max-w-[90px]"
        >
          {loadedSplineNodeId === null && <option value="" disabled>spline…</option>}
          {drawSplineNodes.map((n) => (
            <option key={n.id} value={n.id}>{String(n.data.label ?? n.id)}</option>
          ))}
        </select>
      )}
      <button
        title="Reload control points from the DrawSpline node (discards local edits)"
        disabled={drawSplineNodes.length === 0}
        onClick={() => loadFromNode(loadedSplineNodeId ?? undefined)}
        className={tbIcon}
      >
        <FolderOpen size={11} />
      </button>
      <span className="text-gray-500 text-[10px] font-mono whitespace-nowrap">
        {controlPoints.length} cp{cpSelection.size > 0 && <span className="text-orange-400"> · {cpSelection.size} sel</span>}
      </span>
    </>
  );
};

/** Hint contextuel par outil — affiché à droite de la toolbar. */
export function drawToolHint(tool: SplineTool, view: DrawView): string {
  const base: Record<SplineTool, string> = {
    freehand: 'click & drag; stroke becomes editable on release',
    place: 'click to append control points',
    edit: 'drag CP = move selection · drag empty = marquee · Shift+click = toggle · right-click deletes · double-click inserts',
  };
  return base[tool] + (view !== 'free' ? ` — ${view} view (rot locked)` : '');
}
