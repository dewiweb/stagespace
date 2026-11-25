/// Rendu d'un clip sur une lane — corps + tail fade-out (débordant
/// le bord droit : le move s'éteint APRÈS la fin de sa fenêtre) +
/// ticks de répétition + poignées de drag. Copie liée : le même clip
/// se rend sur chaque lane de sa couverture, éditer un exemplaire
/// édite l'entité.
import React from 'react';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import { CLIP_COLORS } from './scoreUtils';

export type ClipDragMode = 'move' | 'resize' | 'fadeIn' | 'fadeOut';

export const ScoreClipBlock: React.FC<{
  clip: ScoreClipDoc;
  label: string;
  orphan: boolean;
  selected: boolean;
  /// Position verticale/h hauteur dans la lane (stacked ou non).
  top: number;
  h: number;
  ms2px: (ms: number) => number;
  fades: { inMs: number; outMs: number } | null;
  /// Offset (ms) où le move meurt de sa mort naturelle dans la
  /// fenêtre (oneshot) — la zone au-delà est muette.
  moveEndMs?: number;
  onPointerDown: (e: React.PointerEvent, clip: ScoreClipDoc, mode: ClipDragMode, origMs?: number) => void;
  onPointerMove: (e: React.PointerEvent, clip: ScoreClipDoc) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  /// Clic droit sur ce rendu — la lane parente complète le contexte
  /// (clipId + trackId pour le déliage de couverture).
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ clip: c, label, orphan, selected, top, h, ms2px, fades, moveEndMs, onPointerDown, onPointerMove, onPointerUp, onContextMenu }) => {
  /// Événement ponctuel (cue/marker, durationMs null) — pas de
  /// fenêtre : la boîte épouse son label (nowrap) et une barre
  /// blanche à gauche marque l'instant, au lieu d'un carré de 14px.
  const instant = c.durationMs == null;
  const w = c.durationMs != null ? ms2px(c.durationMs) : 14;
  const bg = CLIP_COLORS[c.ref.type].split(' ')[0];
  return (
    <React.Fragment>
      {/* Tail fade-out — déborde le bord droit : le move s'éteint
          APRÈS la fin de sa fenêtre (EndMove à end + ramp). */}
      {fades && fades.outMs > 0 && c.durationMs != null && (
        <div
          className="absolute z-0 pointer-events-none"
          style={{ left: ms2px(c.startMs + c.durationMs), top, height: h, width: ms2px(fades.outMs) }}
        >
          <div
            className={`absolute inset-0 ${bg} opacity-50`}
            style={{ clipPath: 'polygon(0 0, 0 100%, 100% 100%)' }}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize pointer-events-auto"
            title="fade out — tail du clip (s)"
            onPointerDown={(e) => onPointerDown(e, c, 'fadeOut', fades.outMs)}
            onPointerMove={(e) => onPointerMove(e, c)}
            onPointerUp={onPointerUp}
          />
        </div>
      )}
      <div
        className={`absolute rounded border text-[10px] font-bold px-1.5 flex items-center overflow-hidden cursor-grab ${CLIP_COLORS[c.ref.type]} ${selected ? 'ring-2 ring-white' : ''} ${orphan ? 'border-dashed border-orange-500 opacity-60 saturate-50' : ''} ${instant ? 'whitespace-nowrap pr-2 border-l-2 border-l-white/70' : ''}`}
        style={{ left: ms2px(c.startMs), width: instant ? undefined : Math.max(14, w), minWidth: 14, top, height: h }}
        title={orphan ? `${label} — référence perdue` : label}
        onPointerDown={(e) => onPointerDown(e, c, 'move')}
        onPointerMove={(e) => onPointerMove(e, c)}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={onContextMenu}
      >
        {/* Région de fade-in + poignée d'angle (drag horizontal → fade_in clip-local) */}
        {fades && fades.inMs > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-black/50 to-transparent pointer-events-none"
            style={{ width: ms2px(fades.inMs) }}
          />
        )}
        {fades && (
          <div
            className="absolute left-0 top-0 w-2.5 h-2.5 cursor-ew-resize"
            style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)', background: 'rgba(255,255,255,.4)' }}
            title="fade in — entrée du clip (s)"
            onPointerDown={(e) => onPointerDown(e, c, 'fadeIn', fades.inMs)}
            onPointerMove={(e) => onPointerMove(e, c)}
            onPointerUp={onPointerUp}
          />
        )}
        {/* Fin naturelle du move (oneshot) — au-delà la fenêtre est
            muette (position tenue si hold, rien sinon) : borne +
            zone morte assombrie. */}
        {moveEndMs != null && c.durationMs != null && moveEndMs < c.durationMs && (
          <>
            <div
              className="absolute top-0 bottom-0 right-0 bg-black/45 pointer-events-none"
              style={{ left: ms2px(moveEndMs) }}
            />
            <div
              className="absolute top-0 bottom-0 border-l border-dashed border-stagespace-derived/60 pointer-events-none"
              style={{ left: ms2px(moveEndMs) }}
              title="fin naturelle du move — fenêtre muette au-delà"
            />
          </>
        )}
        {/* Copies du pattern — ticks aux bornes de répétition */}
        {c.repeatEveryMs != null && c.repeatEveryMs > 0 && c.durationMs != null &&
          Array.from(
            { length: Math.floor(c.durationMs / c.repeatEveryMs) },
            (_, i) => (i + 1) * c.repeatEveryMs!,
          ).filter((off) => off < c.durationMs!).map((off) => (
            <div
              key={off}
              className="absolute top-0 bottom-0 border-l border-white/30 pointer-events-none"
              style={{ left: ms2px(off) }}
            />
          ))}
        <span className="truncate pointer-events-none">
          {c.repeatEveryMs != null ? '⟳ ' : ''}{label}
        </span>
        {c.ref.type === 'slot' && c.durationMs != null && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/50"
            onPointerDown={(e) => onPointerDown(e, c, 'resize')}
            onPointerMove={(e) => onPointerMove(e, c)}
            onPointerUp={onPointerUp}
          />
        )}
      </div>
    </React.Fragment>
  );
};
