import React from 'react';
import { doUnpark, doClearPosition, doClearAllPositions, doAttention } from '../../utils/liveActions';

/// États qui privent le moteur d'un objet — chacun avec son release :
///   manual/hold → clear_manual_position · park → unpark ·
///   freeze → attention/clear. Vocabulaire aligné sur le viewer
///   (« Clear overrides ») et la légende du radar.
export type HeldState = 'manual' | 'hold' | 'park' | 'freeze';

export interface HeldEntry {
  obj: number;
  state: HeldState;
}

const releaseFor = (obj: number, state: HeldState) => {
  switch (state) {
    case 'park': doUnpark(obj); break;
    case 'freeze': doAttention(null); break;
    default: doClearPosition(obj); break;
  }
};

/// Chip d'état générique : count + popover listant les objets avec
/// release individuel + release-all. `compact` = variante StatusBar ;
/// `dropUp` = popover vers le haut (footer) ; `onRelease`/`onReleaseAll`
/// injectables — la fenêtre conduite détachée route via `conduite:cmd`.
export const StateChip: React.FC<{
  entries: HeldEntry[];
  label: string;
  header: string;
  tone: 'cyan' | 'orange';
  compact?: boolean;
  dropUp?: boolean;
  className?: string;
  onRelease?: (obj: number, state: HeldState) => void;
  releaseAll?: () => void;
}> = ({ entries, label, header, tone, compact, dropUp, className, onRelease, releaseAll }) => {
  const [open, setOpen] = React.useState(false);
  const release = onRelease ?? releaseFor;
  const btn = tone === 'cyan'
    ? 'bg-cyan-800/70 hover:bg-cyan-700 text-cyan-100'
    : 'bg-orange-800/70 hover:bg-orange-700 text-orange-100';
  const objTxt = tone === 'cyan' ? 'text-cyan-200' : 'text-orange-200';
  const rowBtn = tone === 'cyan' ? 'bg-gray-700 hover:bg-cyan-700' : 'bg-gray-700 hover:bg-orange-700';
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={
          className ??
          `rounded-lg ${btn} font-bold transition-colors active:scale-95 ${
            compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-lg'
          }`
        }
        title={`${header} : ${entries.map((e) => e.obj).join(', ')} — cliquer pour gérer`}
      >
        {entries.length} {label}
      </button>
      {open && (
        <div className={`absolute right-0 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} z-menu bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[190px]`}>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider px-1 pb-1">
            {header}
          </div>
          {entries.map((e) => (
            <div key={e.obj} className="flex items-center justify-between gap-2 px-1 py-1">
              <span className={`${objTxt} font-mono text-sm`}>obj {e.obj} · {e.state}</span>
              <button
                onClick={() => release(e.obj, e.state)}
                className={`px-2 py-0.5 rounded ${rowBtn} text-xs text-gray-200`}
              >
                release
              </button>
            </div>
          ))}
          {entries.length > 1 && releaseAll && (
            <button
              onClick={releaseAll}
              className={`w-full mt-1 px-2 py-1 rounded ${btn} text-xs font-semibold text-white`}
            >
              Release all
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/// Chip objets parkés — la fenêtre conduite détachée n'a pas de
/// StatusBar : `onUnpark` injectable pour le routage `conduite:cmd`.
export const ParkedChip: React.FC<{
  parked: number[];
  compact?: boolean;
  dropUp?: boolean;
  className?: string;
  onUnpark?: (obj: number) => void;
}> = ({ parked, onUnpark, ...rest }) => (
  <StateChip
    entries={parked.map((obj) => ({ obj, state: 'park' as const }))}
    label="PARKED"
    header="Parked — hors recalls"
    tone="cyan"
    onRelease={onUnpark ? (obj: number) => onUnpark(obj) : undefined}
    releaseAll={() => parked.forEach((obj) => (onUnpark ?? doUnpark)(obj))}
    {...rest}
  />
);

/// Chip overrides live (manual/hold/freeze) — remplace l'ancienne
/// barre flottante ManualReleaseBar : même contenu, dans la StatusBar.
export const OverrideChip: React.FC<{
  entries: HeldEntry[];
  compact?: boolean;
  dropUp?: boolean;
}> = ({ entries, ...rest }) => (
  <StateChip
    entries={entries}
    label="OVERRIDE"
    header="Overrides — moteur sans la main"
    tone="orange"
    releaseAll={() => {
      doClearAllPositions();
      if (entries.some((e) => e.state === 'freeze')) doAttention(null);
    }}
    {...rest}
  />
);
