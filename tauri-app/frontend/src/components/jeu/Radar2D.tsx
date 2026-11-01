/// Radar 2D top-down (plan X/Y) — positions RÉELLEMENT émises colorées
/// par source-de-contrôle, auto-fit sur les bounds réels. Drag un objet
/// = grab & throw : la vélocité du geste devient la vélocité du lancer.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doThrow } from '../../utils/liveActions';

const SRC_FILL: Record<string, string> = {
  park: '#f59e0b',
  psn: '#a855f7',
  hold: '#22d3ee',
  manual: '#f97316',
  move: '#22c55e',
  track: '#6b7280',
};

export const Radar2D: React.FC = () => {
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const objectStates = useGraphStore((s) => s.objectStates);
  const throwDrag = React.useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  // Auto-fit : échelle sur les bounds réels (venues >10m ne sortent plus
  // du cadre).
  const maxR = Math.max(
    5,
    ...Object.values(emittedPositions).flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]),
  );
  const k = 100 / maxR;

  return (
    <svg
      viewBox="-110 -110 220 220"
      className="flex-1 min-h-0"
      preserveAspectRatio="xMidYMid meet"
      onPointerUp={(e) => {
        const drag = throwDrag.current;
        if (!drag) return;
        throwDrag.current = null;
        const rect = e.currentTarget.getBoundingClientRect();
        const dt = Math.max(0.05, (Date.now() - drag.t) / 1000);
        const scale = 220 / rect.width / k; // px → viewBox → mètres
        const vx = ((e.clientX - drag.x) * scale) / dt;
        const vy = (-(e.clientY - drag.y) * scale) / dt;
        if (Math.hypot(vx, vy) > 0.5) doThrow(drag.id, vx, vy, 0);
      }}
    >
      <circle cx="0" cy="0" r="105" fill="none" stroke="#1f2937" strokeWidth="1" />
      <circle cx="0" cy="0" r="52" fill="none" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="0" y1="-105" x2="0" y2="105" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="-105" y1="0" x2="105" y2="0" stroke="#1f2937" strokeWidth="0.5" />
      <text x="0" y="-99" fill="#4b5563" fontSize="8" textAnchor="middle">FRONT · {maxR.toFixed(0)}m</text>
      {Object.entries(emittedPositions).map(([id, [x, y]]) => {
        const t = Number(id);
        const src = objectStates[t] ?? 'track';
        const cx = Math.max(-105, Math.min(105, x * k));
        const cy = Math.max(-105, Math.min(105, y * k));
        return (
          <g
            key={id}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              throwDrag.current = { id: t, x: e.clientX, y: e.clientY, t: Date.now() };
              e.stopPropagation();
            }}
          >
            <circle cx={cx} cy={cy} r="4" fill={SRC_FILL[src] ?? '#6b7280'} />
            <text x={cx} y={cy - 7} fill="#9ca3af" fontSize="7" textAnchor="middle">{id}</text>
          </g>
        );
      })}
    </svg>
  );
};

export default Radar2D;
