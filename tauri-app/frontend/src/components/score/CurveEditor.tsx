/// Éditeur de courbe générique — keyframes {t, v} sur une fenêtre
/// [0, endMs] (relatif clip ou absolu lane globale). Clic vide = ajoute un
/// point, drag = déplace, clic droit = supprime. Interpolation
/// linéaire (smooth/bezier plus tard). Évaluée par le backend au play.
import React, { useRef } from 'react';
import type { ScoreKeyframe } from '../../store/useScoreStore';
import type { ParamDef } from './scoreParams';
import { useElementSize } from './useElementSize';

export const CurveEditor: React.FC<{
  kfs?: ScoreKeyframe[];
  endMs: number;
  param: ParamDef;
  onCurve: (kfs: ScoreKeyframe[] | undefined) => void;
}> = ({ kfs, endMs, param: p, onCurve }) => {
  const end = endMs;
  /// viewBox = pixels réels (mesurés) — preserveAspectRatio="none"
  /// sur un viewBox fixe étirait cercles et texte. Placeholder
  /// 600x100 tant que le ResizeObserver n'a pas mesuré (et en jsdom).
  const [wrapRef, measured] = useElementSize<HTMLDivElement>();
  const W = measured.width > 0 ? measured.width : 600;
  const H = measured.height > 0 ? measured.height : 100;
  const pad = 12;
  const spanX = Math.max(1, W - pad * 2);
  const spanY = Math.max(1, H - 16);
  const x = (t: number) => pad + (t / end) * spanX;
  const y = (v: number) => 8 + (1 - (v - p.min) / (p.max - p.min)) * spanY;
  const toCurve = (e: React.PointerEvent<SVGSVGElement>): ScoreKeyframe => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const t = Math.max(0, Math.min(end, Math.round(((px - pad) / spanX) * end / 50) * 50));
    const v = Math.max(p.min, Math.min(p.max, p.min + (1 - (py - 8) / spanY) * (p.max - p.min)));
    return { t, v: Math.round(v * 100) / 100 };
  };
  const dragRef = useRef<number | null>(null);
  return (
    <div ref={wrapRef} className="flex-1 min-h-0 min-w-0">
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="cursor-crosshair"
      onPointerDown={(e) => {
        // Clic sur le fond → nouveau keyframe (courbe vide → pose
        // aussi le point de départ à la valeur par défaut).
        if (e.button !== 0) return;
        const pt = toCurve(e);
        const next = kfs ? [...kfs] : [{ t: 0, v: p.def }];
        next.push(pt);
        onCurve(next);
      }}
      onPointerMove={(e) => {
        if (dragRef.current === null || !kfs) return;
        const pt = toCurve(e);
        const next = kfs.map((k, i) => (i === dragRef.current ? pt : k));
        onCurve(next);
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect x={x(0)} y={0} width={x(end) - x(0)} height={H} className="fill-stagespace-modulation/5" />
      {/* ligne de la valeur par défaut */}
      <line x1={x(0)} y1={y(p.def)} x2={x(end)} y2={y(p.def)} stroke="#6b7280" strokeDasharray="4 4" strokeOpacity={0.5} />
      <text x={x(0) + 2} y={y(p.def) - 2} className="fill-gray-500" fontSize="8">
        {p.def}
      </text>
      {/* Sans courbe : le param vaut `def` en continu — ligne plate
          à la valeur connue à l'insertion du clip (pas "vide"). */}
      {!kfs && (
        <line
          x1={x(0)} y1={y(p.def)} x2={x(end)} y2={y(p.def)}
          stroke="#67e8f9" strokeOpacity={0.4} strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {kfs ? (
        <>
          <polyline
            points={kfs.map((k) => `${x(k.t)},${y(k.v)}`).join(' ')}
            fill="none" stroke="#67e8f9" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          />
          {kfs.map((k, i) => (
            <circle
              key={i} cx={x(k.t)} cy={y(k.v)} r={5}
              className="fill-stagespace-modulation stroke-gray-900 cursor-grab"
              strokeWidth={1.5}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                dragRef.current = i;
                (e.target as Element).setPointerCapture(e.pointerId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = kfs.filter((_, j) => j !== i);
                onCurve(next.length ? next : undefined);
              }}
            />
          ))}
          <text x={x(end) - 60} y={H - 6} className="fill-stagespace-modulation" fontSize="9">
            {kfs[kfs.length - 1]?.v ?? p.def}
          </text>
        </>
      ) : (
        <text x={W / 2 - 110} y={H / 2} className="fill-gray-500" fontSize="10">
          clic pour poser un keyframe — {p.id}
        </text>
      )}
    </svg>
    </div>
  );
};
