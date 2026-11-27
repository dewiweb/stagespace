import React from 'react';
import type { Pose } from '../../types/generated/Pose';

/// Tuile pose — esprit console lumière (palettes position), même langage
/// visuel que SlotTile. Gestes :
///   tap   = snap (rappel instantané — positions manuelles, partiel)
///   hold  = goto (rampe animée oneshot+hold, durée du mur)
///   nom   = sélection (cibles en fantômes dans le 3D/radar) — le corps
///           du pad reste un geste de transport pur, même séparation que
///           SlotTile.
/// Une pose n'a pas d'état « playing » : le snap est instantané et ne
/// persiste pas — pas de highlight permanent, juste le feedback de press.
interface PoseTileProps {
  pose: Pose;
  /// Tracks de la pose encore patchées — warning visuel si incomplet.
  patchedCount: number;
  isSelected: boolean;
  onSnap: () => void;
  onGoto: () => void;
  onSelect: () => void;
}

export const PoseTile: React.FC<PoseTileProps> = (p) => {
  const ntracks = Object.keys(p.pose.positions).length;
  const unpatched = ntracks - p.patchedCount;
  // Hold ≥350ms = goto. Le timer annulé au release avant 350ms laisse le
  // click snap s'appliquer ; une fois le goto parti, suppressClick empêche
  // le snap en double au release (même pattern que SlotTile).
  const press = React.useRef<{ fired: boolean; timer: ReturnType<typeof setTimeout> | null }>({
    fired: false,
    timer: null,
  });

  const releasePress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };

  return (
    <div
      onPointerDown={() => {
        press.current.fired = false;
        if (press.current.timer) clearTimeout(press.current.timer);
        press.current.timer = setTimeout(() => {
          press.current.fired = true;
          p.onGoto();
        }, 350);
      }}
      onPointerUp={releasePress}
      onPointerLeave={releasePress}
      onClick={() => {
        if (press.current.fired) {
          press.current.fired = false;
          return;
        }
        p.onSnap();
      }}
      className={`relative flex flex-col justify-between p-3 rounded-xl min-h-[88px] select-none cursor-pointer transition-colors active:scale-95 border bg-gray-800/80 border-gray-700 text-gray-200 hover:bg-gray-700/80 hover:border-stagespace-target/50 ${
        p.isSelected ? 'ring-2 ring-inset ring-stagespace-target/80' : ''
      }`}
      role="button"
      aria-label={`pose ${p.pose.name} snap`}
      title={`tap = snap instantané · hold = goto animé · OSC: /stagespace/pose/snap ${p.pose.name}`}
    >
      <div className="flex items-center gap-1">
        <span className="text-sm font-black font-mono text-stagespace-target">◈</span>
        {unpatched > 0 && (
          <span
            className="text-[9px] bg-stagespace-warning text-gray-950 px-1 rounded"
            title={`${unpatched} track(s) not patched — skipped at recall`}
          >
            {p.patchedCount}/{ntracks}⚠
          </span>
        )}
      </div>
      {unpatched === 0 && (
        <div className="text-[10px] text-gray-600 min-w-0">{ntracks} tracks</div>
      )}
      {/* Strip nom — sélection fantômes, visuellement distincte du corps
          (snap/goto). Flush sur les bords bas : label de touche console,
          même langage que SlotTile. */}
      <div
        className={`-mx-3 -mb-3 mt-2 px-3 py-1.5 border-t rounded-b-[10px] transition-colors ${
          p.isSelected
            ? 'bg-stagespace-target/15 border-stagespace-target/50'
            : 'bg-black/30 border-gray-700/70 hover:bg-black/50 hover:border-gray-600'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          p.onSelect();
        }}
        title="Show/hide pose targets as ghosts in the viewers (no snap)"
        role="button"
      >
        <div
          className={`text-sm font-semibold truncate leading-tight ${
            p.isSelected ? 'text-stagespace-target' : ''
          }`}
        >
          {p.pose.name}
        </div>
      </div>
    </div>
  );
};
