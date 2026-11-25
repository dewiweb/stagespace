import React from 'react';
import { MousePointerClick, Spline, Undo2, Circle, Infinity as InfinityIcon, Minus, Trash2, FolderOpen, RefreshCw, PencilLine } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { primCircle, primEllipse, primLemniscate, primLine, primArc, remapCps, type DrawView, type Vec3 } from '../../utils/splineCore';
import type { SplineTool } from '../../store/slices/drawModeSlice';
import { tbAction, tbIcon, tbSep } from './toolbarStyles';

/**
 * Contrôles du spline studio — répartis selon le layout éditeur :
 * - `DrawPaletteTools` : colonne verticale (ViewerToolPalette) — outils
 *   de création/édition, primitives, undo/clear, toggle closed.
 * - `DrawMenuBar` : barre horizontale (ViewerToolbar) — contexte document :
 *   sélecteur de node, reload, Done/Cancel. Les vues de travail vivent
 *   dans `ViewButtons` (ViewerToolbar) — utiles dans tous les modes.
 * - `drawToolHint` : hint contextuel affiché dans la status bar.
 */

/** Bouton carré de palette — même langage que tbBtn mais vertical. */
const palBtn = (active: boolean) =>
  `w-7 h-7 flex items-center justify-center rounded transition-colors ${
    active ? 'bg-stagespace-accent text-gray-950' : 'text-gray-400 hover:bg-gray-700/70 hover:text-gray-200'
  }`;

export const DrawPaletteTools: React.FC = () => {
  const splineTool = useGraphStore((s) => s.splineTool);
  const setSplineTool = useGraphStore((s) => s.setSplineTool);
  const drawView = useGraphStore((s) => s.drawView);
  const loadPrimitive = useGraphStore((s) => s.loadPrimitive);
  const splineClosed = useGraphStore((s) => s.splineClosed);
  const setSplineClosed = useGraphStore((s) => s.setSplineClosed);
  const cpHistory = useGraphStore((s) => s.cpHistory);
  const cpUndo = useGraphStore((s) => s.cpUndo);
  const clearSpline = useGraphStore((s) => s.clearSpline);

  const toolBtn = (tool: SplineTool, icon: React.ReactNode, title: string) => (
    <button key={tool} title={title} onClick={() => setSplineTool(tool)} className={palBtn(splineTool === tool)}>
      {icon}
    </button>
  );

  // Primitives : générées dans le plan "top" puis remappées vers le plan
  // de la vue active — un cercle en vue Front est vertical.
  const primBtn = (icon: React.ReactNode, title: string, mk: () => Vec3[], closed: boolean) => (
    <button key={title} title={title} onClick={() => loadPrimitive(remapCps(mk(), drawView, 0), closed)} className={palBtn(false)}>
      {icon}
    </button>
  );

  return (
    <>
      <div className="h-px mx-1.5 bg-gray-700/70" />
      {toolBtn('freehand', <PencilLine size={13} />, 'Draw — freehand stroke → fitted control points')}
      {toolBtn('place', <MousePointerClick size={13} />, 'Place — click to append control points')}
      {toolBtn('edit', <Spline size={13} />, 'Edit — drag/marquee-select control points, right-click deletes, double-click inserts')}
      <div className="h-px mx-1.5 bg-gray-700/70" />
      {primBtn(<Circle size={13} />, 'Circle primitive', () => primCircle(12, 1.5, 0), true)}
      {primBtn(<InfinityIcon size={13} />, 'Lemniscate (figure-8) primitive', () => primLemniscate(16, 1.6, 0), true)}
      {primBtn(<Minus size={13} />, 'Line primitive', () => primLine(-1.5, 0, 1.5, 0, 0), false)}
      {primBtn(<Spline size={13} />, 'Arc primitive', () => primArc(5, 1.8, Math.PI * 0.8, 0), false)}
      {primBtn(<Circle size={13} />, 'Ellipse primitive', () => primEllipse(12, 2.0, 1.0, 0), true)}
      <div className="h-px mx-1.5 bg-gray-700/70" />
      <button
        title="Closed spline (loop)"
        onClick={() => setSplineClosed(!splineClosed)}
        className={palBtn(splineClosed)}
      >
        <RefreshCw size={13} />
      </button>
      <button title="Undo last edit" disabled={cpHistory.length === 0} onClick={cpUndo} className={`${palBtn(false)} disabled:opacity-30`}>
        <Undo2 size={13} />
      </button>
      <button title="Clear control points" onClick={clearSpline} className={palBtn(false)}>
        <Trash2 size={13} />
      </button>
    </>
  );
};

export const DrawMenuBar: React.FC = () => {
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
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

  return (
    <>
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
      <span className={tbSep} />
      <span className="flex-1" />
      <button
        // Finalize AVANT de clearer — finalizeDrawing lit drawnPoints/CPs.
        // (finalizeDrawing sort déjà du drawMode en cas de succès)
        onClick={async () => { await finalizeDrawing(); clearDrawnPoints(); clearSpline(); setDrawMode(false); }}
        className={`${tbAction} bg-stagespace-accent hover:opacity-90 text-gray-950`}
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

/** Hint contextuel par outil — affiché dans la status bar. */
export function drawToolHint(tool: SplineTool, view: DrawView): string {
  const base: Record<SplineTool, string> = {
    freehand: 'click & drag; stroke becomes editable on release',
    place: 'click to append control points',
    edit: 'drag CP = move selection · drag empty = marquee · Shift+click = toggle · right-click deletes · double-click inserts',
  };
  return base[tool] + (view !== 'free' ? ` — ${view} view (rot locked)` : '');
}
