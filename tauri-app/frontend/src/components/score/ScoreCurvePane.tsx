/// Zone haute du score — partage réglable paramètres / éditeur de
/// courbe. Le contexte (clip slot, lane GLOBALFX, lane MODULATION)
/// est résolu par ScoreView ; ce composant ne fait que distribuer.
/// Défini au niveau module (identité stable) : les sous-composants
/// imbriqués recréeraient le sous-arbre à chaque render et
/// détruiraient la poignée SVG en plein drag (pointer capture).
import React, { useRef, useState } from 'react';
import type { ScoreClipDoc, ScoreKeyframe } from '../../store/useScoreStore';
import { GLOBALFX_LANE, MODULATION_LANE, SPATIALFX_LANE } from '../../store/useScoreStore';
import { CurveEditor } from './CurveEditor';
import { useElementSize } from './useElementSize';
import { ScoreParamsPanel, type ParamGroup } from './ScoreParamsPanel';
import { MERGE_BLEND_DEFS, OBJECT_LANE_DEFS, type ParamDef } from './scoreParams';

/// Enveloppe fade-in → sustain → tail fade-out APRÈS la fin de
/// fenêtre du clip (le move s'éteint au-delà du bord).
const EnvelopeEditor: React.FC<{
  fades: { inMs: number; outMs: number };
  endMs: number;
}> = ({ fades, endMs }) => {
  const end = endMs;
  const total = end + fades.outMs + 500;
  /// Même mécanique que CurveEditor — viewBox = pixels réels.
  const [wrapRef, measured] = useElementSize<HTMLDivElement>();
  const W = measured.width > 0 ? measured.width : 600;
  const H = measured.height > 0 ? measured.height : 100;
  const pad = 12;
  const x = (ms: number) => pad + (ms / total) * (W - pad * 2);
  const pts = [
    [x(0), H - 8],
    [x(fades.inMs), 8],
    [x(end), 8],
    [x(end + fades.outMs), H - 8],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <div ref={wrapRef} className="flex-1 min-h-0 min-w-0">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={x(0)} y={0} width={x(end) - x(0)} height={H} className="fill-purple-500/10" />
      <rect x={x(end)} y={0} width={x(end + fades.outMs) - x(end)} height={H} className="fill-purple-500/5" />
      <line x1={x(end)} y1={0} x2={x(end)} y2={H} stroke="#a78bfa" strokeOpacity={0.5} strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke="#c4b5fd" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {fades.inMs > 0 && (
        <line x1={x(0)} y1={H - 4} x2={x(fades.inMs)} y2={H - 4} stroke="#67e8f9" strokeOpacity={0.6} />
      )}
      {fades.outMs > 0 && (
        <line x1={x(end)} y1={H - 4} x2={x(end + fades.outMs)} y2={H - 4} stroke="#67e8f9" strokeOpacity={0.6} />
      )}
      <text x={x(0) + 2} y={H - 10} className="fill-gray-500" fontSize="9">0</text>
      <text x={x(end) + 2} y={12} className="fill-purple-300" fontSize="9">fin clip</text>
      {fades.outMs > 0 && (
        <text x={x(end + fades.outMs) - 30} y={H - 10} className="fill-cyan-300" fontSize="9">
          +{(fades.outMs / 1000).toFixed(1)}s tail
        </text>
      )}
    </svg>
    </div>
  );
};

export const ScoreCurvePane: React.FC<{
  /// Part de la hauteur totale allouée à la zone haute (0–1).
  topFrac: number;
  selGlobal: string | null;
  selClip: ScoreClipDoc | null;
  selLaneIsGlobalFx: boolean;
  selLaneIsMod: boolean;
  /// Lane SPATIALFX sélectionnée — courbes ksmooth/zone:*/mod:*.
  selLaneIsSpatialFx: boolean;
  spatialFxDefs: ParamDef[];
  spatialFxCurves?: Record<string, ScoreKeyframe[]>;
  /// Lane objet sélectionnée (`obj-<trackId>`) — courbes depth/canaux.
  selObjLane: string | null;
  objectCurves?: Record<string, Record<string, ScoreKeyframe[]>>;
  effParam: string;
  durationMs: number;
  globalFxDefs: ParamDef[];
  globalFxCurves?: Record<string, ScoreKeyframe[]>;
  modDefs: ParamDef[];
  modulationCurves?: Record<string, ScoreKeyframe[]>;
  nodeDefs: ParamDef[];
  clipDefs: ParamDef[];
  /// Fades effectifs du clip sélectionné (enveloppe).
  selFades?: { inMs: number; outMs: number };
  /// Libellé du clip sélectionné (pour le contexte + message).
  selClipLabel?: string;
  /// Groupes de lignes de la colonne paramètres (construits par
  /// ScoreView — il connaît le contexte courant).
  paramGroups: ParamGroup[];
  /// Contenu de la colonne paramètres quand `paramGroups` est vide.
  paramEmptyContent?: React.ReactNode;
  modName: string;
  setModName: (v: string) => void;
  setCurveParam: (id: string) => void;
  mergeStrategy: string;
  setMergeStrategy: (s: string) => void;
  setLaneCurve: (laneId: string, param: string, kfs: ScoreKeyframe[] | undefined) => void;
  setClipCurve: (clipId: string, param: string, kfs: ScoreKeyframe[] | undefined) => void;
}> = ({
  topFrac, selGlobal, selClip, selLaneIsGlobalFx, selLaneIsMod,
  selLaneIsSpatialFx, spatialFxDefs, spatialFxCurves,
  selObjLane, objectCurves,
  effParam, durationMs, globalFxDefs, globalFxCurves, modDefs,
  modulationCurves, nodeDefs, clipDefs, selFades, selClipLabel,
  paramGroups, paramEmptyContent, modName, setModName, setCurveParam,
  mergeStrategy, setMergeStrategy, setLaneCurve, setClipCurve,
}) => {
  /// Partage réglable colonnes paramètres / éditeur — même mécanique
  /// que topFrac, bornes 20–70 %.
  const [paramFrac, setParamFrac] = useState(0.22);
  const curveZoneRef = useRef<HTMLDivElement>(null);
  const paramDrag = useRef(false);
  const isSlot = selClip?.ref.type === 'slot';

  const inner = (() => {
    if (selLaneIsGlobalFx) {
      const p = globalFxDefs.find((d) => d.id === effParam) ?? globalFxDefs[0];
      return (
        <CurveEditor
          kfs={globalFxCurves?.[p.id]}
          endMs={durationMs}
          param={p}
          onCurve={(kfs) => setLaneCurve(GLOBALFX_LANE, p.id, kfs)}
        />
      );
    }
    if (selLaneIsMod) {
      if (!effParam)
        return (
          <span className="text-[11px] text-gray-600 italic">
            Nommez une valeur ci-contre (ex. /score/energy) — un node SignalOsc du même nom la lit dans le graph Mods.
          </span>
        );
      const p = modDefs.find((d) => d.id === effParam) ?? { id: effParam, min: -1, max: 1, def: 0 };
      return (
        <CurveEditor
          kfs={modulationCurves?.[p.id]}
          endMs={durationMs}
          param={p}
          onCurve={(kfs) => setLaneCurve(MODULATION_LANE, p.id, kfs)}
        />
      );
    }
    if (selLaneIsSpatialFx) {
      const p = spatialFxDefs.find((d) => d.id === effParam) ?? spatialFxDefs[0];
      return (
        <CurveEditor
          kfs={spatialFxCurves?.[p.id]}
          endMs={durationMs}
          param={p}
          onCurve={(kfs) => setLaneCurve(SPATIALFX_LANE, p.id, kfs)}
        />
      );
    }
    if (selObjLane) {
      const p = OBJECT_LANE_DEFS.find((d) => d.id === effParam) ?? OBJECT_LANE_DEFS[0];
      return (
        <CurveEditor
          kfs={objectCurves?.[selObjLane]?.[p.id]}
          endMs={durationMs}
          param={p}
          onCurve={(kfs) => setLaneCurve(selObjLane, p.id, kfs)}
        />
      );
    }
    if (!selClip)
      return (
        <span className="text-[11px] text-gray-600 italic">
          Sélectionnez un clip ou une lane globale — les courbes s'affichent ici.
        </span>
      );
    if (effParam !== 'enveloppe' && isSlot) {
      const p = [...nodeDefs, ...clipDefs, ...MERGE_BLEND_DEFS].find((d) => d.id === effParam) ?? clipDefs[0];
      return (
        <CurveEditor
          kfs={selClip.curves?.[p.id]}
          endMs={selClip.durationMs ?? 10_000}
          param={p}
          onCurve={(kfs) => setClipCurve(selClip.id, p.id, kfs)}
        />
      );
    }
    if (!isSlot)
      return (
        <span className="text-[11px] text-gray-500">
          {selClipLabel ?? 'clip'} — événement ponctuel, pas de courbe éditable.
        </span>
      );
    const fades = selFades ?? { inMs: 0, outMs: 0 };
    return <EnvelopeEditor fades={fades} endMs={selClip.durationMs ?? fades.inMs + 4_000} />;
  })();

  return (
    // Zone haute — partage réglable avec la timeline (topFrac,
    // drag sur la poignée) : colonne gauche = sélection du
    // paramètre, colonne droite = édition de sa courbe.
    <div
      ref={curveZoneRef}
      className="min-h-0 flex bg-gray-900/40"
      style={{ flexGrow: topFrac, flexBasis: 0 }}
    >
      <ScoreParamsPanel
        frac={paramFrac}
        contextLabel={
          <>
            {selLaneIsGlobalFx && (
              <>
                <span className="text-[10px] text-cyan-400">GLOBALFX — transform global (merge)</span>
              </>
            )}
            {selLaneIsMod && <span className="text-[10px] text-amber-400">MODULATION — valeurs SignalOsc</span>}
            {selLaneIsSpatialFx && (
              <span className="text-[10px] text-violet-400">SPATIALFX — scalaires des contraintes (zones/règles installées par clip)</span>
            )}
            {selClip && !selGlobal && <span className="text-[10px] text-gray-500 truncate">{selClipLabel} — per-move</span>}
          </>
        }
        showStrategy={selLaneIsGlobalFx}
        mergeStrategy={mergeStrategy}
        onMergeStrategy={setMergeStrategy}
        modName={selLaneIsMod ? modName : undefined}
        onModNameChange={setModName}
        onModNameCommit={setCurveParam}
        onSelectParam={setCurveParam}
        groups={paramGroups}
        emptyContent={paramEmptyContent}
      />
      {/* Poignée de partage paramètres/éditeur */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-gray-800 hover:bg-cyan-700/60"
        title="Glisser pour régler le partage paramètres / éditeur"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          paramDrag.current = true;
        }}
        onPointerMove={(e) => {
          if (!paramDrag.current || !curveZoneRef.current) return;
          const r = curveZoneRef.current.getBoundingClientRect();
          setParamFrac(Math.min(0.5, Math.max(0.12, (e.clientX - r.left) / r.width)));
        }}
        onPointerUp={() => { paramDrag.current = false; }}
      />
      {/* Colonne éditeur */}
      <div
        className="min-w-0 flex flex-col px-3 py-1.5 gap-1"
        style={{ flexGrow: 1 - paramFrac, flexBasis: 0 }}
      >
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
          Éditeur — {selGlobal || (selClip && effParam !== 'enveloppe') ? effParam : 'enveloppe'}
        </span>
        {inner}
      </div>
    </div>
  );
};
