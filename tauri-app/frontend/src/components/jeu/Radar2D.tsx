/// Radar 2D top-down (plan X/Y) — positions MERGÉES live colorées par
/// source-de-contrôle (fallback emittedPositions = réellement envoyées),
/// auto-fit amorti sur les bounds réels. Drag un objet = grab & throw :
/// la vélocité du flick (~200ms) devient la vélocité du lancer.
/// Partagé par la surface Jeu et la fenêtre ?view=run.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doThrow, doClearPosition } from '../../utils/liveActions';
import ContextMenu from '../ui/ContextMenu';
import { buildObjectMenuItems } from '../../utils/objectMenuItems';
import { sourceHex, SOURCE_LABEL, SOURCE_HEX } from '../../utils/sourceColors';
import { ObjectInspectBar } from '../viewer3d/ObjectInspectBar';
import type { Zone } from '../../store/slices/spatialFxSlice';

/// Vue radar — même vocabulaire que le 3D (top/front/side).
/// top   : plan X/Y   — +y vers le bas d'écran (FRONT = -y, en haut).
/// front : élévation X/Z — +z vers le haut (ySign -1).
/// side  : profil Y/Z — +y vers la droite, +z vers le haut.
export type RadarView = 'top' | 'front' | 'side';
const VIEW_AXES: Record<RadarView, { a: number; b: number; ySign: number; label: string }> = {
  top:   { a: 0, b: 1, ySign: 1,  label: 'FRONT' },
  front: { a: 0, b: 2, ySign: -1, label: 'UP' },
  side:  { a: 1, b: 2, ySign: -1, label: 'UP' },
};

/// Empreinte d'une zone dans le plan projeté (axes a,b) — bounds utilisés
/// par l'auto-fit du radar (une zone lointaine ne doit pas clipper).
function zoneBounds(z: Zone, a: number, b: number): number[] {
  if (z.shape.shape === 'sphere') {
    const r = z.shape.radius + z.falloff;
    return [Math.abs(z.shape.center[a]) + r, Math.abs(z.shape.center[b]) + r];
  }
  const f = z.falloff;
  return [
    Math.max(Math.abs(z.shape.min[a]), Math.abs(z.shape.max[a])) + f,
    Math.max(Math.abs(z.shape.min[b]), Math.abs(z.shape.max[b])) + f,
  ];
}

export const Radar2D: React.FC<{ view: RadarView }> = ({ view: radarView }) => {
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  // Fantômes au repos (Settings) — objets jamais animés rendus en
  // pointillé à leur origine (track_position), sinon invisibles.
  const trackPositions = useGraphStore((s) => s.trackPositions);
  const restGhosts = useGraphStore((s) => s.viewerRestGhosts);
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
  // Origines des objets sans position émise — fantômes au repos.
  const restGhostPos: [number, [number, number, number]][] = restGhosts
    ? manualOscIds.flatMap((tid, i): [number, [number, number, number]][] => {
        if (positions[i]) return [];
        const rp = trackPositions[tid];
        return rp ? [[i, rp]] : [];
      })
    : [];
  const selectedObj = useGraphStore((s) => s.selectedObjIndex);
  const setSelectedObj = useGraphStore((s) => s.setSelectedObjIndex);
  // Menu clic-droit sur un objet — Release/Park/Copy/Paste position.
  const [objMenu, setObjMenu] = React.useState<{ x: number; y: number; obj: number } | null>(null);
  const zones = useGraphStore((s) => s.zones);
  const graphZones = useGraphStore((s) => s.graphZones);
  // Vue projetée — top/front/side, choisie via le sélecteur dans le
  // header du panneau (PerformView) — mêmes conventions que le viewer 3D.
  const { a: va, b: vb, ySign, label: axisLabel } = VIEW_AXES[radarView];

  // Auto-fit : échelle sur les bounds réels PROJETÉS, AVEC hystérésis —
  // un objet lancé loin ne rescale pas la vue d'un coup : zoom-out
  // immédiat (on doit voir l'objet), zoom-in amorti.
  const maxRef = React.useRef(5);
  const targetR = Math.max(
    5,
    ...Object.values(positions).flatMap((p) => [Math.abs(p[va]), Math.abs(p[vb])]),
    // Les fantômes au repos comptent dans le fit — ils font partie du
    // champ spatial (les origines où panic les renvoie).
    ...restGhostPos.flatMap(([, p]) => [Math.abs(p[va]), Math.abs(p[vb])]),
    // Les zones incluent leur empreinte dans le fit — sinon une zone
    // lointaine clipperait hors cadre.
    ...zones.flatMap((z) => zoneBounds(z, va, vb)),
    ...graphZones.flatMap((z) => zoneBounds(z, va, vb)),
  );
  maxRef.current = targetR > maxRef.current
    ? targetR
    : maxRef.current + (targetR - maxRef.current) * 0.08;
  const maxR = maxRef.current;
  const k = 100 / maxR;
  // Projette une position monde [x,y,z] → coords écran du plan actif.
  const proj = (p: readonly number[]): [number, number] => [p[va] * k, p[vb] * k * ySign];

  // Inspect de l'objet sélectionné — délégué à ObjectInspectBar (partagé
  // avec le viewer 3D) : état source + position + release/park.
  // Position écran du drag-throw courant — la flèche montre la direction
  // et la longueur du flick pendant le geste (feedback : le lancer était
  // invisible avant).
  const [throwCursor, setThrowCursor] = React.useState<{ x: number; y: number } | null>(null);

  return (
    <>
    <div className="relative flex-1 min-h-0">
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
        for (const [id, p] of Object.entries(positions)) {
          const [px, py] = proj(p);
          const d = Math.hypot(px - vx, py - vy);
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
        // Vélocité écran → monde selon la vue : l'axe a = droite écran,
        // l'axe b = bas écran × ySign (top : +y monde vers le bas → pas
        // de négation ; front/side : +z vers le haut → négation).
        const velA = ((e.clientX - from.x) * scale) / dt;
        const velB = ((e.clientY - from.y) * scale * ySign) / dt;
        const v: [number, number, number] = [0, 0, 0];
        v[va] = velA;
        v[vb] = velB;
        if (Math.hypot(velA, velB) > 0.5) doThrow(drag.id, v[0], v[1], v[2]);
      }}
      onContextMenu={(e) => {
        // Clic-droit proximité — comme le 3D : menu sur l'objet le plus
        // proche sans viser le cercle r=4 en mouvement. Release = 1er item
        // du menu ; Ctrl+clic reste le release instantané.
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const vx = ((e.clientX - rect.left) / rect.width) * 220 - 110;
        const vy = ((e.clientY - rect.top) / rect.height) * 220 - 110;
        let best = -1;
        let bd = 18;
        for (const [id, p] of Object.entries(positions)) {
          const [px, py] = proj(p);
          const d = Math.hypot(px - vx, py - vy);
          if (d < bd) { bd = d; best = Number(id); }
        }
        if (best >= 0) setObjMenu({ x: e.clientX, y: e.clientY, obj: best });
      }}
    >
      <circle cx="0" cy="0" r="105" fill="none" stroke="#1f2937" strokeWidth="1" />
      <circle cx="0" cy="0" r="52" fill="none" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="0" y1="-105" x2="0" y2="105" stroke="#1f2937" strokeWidth="0.5" />
      <line x1="-105" y1="0" x2="105" y2="0" stroke="#1f2937" strokeWidth="0.5" />
      <text x="0" y="-99" fill="#4b5563" fontSize="8" textAnchor="middle">{axisLabel} · {maxR.toFixed(0)}m</text>
      {/* Axes projetés — la vue ne dit rien si on ne sait pas quels
          axes on regarde. */}
      <text x="103" y="107" fill="#374151" fontSize="7" textAnchor="end">
        {'XYZ'[va]}/{'XYZ'[vb]}
      </text>
      {/* En side : le FRONT (-y) est à gauche — repère au bord. */}
      {radarView === 'side' && (
        <text x="-103" y="107" fill="#4b5563" fontSize="7" textAnchor="start">← FRONT</text>
      )}
      {/* En front : repère LEFT/RIGHT implicite = ±x, rien à marquer. */}
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
          // Sphère projetée = cercle dans n'importe quelle vue ortho.
          const cx = z.shape.center[va] * k;
          const cy = z.shape.center[vb] * k * ySign;
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
        // Box projetée : rect dans le plan (a,b) — le ySign exige un min
        // sur les deux coins écran, pas sur les coords monde.
        const y1 = z.shape.min[vb] * k * ySign;
        const y2 = z.shape.max[vb] * k * ySign;
        const w = (z.shape.max[va] - z.shape.min[va]) * k;
        const h = Math.abs(y2 - y1);
        const x = z.shape.min[va] * k;
        const y = Math.min(y1, y2);
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
      {Object.entries(positions).map(([id, p]) => {
        const t = Number(id);
        const src = objectStates[t] ?? 'track';
        const [px, py] = proj(p);
        // Hors-cadre : jamais un point figé — flèche de bearing sur le
        // bord + distance réelle. L'auto-fit couvre normalement tous les
        // objets du set ; ceci est le filet de sécurité (position en
        // transition, objet hors fit).
        const dist = Math.hypot(px, py);
        const out = dist > 105;
        const bs = out ? 105 / dist : 1;
        const cx = out ? px * bs : px;
        const cy = out ? py * bs : py;
        const ang = Math.atan2(py, px) * 180 / Math.PI;
        // Distance réelle dans le plan projeté, en mètres.
        const distM = Math.hypot(p[va], p[vb]);
        const isManual = src === 'manual';
        const isSelected = selectedObj === t;
        return (
          <g
            key={id}
            style={{ cursor: 'grab' }}
            onContextMenu={(e) => {
              // Clic-droit sur l'objet = menu (Release en 1er item) —
              // le release instantané reste dispo en Ctrl+clic et via
              // l'inspect bar.
              e.preventDefault();
              e.stopPropagation();
              setObjMenu({ x: e.clientX, y: e.clientY, obj: t });
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
            {out ? (
              <>
                {/* Chevron de bearing — pointe vers l'extérieur (angle
                    du vecteur projeté). */}
                <g transform={`translate(${cx},${cy}) rotate(${ang})`}>
                  <path d="M -4,-4 L 5,0 L -4,4 z" fill={sourceHex(src)} />
                </g>
                <text
                  x={cx * 0.93} y={cy * 0.93}
                  fill={sourceHex(src)} fontSize="7" textAnchor="middle" fontWeight="bold"
                >
                  {distM.toFixed(1)}m
                </text>
              </>
            ) : (
              <circle cx={cx} cy={cy} r="4" fill={sourceHex(src)}>
                <title>#{manualOscIds[t] ?? t + 1} · {SOURCE_LABEL[src] ?? src}</title>
              </circle>
            )}
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
      {/* Fantômes au repos — objets jamais animés (aucune position
          émise) rendus à leur origine en pointillé. pointerEvents=none :
          ce sont des repères, pas des cibles de geste. */}
      {restGhostPos.map(([i, p]) => {
        const [cx, cy] = proj(p);
        return (
          <g key={`ghost${i}`} pointerEvents="none" opacity={0.45}>
            <circle cx={cx} cy={cy} r="4" fill="none" stroke="#4b5563" strokeWidth="0.8" strokeDasharray="2 2" />
            <text x={cx} y={cy - 7} fill="#4b5563" fontSize="7" textAnchor="middle">
              {manualOscIds[i] ?? i + 1}
            </text>
          </g>
        );
      })}
      {/* Flèche du lancer en cours — direction + longueur du flick.
          Le geste était invisible : impossible de viser le lancer. */}
      {throwCursor && throwDrag.current && positions[throwDrag.current.id] && (() => {
        const [x1, y1] = proj(positions[throwDrag.current!.id]);
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
    </div>
    {/* Menu clic-droit objet — Release/Park/Copy/Paste position */}
    {objMenu && (
      <ContextMenu
        x={objMenu.x}
        y={objMenu.y}
        header={`Object ${objMenu.obj + 1}`}
        onClose={() => setObjMenu(null)}
        items={buildObjectMenuItems(
          objMenu.obj,
          objectStates[objMenu.obj] ?? 'track',
          emittedPositions[objMenu.obj],
        )}
      />
    )}
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
