import React from 'react';
import { Play, Square, SlidersHorizontal } from 'lucide-react';
import { SOURCE_BADGE } from '../../utils/sourceColors';
import { formatTrackIds } from '../../utils/trackIds';

// Tracks condensés en plages — l'implémentation est partagée
// (utils/trackIds, A6) : pads, table des moves, même lecture.

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
  /// Badges jeu (density pad) — source-de-contrôle par track du slot.
  parkedTracks?: number[];
  heldTracks?: number[];
  isSolo?: boolean;
}

export const SlotTile: React.FC<SlotTileProps> = (p) => {
  const { slot, oscNum, density, big = false, isPlaying, canSolo = false } = p;
  const press = React.useRef<{ momentary: boolean; suppressClick: boolean; restore: 'play' | 'stop' | null; timer: ReturnType<typeof setTimeout> | null }>(
    { momentary: false, suppressClick: false, restore: null, timer: null },
  );

  const releasePress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
    if (press.current.momentary) {
      press.current.momentary = false;
      press.current.suppressClick = true;
      // Retour à l'état CAPTURÉ au début du hold — isPlaying dans la
      // closure est le nouvel état re-rendu, pas l'état d'avant.
      if (press.current.restore === 'play') p.onPlay();
      else p.onStop();
      press.current.restore = null;
    }
  };

  if (density === 'pad') {
    return (
      <div
        onPointerDown={() => {
          // Reset du flag : il ne doit étouffer que le click DU GESTE qui
          // l'a armé — sinon un release hors pad le laisse armé et le
          // prochain tap est avalé en silence (revue M1).
          press.current.suppressClick = false;
          // Multi-press : le timer précédent doit être annulé.
          if (press.current.timer) clearTimeout(press.current.timer);
          press.current.timer = setTimeout(() => {
            // État FRAIS au moment du fire, pas la closure du render —
            // un recall/OSC a pu tuer ou lancer le move pendant le hold
            // (revue M1 : sinon le restore rejoue un move que le show
            // voulait mort).
            void import('../../store/useGraphStore').then(({ useGraphStore }) => {
              const fresh = useGraphStore
                .getState()
                .moveSlots.find((s) => s.id === slot.id);
              const freshPlaying = fresh?.movementId != null;
              press.current.momentary = true;
              // Hold = inversion momentanée dans les DEUX sens : pad arrêté =
              // bump play ; pad live = punch-out (stop, le release rejoue).
              press.current.restore = freshPlaying ? 'play' : 'stop';
              if (freshPlaying) p.onStop();
              else p.onPlay();
            });
          }, 350);
        }}
        onPointerUp={releasePress}
        onPointerLeave={releasePress}
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
            ? 'bg-stagespace-live/25 border-stagespace-live/60 text-stagespace-live'
            : 'bg-gray-800/80 border-gray-700 text-gray-200 hover:bg-gray-700/80'
        } ${p.isSelected ? 'ring-2 ring-inset ring-stagespace-accent/80' : ''}`}
        role="button"
        aria-label={`slot ${oscNum} ${slot.name} ${isPlaying ? 'stop' : 'play'}`}
        title={`OSC: /stagespace/slot ${oscNum} · slot/stop ${oscNum} · solo ${oscNum}`}
      >
        <div className="flex items-center gap-1">
          <span className={`${big ? 'text-2xl' : 'text-sm'} font-black font-mono ${isPlaying ? 'text-stagespace-live' : 'text-gray-500'}`}>
            #{oscNum}
          </span>
          {p.isSolo && (
            <span className="text-[9px] bg-stagespace-warning text-gray-950 px-1 rounded" title="Ce slot est le solo actif">SOLO</span>
          )}
          {p.parkedTracks && p.parkedTracks.length > 0 && (
            <span className={`text-[9px] ${SOURCE_BADGE.park} px-1 rounded`} title={`Parké : ${p.parkedTracks.join(', ')}`}>P</span>
          )}
          {p.heldTracks && p.heldTracks.length > 0 && (
            <span className={`text-[9px] ${SOURCE_BADGE.hold} px-1 rounded`} title={`Hold : ${p.heldTracks.join(', ')}`}>H</span>
          )}
        </div>
        {canSolo && p.onSolo && (
          <button
            onClick={(e) => { e.stopPropagation(); p.onSolo!(); }}
            className="absolute top-1.5 right-1.5 w-8 h-8 rounded-lg bg-stagespace-warning/70 hover:bg-stagespace-warning text-gray-950 text-xs font-bold flex items-center justify-center"
            title="SOLO — coupe les autres en fondu"
          >
            S
          </button>
        )}
        <div className="min-w-0 pr-10">
          <div
            className={`text-[10px] mt-0.5 ${isPlaying ? 'text-stagespace-live/80' : 'text-gray-500'}`}
            title={`Tracks : ${slot.trackIds.join(', ')}${isPlaying ? '' : ' — tap = play, hold ≥350ms = momentary'}`}
          >
            {formatTrackIds(slot.trackIds, p.parkedTracks ?? [])}
            {isPlaying ? ' · LIVE' : ' · hold=bump'}
          </div>
        </div>
        {/* Strip nom — zone de SÉLECTION visuellement distincte du corps
            (transport). Flush sur les bords bas du pad via marges
            négatives : elle se lit comme le label d'une touche console,
            pas comme une surface de jeu. stopPropagation pointerdown
            (tue le timer hold/bump) ET click (ne lance pas le move). */}
        <div
          className={`${big ? '-mx-4 -mb-4' : '-mx-3 -mb-3'} mt-2 px-3 py-1.5 border-t rounded-b-[10px] transition-colors ${
            p.isSelected
              ? 'bg-stagespace-accent/15 border-stagespace-accent/50'
              : 'bg-black/30 border-gray-700/70 hover:bg-black/50 hover:border-gray-600'
          }`}
          onPointerDown={p.onSelect ? (e) => e.stopPropagation() : undefined}
          onClick={p.onSelect ? (e) => { e.stopPropagation(); p.onSelect?.(); } : undefined}
          title={p.onSelect ? 'Select for editing — the drawer below targets this move (no play/stop)' : undefined}
          role={p.onSelect ? 'button' : undefined}
        >
          <div
            className={`${big ? 'text-lg' : 'text-sm'} font-semibold truncate leading-tight ${
              p.isSelected ? 'text-stagespace-accent' : ''
            }`}
          >
            {slot.name}
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
          ? 'bg-stagespace-accent/10 ring-1 ring-inset ring-stagespace-accent/60'
          : p.isCurrentSetlist
            ? 'bg-stagespace-live/10 hover:bg-stagespace-live/20'
            : isPlaying
              ? 'bg-stagespace-live/10 hover:bg-stagespace-live/20'
              : 'hover:bg-gray-800/30'
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          void (isPlaying ? p.onStop() : p.onPlay());
        }}
        className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors active:scale-95 ${
          isPlaying
            ? 'bg-stagespace-danger/25 hover:bg-stagespace-danger/40 text-stagespace-danger'
            : 'bg-stagespace-live/25 hover:bg-stagespace-live/35 text-stagespace-live'
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
                slot.isPreview ? 'bg-slate-800 text-slate-300' : 'bg-stagespace-live/20 text-stagespace-live'
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
        <span className="text-stagespace-live text-xs font-bold flex-shrink-0" title="Current setlist">◉ NOW</span>
      )}
      {p.isNextSetlist && !p.isCurrentSetlist && (
        <span className="text-stagespace-target text-xs font-bold flex-shrink-0" title="Prochain GO">→ NEXT</span>
      )}
      {canSolo && p.onSolo && (
        <button
          onClick={(e) => { e.stopPropagation(); p.onSolo!(); }}
          className="flex-shrink-0 w-11 h-11 rounded text-xs font-bold text-gray-400 hover:bg-stagespace-warning/40 hover:text-stagespace-warning transition-colors"
          title="SOLO — stoppe les autres moves (fade) puis joue celui-ci"
        >
          S
        </button>
      )}
      {p.showSetlistAdd && p.onAddToSetlist && (
        <button
          onClick={(e) => { e.stopPropagation(); p.onAddToSetlist!(); }}
          className="flex-shrink-0 w-11 h-11 rounded text-gray-400 hover:bg-stagespace-accent/30 hover:text-white text-sm transition-colors"
          title="Add to setlist (jouable via GO)"
        >
          →
        </button>
      )}
      <SlidersHorizontal
        size={12}
        className={`flex-shrink-0 ${p.isSelected ? 'text-stagespace-accent' : 'text-gray-400 group-hover:text-gray-400'}`}
      />
    </div>
  );
};

export default SlotTile;
