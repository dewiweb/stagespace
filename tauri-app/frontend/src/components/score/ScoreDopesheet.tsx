/// Dopesheet — vue d'ensemble de TOUTE l'automation du score quand
/// rien n'est sélectionné : une rangée par courbe (lane ou clip) et
/// par lane d'événements, keyframes ◆ éditables (drag horizontal =
/// retime, vertical = valeur pour les courbes), events ◆ drag =
/// moveClip. Click ◆ = sélection du contexte + seek ; les labels
/// des rangées vivent dans la colonne PARAMÈTRES (paramGroups —
/// même ordre, `DopeRow.key` = `ParamRow.id`).
/// L'échelle est « fit-to-width » : toute la partition tient dans la
/// largeur disponible — c'est une vue d'ensemble, pas un zoom.
import React, { useRef } from 'react';
import type { DopeRow } from '../../utils/scoreDopesheet';
import { DOPE_ROW_H as ROW_H, DOPE_HEADER_H } from '../../utils/scoreDopesheet';
import type { ParamDef } from './scoreParams';
import type { ParamGroup } from './ScoreParamsPanel';
import { useElementSize } from './useElementSize';
const SNAP_MS = 50;

export const ScoreDopesheet: React.FC<{
  rows: DopeRow[];
  durationMs: number;
  displayCursor: number;
  loopStartMs?: number;
  loopEndMs?: number;
  /// ParamDef de la rangée — pour le drag vertical (valeur). Absent
  /// pour les rangées events.
  paramDefOf: (row: DopeRow) => ParamDef | undefined;
  /// Sélectionne la cible de la rangée (lane+param, clip+param ou lane).
  onSelectRow: (row: DopeRow) => void;
  onSeek: (ms: number) => void;
  /// Retime/valeur d'un keyframe de courbe (lane ou clip).
  onMoveKf: (row: DopeRow, kfIdx: number, t: number, v?: number) => void;
  /// Retime d'un clip événement.
  onMoveClip: (clipId: string, t: number) => void;
  /// Groupes de la colonne PARAMÈTRES — le plot reproduit leur
  /// structure (headers + rangées aux mêmes hauteurs) pour un
  /// alignement vertical strict. Absent : rangées à plat.
  groups?: ParamGroup[];
  /// Scroll vertical synchronisé avec la colonne PARAMÈTRES.
  scrollTop?: number;
  onVScroll?: (top: number) => void;
}> = ({
  rows, durationMs, displayCursor,
  loopStartMs, loopEndMs, paramDefOf, onSelectRow, onSeek, onMoveKf,
  onMoveClip, groups, scrollTop, onVScroll,
}) => {
  /// Échelle fit-to-width — mesurée sur le conteneur (toute la
  /// partition visible, jamais de scroll horizontal).
  const [plotRef, plotSize] = useElementSize<HTMLDivElement>();
  const fitW = Math.max(1, plotSize.width - 2);
  const ms2px = React.useCallback((ms: number) => (ms / Math.max(1, durationMs)) * fitW, [fitW, durationMs]);
  const px2ms = React.useCallback((px: number) => (px / fitW) * Math.max(1, durationMs), [fitW, durationMs]);
  /// Drag d'un ◆ : rangée + index du point + origines.
  const drag = useRef<{
    row: DopeRow; idx: number; moved: boolean;
    origT: number; origV: number; startX: number; startY: number;
  } | null>(null);
  /// État visuel pendant le drag — re-render léger par rangée.
  const [, bump] = React.useReducer((x: number) => x + 1, 0);

  // Sync scroll vertical — colonne PARAMÈTRES → plot.
  React.useEffect(() => {
    if (scrollTop !== undefined && plotRef.current && plotRef.current.scrollTop !== scrollTop)
      plotRef.current.scrollTop = scrollTop;
  }, [scrollTop, plotRef]);
  const onPlotScroll = (e: React.UIEvent<HTMLDivElement>) => {
    onVScroll?.(e.currentTarget.scrollTop);
  };

  /// Position verticale de chaque rangée — si `groups` est fourni le
  /// plot reproduit sa structure (bandeau header + rangées), sinon
  /// les rangées s'empilent à plat.
  const rowTopOf = React.useMemo(() => {
    const m = new Map<string, number>();
    let y = 0;
    if (groups) {
      for (const g of groups) {
        if (g.header) y += DOPE_HEADER_H;
        for (const r of g.rows) { m.set(r.id, y); y += ROW_H; }
      }
    } else {
      for (const r of rows) { m.set(r.key, y); y += ROW_H; }
    }
    return m;
  }, [groups, rows]);
  const contentH = groups
    ? groups.reduce((h, g) => h + (g.header ? DOPE_HEADER_H : 0) + g.rows.length * ROW_H, 0)
    : rows.length * ROW_H;

  const pointPos = (row: DopeRow, t: number, v: number | undefined) => {
    const def = paramDefOf(row);
    const y = def && v !== undefined
      ? ROW_H - 2 - ((v - def.min) / Math.max(1e-9, def.max - def.min)) * (ROW_H - 4)
      : ROW_H / 2;
    return { left: ms2px(t) - 4, top: y - 4 };
  };

  const startDrag = (e: React.PointerEvent, row: DopeRow, idx: number) => {
    if (e.button !== 0) return;
    const pt = row.points[idx];
    const def = paramDefOf(row);
    drag.current = {
      row, idx, moved: false,
      origT: pt.t, origV: pt.v ?? def?.def ?? 0,
      startX: e.clientX, startY: e.clientY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    const t = Math.max(0, Math.round((d.origT + px2ms(dx)) / SNAP_MS) * SNAP_MS);
    if (d.row.kind === 'events') {
      if (d.row.points[d.idx].clipId) onMoveClip(d.row.points[d.idx].clipId!, t);
    } else {
      const def = paramDefOf(d.row);
      const v = def
        ? Math.max(def.min, Math.min(def.max, d.origV - (dy / (ROW_H - 4)) * (def.max - def.min)))
        : undefined;
      onMoveKf(d.row, d.row.points[d.idx].kfIdx ?? d.idx, t, v);
    }
    bump();
  };
  const endDrag = (row: DopeRow, idx: number) => {
    const d = drag.current;
    drag.current = null;
    // Click (pas de drag) → sélection du contexte + seek au point.
    if (d && !d.moved) {
      onSelectRow(row);
      onSeek(row.points[idx].t);
    }
  };

  const fmtT = (t: number) => `${(t / 1000).toFixed(2)}s`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-1 min-h-0">
        {/* Plot — labels dans la colonne PARAMÈTRES (même ordre) ;
            échelle fit-to-width, scroll V sync avec la colonne */}
        <div ref={plotRef} className="flex-1 overflow-x-hidden overflow-y-auto" onScroll={onPlotScroll}>
          <div className="relative" style={{ width: '100%', height: Math.max(contentH, 1), minHeight: '100%' }}>
            {/* Région de boucle */}
            {loopStartMs != null && loopEndMs != null && loopEndMs > loopStartMs && (
              <div className="absolute top-0 bottom-0 bg-cyan-500/5 border-x border-cyan-500/20 pointer-events-none"
                style={{ left: ms2px(loopStartMs), width: ms2px(loopEndMs - loopStartMs) }} />
            )}
            {/* Rangées — top calculé depuis la structure des groupes
                pour l'alignement pixel avec la colonne PARAMÈTRES */}
            {rows.map((r) => {
              const def = paramDefOf(r);
              return (
                <div key={r.key} className="absolute left-0 right-0 border-b border-gray-800/40" style={{ top: rowTopOf.get(r.key) ?? 0, height: ROW_H }}>
                  {r.points.map((pt, i) => {
                    const { left, top } = pointPos(r, pt.t, pt.v);
                    return (
                      <div
                        key={i}
                        className={`absolute w-2 h-2 rotate-45 cursor-ew-resize border ${
                          r.kind === 'events'
                            ? 'bg-amber-500/80 border-amber-300'
                            : 'bg-cyan-500/80 border-cyan-300'
                        }`}
                        style={{ left, top }}
                        title={
                          r.kind === 'events'
                            ? `${fmtT(pt.t)} — drag = déplacer le clip`
                            : `${fmtT(pt.t)} v=${(pt.v ?? def?.def ?? 0).toFixed(2)} — drag = retime/valeur`
                        }
                        onPointerDown={(e) => startDrag(e, r, i)}
                        onPointerMove={moveDrag}
                        onPointerUp={() => endDrag(r, i)}
                      />
                    );
                  })}
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="px-2 py-3 text-[10px] text-gray-600 italic">
                Aucune automation — les courbes de lanes et les événements
                apparaîtront ici, une rangée par paramètre.
              </div>
            )}
            {/* Playhead — même curseur que la timeline */}
            <div className="absolute top-0 bottom-0 w-px bg-cyan-400 pointer-events-none"
              style={{ left: ms2px(displayCursor) }} />
          </div>
        </div>
      </div>
    </div>
  );
};
