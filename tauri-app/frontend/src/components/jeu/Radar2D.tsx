/// Radar 2D top-down (plan X/Y) — positions RÉELLEMENT émises colorées
/// par source-de-contrôle, auto-fit sur les bounds réels. Drag un objet
/// = grab & throw : la vélocité du geste devient la vélocité du lancer.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doThrow, doClearPosition } from '../../utils/liveActions';
import { sourceHex, SOURCE_LABEL } from '../../utils/sourceColors';

export const Radar2D: React.FC = () => {
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const throwDrag = React.useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  // Positions LIVE : l'event backend 'global-positions' remplit
  // movementPositions['global'] à 60fps. emittedPositions n'est qu'un
  // fallback — elle n'est refreshée qu'à 1.5Hz par pollLive (vue de
  // confiance, pas du temps réel). Intervalle ~25fps plutôt qu'un
  // abonnement React : même raisonnement que le render loop 3D.
  const [livePositions, setLivePositions] = React.useState<Record<number, [number, number, number]>>({});
  React.useEffect(() => {
    const t = setInterval(() => {
      const g = useGraphStore.getState().movementPositions?.['global'];
      if (!g?.length) return;
      const m: Record<number, [number, number, number]> = {};
      for (const p of g) m[p.index] = [p.x, p.y, p.z];
      setLivePositions(m);
    }, 40);
    return () => clearInterval(t);
  }, []);
  const positions = Object.keys(livePositions).length > 0 ? livePositions : emittedPositions;

  // Auto-fit : échelle sur les bounds réels (venues >10m ne sortent plus
  // du cadre).
  const maxR = Math.max(
    5,
    ...Object.values(positions).flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]),
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
      {Object.entries(positions).map(([id, [x, y]]) => {
        const t = Number(id);
        const src = objectStates[t] ?? 'track';
        const cx = Math.max(-105, Math.min(105, x * k));
        const cy = Math.max(-105, Math.min(105, y * k));
        return (
          <g
            key={id}
            style={{ cursor: 'grab' }}
            onContextMenu={(e) => {
              // Clic-droit = relâcher l'objet tenu en manuel : le moteur
              // reprend la main (la position manuelle a priorité au merge —
              // un objet dragué resterait figé sans ce chemin de release).
              e.preventDefault();
              e.stopPropagation();
              doClearPosition(t);
            }}
            onPointerDown={(e) => {
              throwDrag.current = { id: t, x: e.clientX, y: e.clientY, t: Date.now() };
              e.stopPropagation();
            }}
          >
            <circle cx={cx} cy={cy} r="4" fill={sourceHex(src)}>
              <title>{id} · {SOURCE_LABEL[src] ?? src}</title>
            </circle>
            <text x={cx} y={cy - 7} fill="#9ca3af" fontSize="7" textAnchor="middle">
              {/* track_id (même numérotation que les pads et la 3D) — pas obj_index */}
              {manualOscIds[t] ?? t + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default Radar2D;
