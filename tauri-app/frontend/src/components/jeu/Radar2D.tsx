/// Radar 2D top-down (plan X/Y) — positions RÉELLEMENT émises colorées
/// par source-de-contrôle, auto-fit sur les bounds réels. Drag un objet
/// = grab & throw : la vélocité du geste devient la vélocité du lancer.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doThrow, doClearPosition, doPark, doUnpark, doAttention } from '../../utils/liveActions';
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
  const selectedObj = useGraphStore((s) => s.selectedObjIndex);
  const setSelectedObj = useGraphStore((s) => s.setSelectedObjIndex);

  // Inspect de l'objet sélectionné — sans lui le clic-proximité ne
  // produisait qu'un anneau sans effet (state mort). Une ligne d'info +
  // actions sous le radar : release selon l'état, park/unpark.
  const selSrc = selectedObj != null ? (objectStates[selectedObj] ?? 'track') : null;
  const selPos = selectedObj != null ? positions[selectedObj] : undefined;
  const selTrackId = selectedObj != null ? (manualOscIds[selectedObj] ?? selectedObj + 1) : null;
  const OVERRIDE_RELEASE: Record<string, (i: number) => void> = {
    manual: doClearPosition, hold: doClearPosition,
    park: doUnpark, freeze: () => doAttention(null),
  };

  // Auto-fit : échelle sur les bounds réels (venues >10m ne sortent plus
  // du cadre).
  const maxR = Math.max(
    5,
    ...Object.values(positions).flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]),
  );
  const k = 100 / maxR;

  return (
    <>
    <svg
      viewBox="-110 -110 220 220"
      className="flex-1 min-h-0"
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={(e) => {
        // Sélection par proximité : un objet en mouvement est dur à viser —
        // on prend le plus proche du clic dans un seuil de ~18 unités
        // viewBox (≈15px écran). Le ring suit l'objet par index — stable
        // quelles que soient ses positions.
        const rect = e.currentTarget.getBoundingClientRect();
        const vx = ((e.clientX - rect.left) / rect.width) * 220 - 110;
        const vy = ((e.clientY - rect.top) / rect.height) * 220 - 110;
        let best = -1;
        let bd = 18;
        for (const [id, [x, y]] of Object.entries(positions)) {
          const d = Math.hypot(x * k - vx, y * k - vy);
          if (d < bd) { bd = d; best = Number(id); }
        }
        setSelectedObj(best >= 0 ? best : null);
      }}
      onPointerUp={(e) => {
        const drag = throwDrag.current;
        if (!drag) return;
        throwDrag.current = null;
        const rect = e.currentTarget.getBoundingClientRect();
        const dt = Math.max(0.05, (Date.now() - drag.t) / 1000);
        const scale = 220 / rect.width / k; // px → viewBox → mètres
        const vx = ((e.clientX - drag.x) * scale) / dt;
        // cy = worldY*k — le +y monde rend vers le BAS de l'écran (FRONT
        // en haut = -y). Drag vers le haut (dy<0) → vy<0 : PAS de négation.
        const vy = ((e.clientY - drag.y) * scale) / dt;
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
        const isManual = src === 'manual';
        const isSelected = selectedObj === t;
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
              if (e.ctrlKey) {
                // Ctrl+clic = relâcher l'objet tenu en manuel (clic-droit
                // = menu natif webview ; Alt+clic = move-fenêtre du WM).
                e.stopPropagation();
                doClearPosition(t);
                return;
              }
              throwDrag.current = { id: t, x: e.clientX, y: e.clientY, t: Date.now() };
              e.stopPropagation();
            }}
          >
            {isSelected && (
              <circle cx={cx} cy={cy} r={8} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.9" />
            )}
            <circle cx={cx} cy={cy} r="4" fill={sourceHex(src)}>
              <title>{id} · {SOURCE_LABEL[src] ?? src}</title>
              {isManual && (
                <text
                  x={12}
                  y={-8}
                  fill="#f97316"
                  fontSize="11"
                  fontWeight="bold"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                        doClearPosition(t);
                  }}
                >
                  ×
                </text>
              )}
            </circle>
            <text x={cx} y={cy - 7} fill="#9ca3af" fontSize="7" textAnchor="middle">
              {/* track_id (même numérotation que les pads et la 3D) — pas obj_index */}
              {manualOscIds[t] ?? t + 1}
            </text>
          </g>
        );
      })}
    </svg>
    {selectedObj != null && selSrc && (
      <div className="mt-1 px-1.5 py-1 rounded bg-gray-800/80 border border-gray-700 text-[10px] flex items-center gap-1.5 flex-shrink-0">
        <span className="text-white font-bold">#{selTrackId}</span>
        <span
          className="px-1 rounded font-semibold"
          style={{ backgroundColor: sourceHex(selSrc) + '33', color: sourceHex(selSrc) }}
        >
          {SOURCE_LABEL[selSrc] ?? selSrc}
        </span>
        {selPos && (
          <span className="text-gray-500 font-mono">
            {selPos[0].toFixed(1)},{selPos[1].toFixed(1)}
          </span>
        )}
        <span className="flex-1" />
        {OVERRIDE_RELEASE[selSrc] && (
          <button
            onClick={() => OVERRIDE_RELEASE[selSrc](selectedObj)}
            className="px-1.5 py-0.5 rounded bg-orange-900/70 text-orange-200 hover:bg-orange-600 text-[10px] font-bold"
            title={`Release obj ${selectedObj} (${selSrc}) — le moteur reprend`}
          >
            release
          </button>
        )}
        <button
          onClick={() => (selSrc === 'park' ? doUnpark(selectedObj) : doPark(selectedObj))}
          className="px-1.5 py-0.5 rounded bg-cyan-900/70 text-cyan-200 hover:bg-cyan-700 text-[10px] font-bold"
          title={selSrc === 'park' ? 'Unpark — l\'objet rejoint recalls/stop' : 'Park — gèle l\'objet hors recalls/stop/panic'}
        >
          {selSrc === 'park' ? 'unpark' : 'park'}
        </button>
        <button
          onClick={() => setSelectedObj(null)}
          className="px-1 text-gray-500 hover:text-white"
          title="Désélectionner"
        >
          ×
        </button>
      </div>
    )}
    </>
  );
};

export default Radar2D;
