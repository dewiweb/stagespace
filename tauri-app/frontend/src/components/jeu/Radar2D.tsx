/// Radar 2D top-down (plan X/Y) — positions MERGÉES live colorées par
/// source-de-contrôle (fallback emittedPositions = réellement envoyées),
/// auto-fit amorti sur les bounds réels. Drag un objet = grab & throw :
/// la vélocité du flick (~200ms) devient la vélocité du lancer.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doThrow, doClearPosition } from '../../utils/liveActions';
import { sourceHex, SOURCE_LABEL, SOURCE_HEX } from '../../utils/sourceColors';
import { ObjectInspectBar } from '../viewer3d/ObjectInspectBar';
import type { Zone } from '../../store/slices/spatialFxSlice';

/// Empreinte top-down d'une zone en coords monde (x, y) — bounds utilisés
/// par l'auto-fit du radar (une zone lointaine ne doit pas clipper).
function zoneBounds(z: Zone): number[] {
  if (z.shape.shape === 'sphere') {
    const r = z.shape.radius + z.falloff;
    return [Math.abs(z.shape.center[0]) + r, Math.abs(z.shape.center[1]) + r];
  }
  const f = z.falloff;
  return [
    Math.max(Math.abs(z.shape.min[0]), Math.abs(z.shape.max[0])) + f,
    Math.max(Math.abs(z.shape.min[1]), Math.abs(z.shape.max[1])) + f,
  ];
}

export const Radar2D: React.FC = () => {
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  // Trail des derniers échantillons du geste — la vélocité de lancer se
  // calcule sur la fenêtre ~200ms (flick), pas sur le déplacement total :
  // tenir l'objet avant de relâcher ne doit pas tuer la vélocité.
  const throwDrag = React.useRef<{
    id: number;
    x: number;
    y: number;
    t: number;
    trail: { x: number; y: number; t: number }[];
  } | null>(null);

  // Positions LIVE : l'event backend 'global-positions' remplit
  // movementPositions['global'] à 60fps. emittedPositions n'est qu'un
  // fallback — elle n'est refreshée qu'à 1.5Hz par pollLive (vue de
  // confiance, pas du temps réel). Intervalle ~25fps plutôt qu'un
  // abonnement React : même raisonnement que le render loop 3D.
  const [livePositions, setLivePositions] = React.useState<Record<number, [number, number, number]>>({});
  React.useEffect(() => {
    const t = setInterval(() => {
      const g = useGraphStore.getState().movementPositions?.['global'];
      if (!g?.length) {
        // Flux arrêté (stop-all / panic) — ne pas figer le radar sur le
        // dernier frame : vider → fallback emittedPositions (état réel).
        setLivePositions((prev) => (Object.keys(prev).length ? {} : prev));
        return;
      }
      const m: Record<number, [number, number, number]> = {};
      for (const p of g) m[p.index] = [p.x, p.y, p.z];
      setLivePositions(m);
    }, 40);
    return () => clearInterval(t);
  }, []);
  const positions = Object.keys(livePositions).length > 0 ? livePositions : emittedPositions;
  const selectedObj = useGraphStore((s) => s.selectedObjIndex);
  const setSelectedObj = useGraphStore((s) => s.setSelectedObjIndex);
  const zones = useGraphStore((s) => s.zones);
  const graphZones = useGraphStore((s) => s.graphZones);

  // Auto-fit : échelle sur les bounds réels, AVEC hystérésis — un objet
  // lancé loin ne rescale pas la vue d'un coup : zoom-out immédiat (on
  // doit voir l'objet), zoom-in amorti (la vue revient doucement).
  const maxRef = React.useRef(5);
  const targetR = Math.max(
    5,
    ...Object.values(positions).flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]),
    // Les zones incluent leur empreinte dans le fit — sinon une zone
    // lointaine clipperait hors cadre.
    ...zones.flatMap((z) => zoneBounds(z)),
    ...graphZones.flatMap((z) => zoneBounds(z)),
  );
  maxRef.current = targetR > maxRef.current
    ? targetR
    : maxRef.current + (targetR - maxRef.current) * 0.08;
  const maxR = maxRef.current;
  const k = 100 / maxR;

  // Inspect de l'objet sélectionné — délégué à ObjectInspectBar (partagé
  // avec le viewer 3D) : état source + position + release/park.
  // Position écran du drag-throw courant — la flèche montre la direction
  // et la longueur du flick pendant le geste (feedback : le lancer était
  // invisible avant).
  const [throwCursor, setThrowCursor] = React.useState<{ x: number; y: number } | null>(null);

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
      onPointerMove={(e) => {
        const drag = throwDrag.current;
        if (!drag) return;
        drag.trail.push({ x: e.clientX, y: e.clientY, t: Date.now() });
        if (drag.trail.length > 12) drag.trail.shift();
        // Position du curseur en viewBox pour la flèche de lancer.
        const rect = e.currentTarget.getBoundingClientRect();
        setThrowCursor({
          x: ((e.clientX - rect.left) / rect.width) * 220 - 110,
          y: ((e.clientY - rect.top) / rect.height) * 220 - 110,
        });
      }}
      onPointerUp={(e) => {
        const drag = throwDrag.current;
        if (!drag) return;
        throwDrag.current = null;
        setThrowCursor(null);
        const rect = e.currentTarget.getBoundingClientRect();
        const totalDt = (Date.now() - drag.t) / 1000;
        const totalDx = e.clientX - drag.x;
        const totalDy = e.clientY - drag.y;
        // Tap (<6px, <0.5s) sur l'objet = SÉLECTION — avant, le <g>
        // interceptait tout pointerdown et un clic direct ne sélectionnait
        // jamais (il fallait viser à côté). Tap = select, fling = throw.
        if (Math.hypot(totalDx, totalDy) < 6 && totalDt < 0.5) {
          setSelectedObj(drag.id);
          return;
        }
        // Vélocité = fenêtre trailing ~200ms du geste (flick), pas la
        // durée totale du press — tenir avant de lâcher ne tue pas le lancer.
        const now = Date.now();
        const recent = drag.trail.filter((s) => now - s.t < 200);
        const from = recent.length > 0 ? recent[0] : { x: drag.x, y: drag.y, t: drag.t };
        const dt = Math.max(0.05, (now - from.t) / 1000);
        const scale = 220 / rect.width / k; // px → viewBox → mètres
        const vx = ((e.clientX - from.x) * scale) / dt;
        // cy = worldY*k — le +y monde rend vers le BAS de l'écran (FRONT
        // en haut = -y). Drag vers le haut (dy<0) → vy<0 : PAS de négation.
        const vy = ((e.clientY - from.y) * scale) / dt;
        if (Math.hypot(vx, vy) > 0.5) doThrow(drag.id, vx, vy, 0);
      }}
      onContextMenu={(e) => {
        // Clic-droit proximité — comme le 3D : relâcher l'objet le plus
        // proche sans viser le cercle r=4 en mouvement. Le handler du <g>
        // fait le release précis ; celui-ci est le fallback large.
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const vx = ((e.clientX - rect.left) / rect.width) * 220 - 110;
        const vy = ((e.clientY - rect.top) / rect.height) * 220 - 110;
        let best = -1;
        let bd = 18;
        for (const [id, [x, y]] of Object.entries(positions)) {
          const d = Math.hypot(x * k - vx, y * k - vy);
          if (d < bd) { bd = d; best = Number(id); }
        }
        if (best >= 0) doClearPosition(best);
      }}
    >
      <circle cx="0" cy="0" r="105" fill="none" stroke="#1f2937" strokeWidth="1" />
      <circle cx="0" cy="0" r="52" fill="none" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="0" y1="-105" x2="0" y2="105" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="-105" y1="0" x2="105" y2="0" stroke="#1f2937" strokeWidth="0.5" />
      <text x="0" y="-99" fill="#4b5563" fontSize="8" textAnchor="middle">FRONT · {maxR.toFixed(0)}m</text>
      {/* Empreintes des zones — cyan manuelles, violet graph-déclarées.
          Plein = noyau (influence 1), pointillé = falloff externe.
          Les zones à effet positionnel (repel/vortex…) reçoivent un
          contour renforcé — elles DÉPLACENT les objets maintenant. */}
      {[
        ...graphZones.map((z) => ({ z, color: '#8b5cf6' })),
        ...zones.map((z) => ({ z, color: '#22d3ee' })),
      ].map(({ z, color }, zi) => {
        if (!z.enabled) return null;
        const strokeW = z.effect ? 1.6 : 0.7;
        const dash = z.effect ? 'none' : '3 2';
        if (z.shape.shape === 'sphere') {
          const cx = z.shape.center[0] * k;
          const cy = z.shape.center[1] * k;
          const r = z.shape.radius * k;
          const rf = (z.shape.radius + z.falloff) * k;
          return (
            <g key={`z${zi}`} pointerEvents="none">
              <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.05} stroke={color} strokeOpacity={0.5} strokeWidth={strokeW} strokeDasharray={dash} />
              {z.falloff > 0 && (
                <circle cx={cx} cy={cy} r={rf} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={0.5} strokeDasharray="3 3" />
              )}
            </g>
          );
        }
        const w = (z.shape.max[0] - z.shape.min[0]) * k;
        const h = (z.shape.max[1] - z.shape.min[1]) * k;
        const x = z.shape.min[0] * k;
        const y = z.shape.min[1] * k;
        const f = z.falloff * k;
        return (
          <g key={`z${zi}`} pointerEvents="none">
            <rect x={x} y={y} width={w} height={h} fill={color} fillOpacity={0.05} stroke={color} strokeOpacity={0.5} strokeWidth={strokeW} strokeDasharray={dash} />
            {z.falloff > 0 && (
              <rect x={x - f} y={y - f} width={w + 2 * f} height={h + 2 * f} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={0.5} strokeDasharray="3 3" />
            )}
          </g>
        );
      })}
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
              throwDrag.current = { id: t, x: e.clientX, y: e.clientY, t: Date.now(), trail: [] };
              e.stopPropagation();
            }}
          >
            {isSelected && (
              <circle cx={cx} cy={cy} r={8} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.9" />
            )}
            <circle cx={cx} cy={cy} r="4" fill={sourceHex(src)}>
              <title>#{manualOscIds[t] ?? t + 1} · {SOURCE_LABEL[src] ?? src}</title>
            </circle>
            {isManual && (
              <text
                x={cx + 8}
                y={cy - 6}
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
            <text x={cx} y={cy - 7} fill="#9ca3af" fontSize="7" textAnchor="middle">
              {/* track_id (même numérotation que les pads et la 3D) — pas obj_index */}
              {manualOscIds[t] ?? t + 1}
            </text>
          </g>
        );
      })}
      {/* Flèche du lancer en cours — direction + longueur du flick.
          Le geste était invisible : impossible de viser le lancer. */}
      {throwCursor && throwDrag.current && positions[throwDrag.current.id] && (() => {
        const [ox, oy] = positions[throwDrag.current!.id];
        const x1 = ox * k;
        const y1 = oy * k;
        return (
          <line
            x1={x1} y1={y1} x2={throwCursor.x} y2={throwCursor.y}
            stroke="#22d3ee" strokeWidth="1.5" strokeOpacity="0.8"
            markerEnd="url(#throwArrow)" pointerEvents="none"
          />
        );
      })()}
      <defs>
        <marker id="throwArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#22d3ee" fillOpacity="0.8" />
        </marker>
      </defs>
    </svg>
    {/* Inspect de l'objet sélectionné — composant partagé avec le 3D */}
    <ObjectInspectBar positions={positions} />
    {/* Légende des couleurs source-de-contrôle — les points colorés
        n'avaient aucune clé de lecture. */}
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-1 mt-0.5 flex-shrink-0">
      {(['move', 'manual', 'hold', 'park', 'freeze', 'psn'] as const).map((src) => (
        <span key={src} className="flex items-center gap-0.5 text-[9px] text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_HEX[src] }} />
          {src}
        </span>
      ))}
    </div>
    </>
  );
};

export default Radar2D;
