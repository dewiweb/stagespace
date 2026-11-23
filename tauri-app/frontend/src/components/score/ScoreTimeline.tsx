/// Moitié basse du score — en-têtes de lanes (colonne fixe) +
/// zone timeline scrollable (ruler, lanes globales, lanes objets,
/// clips, curseur). Le scrollTop des en-têtes est synchronisé avec
/// la timeline (mêmes hauteurs de rangées).
import React, { useRef } from 'react';
import {
  GLOBALFX_LANE, MODULATION_LANE, CONDUCTOR_LANE, GLOBAL_LANES, clipLaneIds,
  type ScoreClipDoc, type ScoreKeyframe, type ScoreLaneMode,
} from '../../store/useScoreStore';
import { CLIP_COLORS, fmtMs } from './scoreUtils';
import { effectiveTrackIds } from '../../utils/scoreResolve';
import { ScoreClipBlock, type ClipDragMode } from './ScoreClipBlock';

export interface ScoreLane {
  id: string;
  trackId: number;
  ghost: boolean;
}
export interface ScoreLaneLayout {
  height: number;
  rowOf: Map<string, number>;
}

/// Cible d'un clic droit — le menu contextuel se construit dessus.
/// `clip` porte la lane où le rendu a été cliqué (déliage par piste) ;
/// `empty` = corps de lane vide (ajout de clip à cet instant) ;
/// `ruler` = bornes de loop ; `lane` = en-tête (mute/mode).
export type ScoreMenuTarget =
  | { kind: 'clip'; clipId: string; laneId: string; trackId?: number }
  | { kind: 'lane'; laneId: string; trackId?: number }
  | { kind: 'empty'; laneId: string; ms: number; trackId?: number }
  | { kind: 'ruler'; ms: number };

export const ScoreTimeline: React.FC<{
  /// Part de la hauteur restante allouée à la zone timeline (0–1).
  grow: number;
  durationMs: number;
  displayCursor: number;
  playing: boolean;
  tickEvery: number;
  laneH: number;
  rowH: number;
  ms2px: (ms: number) => number;
  px2ms: (px: number) => number;
  loopStartMs?: number;
  loopEndMs?: number;
  seekScore: (ms: number) => void;
  lanes: ScoreLane[];
  laneLayout: Map<string, ScoreLaneLayout>;
  laneModeOf: (laneId: string) => ScoreLaneMode;
  laneMutedOf: (laneId: string) => boolean;
  clips: ScoreClipDoc[];
  globalFxCurves?: Record<string, ScoreKeyframe[]>;
  modulationCurves?: Record<string, ScoreKeyframe[]>;
  /// Courbes depth/canaux des lanes objet (laneId → param → kfs).
  objectCurves?: Record<string, Record<string, ScoreKeyframe[]>>;
  selGlobal: string | null;
  selected: string | null;
  onSelectLane: (laneId: string) => void;
  onClearSelection: () => void;
  onOpenPicker: (laneId: string, x: number, y: number) => void;
  onToggleLaneMute: (laneId: string) => void;
  onSetLaneMode: (laneId: string, mode: ScoreLaneMode) => void;
  clipOrphan: (c: ScoreClipDoc) => boolean;
  effFades: (c: ScoreClipDoc) => { inMs: number; outMs: number };
  clipLabel: (c: ScoreClipDoc) => string;
  onClipPointerDown: (e: React.PointerEvent, clip: ScoreClipDoc, mode: ClipDragMode, origMs?: number) => void;
  onClipPointerMove: (e: React.PointerEvent, clip: ScoreClipDoc) => void;
  onClipPointerUp: (e: React.PointerEvent) => void;
  onContextMenu: (target: ScoreMenuTarget, x: number, y: number) => void;
}> = ({
  grow, durationMs, displayCursor, playing, tickEvery, laneH, rowH,
  ms2px, px2ms, loopStartMs, loopEndMs, seekScore,
  lanes, laneLayout, laneModeOf, laneMutedOf,
  clips, globalFxCurves, modulationCurves, objectCurves,
  selGlobal, selected, onSelectLane, onClearSelection, onOpenPicker,
  onToggleLaneMute, onSetLaneMode,
  clipOrphan, effFades, clipLabel,
  onClipPointerDown, onClipPointerMove, onClipPointerUp, onContextMenu,
}) => {
  /// En-têtes de lanes — scrollTop synchronisé avec la timeline
  /// (les rangées ont les mêmes hauteurs : ruler 24 + 2×24
  /// lanes globales + hauteur de lane). overflow-y: hidden mais
  /// scrollable par code.
  const laneHeadRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex overflow-hidden min-h-0" style={{ flexGrow: grow, flexBasis: 0 }}>
      <div ref={laneHeadRef} className="w-32 shrink-0 border-r border-gray-800 bg-gray-900/40 flex flex-col overflow-y-hidden">
        <div className="h-6 shrink-0 border-b border-gray-800" />
        {/* En-têtes des lanes GLOBALES — globalfx (transform du merge +
            markers) et modulation (valeurs SignalOsc). Sélection =
            contexte d'édition des courbes (zone haute). */}
        {GLOBAL_LANES.map((laneId) => {
          const isGfx = laneId === GLOBALFX_LANE;
          const isCond = laneId === CONDUCTOR_LANE;
          const sel = selGlobal === laneId;
          const muted = laneMutedOf(laneId);
          return (
            <div
              key={laneId}
              className={`h-6 shrink-0 flex items-center gap-1 px-2 border-b border-gray-800 cursor-pointer ${sel ? 'bg-cyan-900/30 ring-1 ring-cyan-500' : 'hover:bg-gray-800/40'}`}
              onClick={() => onSelectLane(laneId)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu({ kind: 'lane', laneId }, e.clientX, e.clientY);
              }}
              title={isCond
                ? 'Lane CONDUCTOR — événements-barrières : cue recall, stopAll, panic (transitions d\'état globales)'
                : isGfx
                ? 'Lane GLOBALFX — transform global du merge (MacroState de la couche Global FX) + markers'
                : 'Lane MODULATION — valeurs nommées injectées dans la map OSC, lues par les SignalOsc'}
            >
              <button
                onClick={(e) => { e.stopPropagation(); onToggleLaneMute(laneId); }}
                title={muted ? 'Lane mutée — ses événements/courbes ne jouent pas' : 'Mute lane'}
                className={`w-3 h-3 rounded-sm border ${muted ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
              />
              <span className={`text-[9px] font-bold tracking-wide flex-1 truncate ${muted ? 'text-gray-600 line-through' : isCond ? 'text-rose-300' : isGfx ? 'text-cyan-300' : 'text-amber-300'}`}>
                {isCond ? 'CONDUCTOR' : isGfx ? 'GLOBALFX' : 'MODULATION'}
              </span>
              {isCond && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenPicker(laneId, e.clientX, e.clientY); }}
                  title="Ajouter une cue / stop / panic"
                  className="text-gray-500 hover:text-white text-sm leading-none"
                >+</button>
              )}
            </div>
          );
        })}
        {lanes.map((lane) => {
          const muted = laneMutedOf(lane.id);
          const stacked = laneModeOf(lane.id) === 'stacked';
          const sel = selGlobal === lane.id;
          return (
            <div
              key={lane.id}
              className={`shrink-0 flex items-center gap-1 px-2 border-b border-gray-800 cursor-pointer ${sel ? 'bg-cyan-900/30 ring-1 ring-cyan-500' : 'hover:bg-gray-800/40'}`}
              style={{ height: laneLayout.get(lane.id)?.height ?? laneH }}
              onClick={() => onSelectLane(lane.id)}
              title={`Lane T${lane.trackId} — clips + courbes depth/canaux (clic = édition des courbes)`}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu({ kind: 'lane', laneId: lane.id, trackId: lane.trackId }, e.clientX, e.clientY);
              }}
            >
              <button
                onClick={() => onToggleLaneMute(lane.id)}
                title={muted ? 'Lane mutée — ses objets sont exclus des clips' : 'Mute lane'}
                className={`w-3 h-3 rounded-sm border ${muted ? 'bg-orange-600 border-orange-400' : 'border-gray-600'}`}
              />
              <button
                onClick={() => onSetLaneMode(lane.id, stacked ? 'exclusive' : 'stacked')}
                title={stacked
                  ? 'Stacked — les clips simultanés composent (moves superposés)'
                  : 'Exclusive — un clip à la fois (last-wins, sémantique console)'}
                className={`text-[8px] font-mono px-0.5 rounded border ${stacked ? 'border-purple-500 text-purple-300' : 'border-gray-700 text-gray-600 hover:text-gray-400'}`}
              >
                {stacked ? 'STK' : 'EXC'}
              </button>
              <span
                className={`text-[10px] font-bold flex-1 truncate ${muted ? 'text-gray-600 line-through' : lane.ghost ? 'text-orange-400/70' : 'text-gray-300'}`}
                title={lane.ghost ? `Objet ${lane.trackId} non patché — les clips qui le couvrent y sont muets` : `track_id ${lane.trackId}`}
              >
                T{lane.trackId}{lane.ghost ? ' ⚠' : ''}
              </span>
              <button
                onClick={(e) => onOpenPicker(lane.id, e.clientX, e.clientY)}
                title="Ajouter un clip (slot/cue) — sa couverture suit l'assignation"
                className="text-gray-500 hover:text-white text-sm leading-none"
              >+</button>
            </div>
          );
        })}
        <div className="flex-1" />
      </div>

      {/* Zone timeline — son scroll vertical pilote les en-têtes */}
      <div
        className="flex-1 overflow-auto"
        onScroll={(e) => {
          if (laneHeadRef.current) laneHeadRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onClick={onClearSelection}
      >
        <div className="relative" style={{ width: ms2px(durationMs) + 200, minHeight: '100%' }}>
          {/* Ruler — sticky en haut (reste visible au scroll down),
              fond opaque pour ne pas laisser passer les clips.
              Click = seek (stopped only, backend refusera sinon) */}
          <div
            className="sticky top-0 z-20 h-6 border-b border-gray-800 relative cursor-text bg-gray-900"
            onClick={(e) => {
              // stopPropagation — un seek ne désélectionne pas le clip
              // (le conteneur a onClearSelection).
              e.stopPropagation();
              if (playing) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seekScore(Math.round(px2ms(e.clientX - rect.left) / 50) * 50);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              onContextMenu({ kind: 'ruler', ms: Math.max(0, px2ms(e.clientX - rect.left)) }, e.clientX, e.clientY);
            }}
          >
            {Array.from({ length: Math.ceil(durationMs / tickEvery) + 1 }, (_, i) => i * tickEvery).map((ms) => (
              <div key={ms} className="absolute top-0 bottom-0 border-l border-gray-700 pl-1 text-[9px] text-gray-500" style={{ left: ms2px(ms) }}>
                {fmtMs(ms).slice(0, 5)}
              </div>
            ))}
            {/* Region de boucle — bandeau sur la ruler */}
            {loopStartMs != null && loopEndMs != null && (
              <div
                className="absolute top-0 bottom-0 bg-cyan-400/15 border-x border-cyan-400/60 pointer-events-none"
                style={{ left: ms2px(loopStartMs), width: ms2px(loopEndMs - loopStartMs) }}
              />
            )}
          </div>
          {/* Bornes de loop pleine hauteur (très faible) */}
          {loopStartMs != null && loopEndMs != null && (
            <>
              <div className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none" style={{ left: ms2px(loopStartMs) }} />
              <div className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none" style={{ left: ms2px(loopEndMs) }} />
            </>
          )}
          {/* Rangées des lanes GLOBALES — globalfx : markers +
              points de ses courbes ; modulation : points de ses
              courbes nommées (aperçu — l'édition est en zone haute). */}
          {GLOBAL_LANES.map((laneId) => {
            const isGfx = laneId === GLOBALFX_LANE;
            const laneCurves = laneId === MODULATION_LANE ? modulationCurves : (isGfx ? globalFxCurves : undefined);
            return (
              <div
                key={laneId}
                className={`relative h-6 border-b border-gray-800 cursor-pointer ${selGlobal === laneId ? 'bg-cyan-900/15' : 'hover:bg-gray-800/20'} ${laneMutedOf(laneId) ? 'opacity-40' : ''}`}
                onClick={(e) => { e.stopPropagation(); onSelectLane(laneId); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onContextMenu({ kind: 'empty', laneId, ms: Math.max(0, px2ms(e.clientX - rect.left)) }, e.clientX, e.clientY);
                }}
              >
                {clips.filter((c) => clipLaneIds(c, effectiveTrackIds(c)).includes(laneId)).map((c) => (
                  <div
                    key={c.id}
                    className={`absolute top-0.5 bottom-0.5 rounded border text-[9px] font-bold px-1 flex items-center cursor-grab ${CLIP_COLORS[c.ref.type]} ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                    style={{ left: ms2px(c.startMs), minWidth: 14 }}
                    title={clipLabel(c)}
                    onPointerDown={(e) => onClipPointerDown(e, c, 'move')}
                    onPointerMove={(e) => onClipPointerMove(e, c)}
                    onPointerUp={onClipPointerUp}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu({ kind: 'clip', clipId: c.id, laneId }, e.clientX, e.clientY);
                    }}
                  >
                    <span className="truncate pointer-events-none">{clipLabel(c)}</span>
                  </div>
                ))}
                {Object.entries(laneCurves ?? {}).flatMap(([param, kfs], pi) =>
                  kfs.map((k, i) => (
                    <div
                      key={`${param}-${i}`}
                      title={`${param} @${fmtMs(k.t)} = ${k.v}`}
                      className={`absolute w-1.5 h-1.5 rounded-full ${isGfx ? 'bg-cyan-300/70' : 'bg-amber-300/70'}`}
                      style={{ left: ms2px(k.t) - 3, top: 2 + (pi % 3) * 6 }}
                    />
                  )),
                )}
              </div>
            );
          })}
          {/* Lanes objets — un clip couvrant plusieurs objets se
              rend sur CHAQUE lane couverte (copie liée : éditer un
              exemplaire édite l'entité). */}
          {lanes.map((lane) => {
            const lay = laneLayout.get(lane.id) ?? { height: laneH, rowOf: new Map<string, number>() };
            const stacked = laneModeOf(lane.id) === 'stacked';
            return (
              <div
                key={lane.id}
                className="relative border-b border-gray-800"
                style={{ height: lay.height, opacity: laneMutedOf(lane.id) ? 0.4 : 1 }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onContextMenu({ kind: 'empty', laneId: lane.id, trackId: lane.trackId, ms: Math.max(0, px2ms(e.clientX - rect.left)) }, e.clientX, e.clientY);
                }}
              >
                {/* Blast radius des cues (clipLaneIds → conductor ;
                    couverture effective du snapshot ; vide = toutes
                    les lanes) — marqueur d'impact, pas un clip. */}
                {clips.filter((c) => c.ref.type === 'cue' && (effectiveTrackIds(c).length === 0 || effectiveTrackIds(c).includes(lane.trackId))).map((c) => (
                  <div
                    key={`blast-${c.id}`}
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400/50 pointer-events-none"
                    style={{ left: ms2px(c.startMs) }}
                    title={`${clipLabel(c)} — touche T${lane.trackId}`}
                  />
                ))}
                {/* Clips positions — marqueurs interactifs par piste
                    (instantané : set de positions manuelles). */}
                {clips.filter((c) => c.ref.type === 'positions' && effectiveTrackIds(c).includes(lane.trackId)).map((c) => (
                  <div
                    key={`pos-${c.id}`}
                    className={`absolute top-0 bottom-0 w-1 bg-teal-400/80 cursor-pointer hover:bg-teal-300 ${selected === c.id ? 'ring-1 ring-white' : ''}`}
                    style={{ left: ms2px(c.startMs) - 2 }}
                    title={clipLabel(c)}
                    onPointerDown={(e) => onClipPointerDown(e, c, 'move')}
                    onPointerMove={(e) => onClipPointerMove(e, c)}
                    onPointerUp={onClipPointerUp}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu({ kind: 'clip', clipId: c.id, laneId: lane.id, trackId: lane.trackId }, e.clientX, e.clientY);
                    }}
                  />
                ))}
                {clips.filter((c) => c.ref.type === 'slot' && effectiveTrackIds(c).includes(lane.trackId)).map((c) => {
                  const row = lay.rowOf.get(c.id) ?? 0;
                  const top = stacked ? 2 + row * rowH : 6;
                  const h = stacked ? rowH - 4 : lay.height - 12;
                  const orphan = clipOrphan(c);
                  const fades = c.ref.type === 'slot' ? effFades(c) : null;
                  return (
                    <ScoreClipBlock
                      key={c.id}
                      clip={c}
                      label={clipLabel(c)}
                      orphan={orphan}
                      selected={selected === c.id}
                      top={top}
                      h={h}
                      ms2px={ms2px}
                      fades={fades}
                      onPointerDown={onClipPointerDown}
                      onPointerMove={onClipPointerMove}
                      onPointerUp={onClipPointerUp}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onContextMenu({ kind: 'clip', clipId: c.id, laneId: lane.id, trackId: lane.trackId }, e.clientX, e.clientY);
                      }}
                    />
                  );
                })}
                {/* Points des courbes depth/canaux de la lane (édition
                    en zone haute quand la lane est sélectionnée). */}
                {Object.entries(objectCurves?.[lane.id] ?? {}).flatMap(([param, kfs], pi) =>
                  kfs.map((k, i) => (
                    <div
                      key={`oc-${param}-${i}`}
                      title={`${param} @${fmtMs(k.t)} = ${k.v}`}
                      className="absolute w-1.5 h-1.5 rounded-full bg-emerald-300/70 pointer-events-none"
                      style={{ left: ms2px(k.t) - 3, top: 2 + (pi % 3) * 6 }}
                    />
                  )),
                )}
              </div>
            );
          })}
          {/* Curseur */}
          <div className="absolute top-0 bottom-0 w-px bg-cyan-400 pointer-events-none" style={{ left: ms2px(displayCursor) }} />
        </div>
      </div>
    </div>
  );
};
