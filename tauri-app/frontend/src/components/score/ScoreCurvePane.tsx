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
import { DOPE_ROW_H, DOPE_HEADER_H } from '../../utils/scoreDopesheet';
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
  /// Override du click rangée (dopesheet : l'id est une `DopeRow.key`,
  /// pas un paramId) — défaut `setCurveParam`.
  onSelectParam?: (id: string) => void;
  /// Mode dopesheet — colonne compacte hauteur fixe + scroll V
  /// synchronisé avec le plot (alignement pixel des rangées).
  dopeSync?: { scrollTop: number; onVScroll: (top: number) => void };
  mergeStrategy: string;
  setMergeStrategy: (s: string) => void;
  setLaneCurve: (laneId: string, param: string, kfs: ScoreKeyframe[] | undefined) => void;
  setClipCurve: (clipId: string, param: string, kfs: ScoreKeyframe[] | undefined) => void;
  /// Vue résolue de la zone haute — 'context' suit la sélection
  /// timeline ; 'dopesheet'/'biblio' sont des overrides manuels via
  /// les onglets de la colonne paramètres.
  view: 'context' | 'dopesheet' | 'biblio';
  /// Onglets de navigation entre vues (relais vers ScoreParamsPanel).
  paramTabs?: { id: string; label: string }[];
  activeParamTab?: string;
  onParamTab?: (id: string) => void;
  /// Fiche « mediainfo » de l'item bibliothèque sélectionné —
  /// prioritaire sur le dopesheet quand rien n'est sélectionné.
  explorerInfo?: React.ReactNode;
  /// Dopesheet éditable — affiché quand rien n'est sélectionné.
  dopesheet?: React.ReactNode;
  /// Paramètres du clip (ex-inspector) — affiché quand la rangée
  /// 'clip' est active ou pour les clips non-slot (sans courbes).
  clipParams?: React.ReactNode;
  /// Pied de zone persistant (compteur de clips, vider le score).
  footer?: React.ReactNode;
}> = ({
  topFrac, selGlobal, selClip, selLaneIsGlobalFx, selLaneIsMod,
  selLaneIsSpatialFx, spatialFxDefs, spatialFxCurves,
  selObjLane, objectCurves,
  effParam, durationMs, globalFxDefs, globalFxCurves, modDefs,
  modulationCurves, nodeDefs, clipDefs, selFades, selClipLabel,
  paramGroups, paramEmptyContent, modName, setModName, setCurveParam,
  mergeStrategy, setMergeStrategy, setLaneCurve, setClipCurve,
  onSelectParam, dopeSync, explorerInfo, dopesheet, clipParams, footer,
  view, paramTabs, activeParamTab, onParamTab,
}) => {
  /// Partage réglable colonnes paramètres / éditeur — même mécanique
  /// que topFrac, bornes 20–70 %.
  const [paramFrac, setParamFrac] = useState(0.22);
  const curveZoneRef = useRef<HTMLDivElement>(null);
  const paramDrag = useRef(false);
  const isSlot = selClip?.ref.type === 'slot';

  const inner = (() => {
    /// Overrides manuels (onglets) — la vue forcée prime sur le
    /// contexte de sélection.
    if (view === 'dopesheet')
      return dopesheet ?? (
        <span className="text-[11px] text-gray-600 italic">Dopesheet — vue d'ensemble de la partition.</span>
      );
    if (view === 'biblio')
      return explorerInfo ?? (
        <span className="text-[11px] text-gray-600 italic">
          Sélectionnez un move ou une cue ci-contre — fiche, drag &amp; drop vers la timeline, insertion au playhead.
        </span>
      );
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
      return (selGlobal ? dopesheet : explorerInfo ?? dopesheet) ?? (
        <span className="text-[11px] text-gray-600 italic">
          Sélectionnez un clip ou une lane globale — les courbes s'affichent ici.
        </span>
      );
    if (effParam === 'clip' || !isSlot)
      return clipParams ?? (
        <span className="text-[11px] text-gray-500">
          {selClipLabel ?? 'clip'} — événement ponctuel, pas de courbe éditable.
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
            {view === 'context' && selLaneIsGlobalFx && (
              <>
                <span className="text-[10px] text-cyan-400">GLOBALFX — transform global (merge)</span>
              </>
            )}
            {view === 'context' && selLaneIsMod && <span className="text-[10px] text-amber-400">MODULATION — valeurs SignalOsc</span>}
            {view === 'context' && selLaneIsSpatialFx && (
              <span className="text-[10px] text-violet-400">SPATIALFX — scalaires des contraintes (zones/règles installées par clip)</span>
            )}
            {view === 'context' && selClip && !selGlobal && <span className="text-[10px] text-gray-500 truncate">{selClipLabel} — per-move</span>}
            {view === 'dopesheet' && <span className="text-[10px] text-gray-600">toutes les courbes + événements</span>}
            {view === 'biblio' && <span className="text-[10px] text-gray-600">explorer — moves &amp; cues</span>}
          </>
        }
        showStrategy={selLaneIsGlobalFx}
        mergeStrategy={mergeStrategy}
        onMergeStrategy={setMergeStrategy}
        modName={selLaneIsMod ? modName : undefined}
        onModNameChange={setModName}
        onModNameCommit={setCurveParam}
        onSelectParam={onSelectParam ?? setCurveParam}
        rowHeight={dopeSync ? DOPE_ROW_H : undefined}
        headerHeight={dopeSync ? DOPE_HEADER_H : undefined}
        scrollTop={dopeSync?.scrollTop}
        onVScroll={dopeSync?.onVScroll}
        groups={paramGroups}
        emptyContent={paramEmptyContent}
        tabs={paramTabs}
        activeTab={activeParamTab}
        onTab={onParamTab}
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
          Éditeur — {view === 'dopesheet' ? 'dopesheet' : view === 'biblio' ? 'bibliothèque'
            : !selClip && !selLaneIsGlobalFx && !selLaneIsMod && !selLaneIsSpatialFx && !selObjLane
            ? (!selGlobal && explorerInfo ? 'bibliothèque' : 'dopesheet')
            : selGlobal || (effParam === 'clip' ? selClipLabel ?? 'clip' : effParam)}
        </span>
        {inner}
        {footer}
      </div>
    </div>
  );
};
