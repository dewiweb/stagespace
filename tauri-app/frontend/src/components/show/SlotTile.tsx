import React from 'react';
import { Play, Square, SlidersHorizontal } from 'lucide-react';

/// Tuile de slot unifiée — un seul composant pour le rendu live d'un move
/// (ex-renderPad + ex-renderSlotRow, deux implémentations divergentes dans
/// PerformView). `density` contrôle la forme, PAS la sémantique :
///   pad  = busking (tap = play/stop, hold ≥350ms = bump momentané)
///   row  = setlist/layers (tap = sélection params, ▶/■ = layer, markers NOW/NEXT)
///
/// MovesTable reste une surface d'ÉDITION (inputs nom/oscIndex/tracks) —
/// volontairement hors de ce composant.
interface SlotTileProps {
  slot: { id: string; name: string; movementId: string | null; trackIds: number[]; isPreview?: boolean };
  /// Numéro 1-based affiché — le n de `/stagespace/slot <n>`.
  oscNum: number;
  density: 'pad' | 'row';
  big?: boolean;
  isPlaying: boolean;
  isSelected?: boolean;
  isCurrentSetlist?: boolean;
  isNextSetlist?: boolean;
  showSetlistAdd?: boolean;
  canSolo?: boolean;
  onPlay: () => void;
  onStop: () => void;
  onSolo?: () => void;
  onSelect?: () => void;
  onAddToSetlist?: () => void;
}

export const SlotTile: React.FC<SlotTileProps> = (p) => {
  const { slot, oscNum, density, big = false, isPlaying, canSolo = false } = p;
  const press = React.useRef<{ momentary: boolean; suppressClick: boolean; timer: ReturnType<typeof setTimeout> | null }>(
    { momentary: false, suppressClick: false, timer: null },
  );

  if (density === 'pad') {
    return (
      <div
        onPointerDown={() => {
          press.current.timer = setTimeout(() => {
            press.current.momentary = true;
            if (!isPlaying) p.onPlay();
          }, 350);
        }}
        onPointerUp={() => {
          if (press.current.timer) clearTimeout(press.current.timer);
          press.current.timer = null;
          if (press.current.momentary) {
            press.current.momentary = false;
            press.current.suppressClick = true;
            p.onStop();
          }
        }}
        onPointerLeave={() => {
          if (press.current.timer) clearTimeout(press.current.timer);
          press.current.timer = null;
          if (press.current.momentary) {
            press.current.momentary = false;
            press.current.suppressClick = true;
            p.onStop();
          }
        }}
        onClick={() => {
          // Après un hold momentané, le click toggle ferait repartir le
          // move — on le saute : le release a déjà fade-out.
          if (press.current.suppressClick) {
            press.current.suppressClick = false;
            return;
          }
          void (isPlaying ? p.onStop() : p.onPlay());
        }}
        className={`relative flex flex-col justify-between p-3 rounded-xl ${big ? 'min-h-[150px] p-4' : 'min-h-[88px]'} select-none cursor-pointer transition-colors active:scale-95 border ${
          isPlaying
            ? 'bg-green-800/70 border-green-600 text-green-50'
            : 'bg-gray-800/80 border-gray-700 text-gray-200 hover:bg-gray-700/80'
        }`}
        role="button"
        aria-label={`slot ${oscNum} ${slot.name} ${isPlaying ? 'stop' : 'play'}`}
        title={`OSC: /stagespace/slot ${oscNum} · slot/stop ${oscNum} · solo ${oscNum}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className={`${big ? 'text-2xl' : 'text-sm'} font-black font-mono ${isPlaying ? 'text-green-300' : 'text-gray-500'}`}>
            #{oscNum}
          </span>
          {canSolo && p.onSolo && (
            <button
              onClick={(e) => { e.stopPropagation(); p.onSolo!(); }}
              className="w-8 h-8 -m-1 rounded-lg bg-orange-700/70 hover:bg-orange-600 text-orange-100 text-xs font-bold flex items-center justify-center"
              title="SOLO — coupe les autres en fondu"
            >
              S
            </button>
          )}
        </div>
        <div className="min-w-0">
          <div className={`${big ? 'text-lg' : 'text-sm'} font-semibold truncate leading-tight`}>{slot.name}</div>
          <div className={`text-[10px] mt-0.5 ${isPlaying ? 'text-green-300/80' : 'text-gray-500'}`}>
            {slot.trackIds.length} trk{isPlaying ? ' · LIVE' : ' · hold=bump'}
          </div>
        </div>
      </div>
    );
  }

  // density === 'row' — ligne setlist/layers : tap = sélection params,
  // ▶/■ = play/stop layer, markers NOW/NEXT, S solo, → setlist optionnel.
  return (
    <div
      onClick={p.onSelect}
      title="Live params of this move"
      className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/40 transition-colors ${
        p.isSelected
          ? 'bg-indigo-900/30 ring-1 ring-inset ring-indigo-600/60'
          : p.isCurrentSetlist
            ? 'bg-purple-900/20 hover:bg-purple-900/30'
            : isPlaying
              ? 'bg-green-900/10 hover:bg-green-900/20'
              : 'hover:bg-gray-800/30'
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          void (isPlaying ? p.onStop() : p.onPlay());
        }}
        className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors active:scale-95 ${
          isPlaying
            ? 'bg-red-800/80 hover:bg-red-700 text-red-200'
            : 'bg-green-800/80 hover:bg-green-700 text-green-200'
        }`}
        title={isPlaying ? 'Stop this move' : 'Launch (layered — others keep running)'}
      >
        {isPlaying ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-gray-600 text-[10px] font-mono flex-shrink-0"
            title={`OSC: /stagespace/slot ${oscNum} · slot/stop ${oscNum} · solo ${oscNum}`}
          >
            #{oscNum}
          </span>
          <span className="text-white text-xs font-medium truncate">{slot.name}</span>
          {isPlaying && (
            <span
              className={`text-xs px-1 rounded ${
                slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'
              }`}
            >
              {slot.isPreview ? 'PREV' : 'LIVE'}
            </span>
          )}
        </div>
        <div className="text-gray-500 text-xs">
          {slot.trackIds.length} trk
        </div>
      </div>
      {p.isCurrentSetlist && (
        <span className="text-purple-400 text-xs font-bold flex-shrink-0" title="Current setlist">◉ NOW</span>
      )}
      {p.isNextSetlist && !p.isCurrentSetlist && (
        <span className="text-green-400/80 text-xs font-bold flex-shrink-0" title="Prochain GO">→ NEXT</span>
      )}
      {canSolo && p.onSolo && (
        <button
          onClick={(e) => { e.stopPropagation(); p.onSolo!(); }}
          className="flex-shrink-0 w-6 h-6 rounded text-[10px] font-bold text-gray-400 hover:bg-orange-600/40 hover:text-orange-200 transition-colors"
          title="SOLO — stoppe les autres moves (fade) puis joue celui-ci"
        >
          S
        </button>
      )}
      {p.showSetlistAdd && p.onAddToSetlist && (
        <button
          onClick={(e) => { e.stopPropagation(); p.onAddToSetlist!(); }}
          className="flex-shrink-0 w-6 h-6 rounded text-gray-400 hover:bg-purple-600/30 hover:text-white text-xs transition-colors"
          title="Add to setlist (jouable via GO)"
        >
          →
        </button>
      )}
      <SlidersHorizontal
        size={12}
        className={`flex-shrink-0 ${p.isSelected ? 'text-indigo-300' : 'text-gray-400 group-hover:text-gray-400'}`}
      />
    </div>
  );
};

export default SlotTile;
