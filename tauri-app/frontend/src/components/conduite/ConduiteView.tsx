/// Station de conduite — présentation pure, pilotée par props.
/// Deux adapters l'alimentent : ConduiteSurface (stores, surface interne)
/// et ConduitePage (events, fenêtre détachée). La vue ne connaît ni
/// Zustand ni Tauri — un seul rendu pour les deux contextes.
import React from 'react';
import { StatusChip } from '../ui/StatusChip';
import { ShowTransport } from '../show/ShowTransport';
import type { ConduiteHandlers, ConduiteViewState } from './types';

export const ConduiteView: React.FC<{ st: ConduiteViewState | null } & ConduiteHandlers> = ({
  st,
  onGo,
  onPanic,
  onArmToggle,
  onRecallCue,
  onGoSetlist,
  onUnpark,
  onUnsolo,
}) => {
  // Arm local — click = arm (outline), double-click = RECALL : le même
  // contrat que CuelistPanel, jamais de scene-kill au simple clic.
  const [armedCueId, setArmedCueId] = React.useState<string | null>(null);
  const [parkedOpen, setParkedOpen] = React.useState(false);

  // Modèle console : Prev/Next déplacent le marqueur d'armement SANS
  // tirer — on se positionne dans la cue list sans casser la scène.
  const moveArmed = (dir: 1 | -1) => {
    const cues = st?.cues ?? [];
    if (!cues.length) return;
    const cur = cues.findIndex((c) => c.id === armedCueId);
    if (cur === -1) {
      const currentIdx = cues.findIndex((c) => c.current);
      const start = dir === 1 ? currentIdx + 1 : currentIdx - 1;
      const idx = Math.min(Math.max(start < 0 ? 0 : start, 0), cues.length - 1);
      setArmedCueId(cues[idx]?.id ?? null);
      return;
    }
    const next = cur + dir;
    setArmedCueId(next >= 0 && next < cues.length ? cues[next].id : null);
  };
  const cur = st?.cues.find((c) => c.current);
  // GO tire la cue ARMÉE (ou la suivante si rien d'armé) — l'affichage
  // "Next" doit annoncer exactement ça, pas le marqueur backend : une
  // cible affichée ≠ cible tirée est le piège du modèle précédent (M4).
  const nxt = st?.cues.find((c) => c.id === armedCueId) ?? st?.cues.find((c) => c.next);

  return (
    <div className="h-full w-full bg-stagespace-bg flex flex-col select-none overflow-hidden">
      {/* Header — santé show, lisible à distance FOH. */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0">
        <span className="text-gray-400 text-xs uppercase tracking-widest">Conduite — STAGESPACE</span>
        <div className="flex items-center gap-3">
          {st && !st.armed && (
            <button
              onClick={onArmToggle}
              className="text-xl px-3 py-1 rounded font-bold border border-emerald-600/60 text-emerald-300 bg-emerald-900/30 animate-pulse"
              title="DRY-RUN — cliquer pour armer l'OSC"
            >
              DRY-RUN
            </button>
          )}
          {st && st.parked.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setParkedOpen(!parkedOpen)}
                className="text-xl px-3 py-1.5 rounded font-bold border border-cyan-600/60 text-cyan-200 bg-cyan-900/30 hover:bg-cyan-800/40"
                title={`Objets parkés : ${st.parked.join(', ')} — cliquer pour dégeler`}
              >
                {st.parked.length} PARKED
              </button>
              {parkedOpen && (
                <div className="absolute right-0 top-full mt-1 z-menu bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[180px]">
                  <div className="text-gray-400 text-[10px] uppercase tracking-wider px-1 pb-1">
                    Parked — cliquer pour dégeler
                  </div>
                  {st.parked.map((obj) => (
                    <div key={obj} className="flex items-center justify-between gap-2 px-1 py-1">
                      <span className="text-cyan-200 font-mono text-sm">obj {obj}</span>
                      <button
                        onClick={() => onUnpark(obj)}
                        className="px-2 py-0.5 rounded bg-gray-700 hover:bg-cyan-700 text-xs text-gray-200"
                      >
                        unpark
                      </button>
                    </div>
                  ))}
                  {st.parked.length > 1 && (
                    <button
                      onClick={() => st.parked.forEach((obj) => onUnpark(obj))}
                      className="w-full mt-1 px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-xs font-semibold text-white"
                    >
                      Unpark all
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {st && st.consoleAge !== null && (
            <StatusChip variant={st.consoleAge < 5 ? 'live' : 'dim'} className="text-xl px-3 py-1.5">
              CONSOLE {st.consoleAge < 5 ? '●' : '○'}
            </StatusChip>
          )}
          {st?.tcChaseEnabled && (
            <span className={`font-mono text-3xl font-bold ${st.tcActive ? 'text-emerald-400' : 'text-gray-600'}`}>
              {st.tcActive ? st.tcStr : 'TC lost'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Cue list — opérable : click = arm, double-click = recall. */}
        <div className="w-64 border-r border-gray-800 flex flex-col flex-shrink-0">
          <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-widest border-b border-gray-800">
            Cues — click arm · dbl-click recall
          </div>
          <div className="flex-1 overflow-y-auto">
            {st?.cues.map((c) => (
              <div
                key={c.id}
                onClick={() => setArmedCueId(c.id === armedCueId ? null : c.id)}
                onDoubleClick={() => {
                  setArmedCueId(null);
                  onRecallCue(c.id);
                }}
                className={`px-3 py-2.5 cursor-pointer text-sm truncate ${
                  c.current
                    ? 'bg-purple-900/30 border-l-2 border-purple-500 text-amber-200 font-bold'
                    : c.id === armedCueId
                      ? 'bg-purple-900/10 ring-1 ring-inset ring-purple-500/60 text-gray-200'
                      : c.next
                        ? 'text-gray-300 hover:bg-gray-800/50'
                        : 'text-gray-500 hover:bg-gray-800/50'
                }`}
                title={c.current ? 'Current cue' : 'Click = arm · double-click = RECALL (replaces the whole scene)'}
              >
                {c.next && <span className="text-gray-600 mr-1">→</span>}
                {c.label}
              </div>
            ))}
            {st && st.cues.length === 0 && (
              <div className="px-3 py-4 text-gray-600 text-xs">Aucune cue — créez-en dans l'atelier.</div>
            )}
          </div>
        </div>

        {/* Centre — Now/Next + transport. */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 min-w-0">
          {!st && (
            <div className="text-gray-500 text-sm uppercase tracking-widest animate-pulse">
              Waiting for main window…
            </div>
          )}
          <div className="text-center min-w-0">
            <div className="text-gray-500 text-base uppercase tracking-widest mb-1">Now</div>
            <div className="text-5xl font-black text-amber-300 truncate max-w-[60vw]">{cur?.label || '—'}</div>
            {st?.pending && (
              <div className="text-orange-400 text-2xl font-bold mt-2 animate-pulse">
                {st.pending.kind === 'pre_wait' ? 'pré-attente' : 'follow'} {st.pending.remainingSec.toFixed(1)}s
              </div>
            )}
            {st?.isRecalling && <div className="text-purple-400 text-2xl font-bold mt-2 animate-pulse">RECALLING…</div>}
          </div>
          <div className="text-center min-w-0">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Next</div>
            <div className="text-3xl font-bold text-gray-300 truncate max-w-[55vw]">{nxt?.label || '—'}</div>
          </div>
          <div className="text-green-400/90 text-xl font-semibold">
            {st && st.playingCount > 0 ? `${st.playingCount} moves live` : 'IDLE'}
          </div>

          <ShowTransport
            onPrev={() => moveArmed(-1)}
            onGo={() => onGo(armedCueId)}
            onNext={() => moveArmed(1)}
            prevDisabled={false}
            nextDisabled={false}
            panic={
              <button
                onClick={onPanic}
                className="px-8 py-6 rounded-2xl bg-red-800 hover:bg-red-700 text-red-100 text-2xl font-black active:scale-95"
              >
                PANIC
              </button>
            }
          />

          {/* SETLIST GO — crossfade vers le prochain move (≠ CUE GO au-dessus
              qui tire la cue armée). Sur un écran FOH dédié, avancer la
              setlist sans retour à la fenêtre principale est indispensable. */}
          <div className="flex items-center gap-3">
            <button
              onClick={onGoSetlist}
              disabled={!st?.nextSetlistName}
              className="px-8 py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white font-bold text-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              title="SETLIST GO — crossfade vers le prochain move de la setlist, les layers continuent. ≠ CUE GO (recall = tue la scène)"
            >
              SETLIST ▶
            </button>
            <span className="text-green-200/70 text-base truncate max-w-[30vw]">
              {st?.nextSetlistName ?? 'fin de setlist'}
            </span>
            {st && st.soloRestoreCount > 0 && (
              <button
                onClick={onUnsolo}
                className="px-4 py-2 rounded-lg bg-orange-700/80 hover:bg-orange-600 text-orange-100 text-sm font-bold active:scale-95"
                title={`UNSOLO — rejoue les ${st.soloRestoreCount} slots stoppés par le solo`}
              >
                UNSOLO
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Log opérationnel — les 8 dernières lignes, réticulaire : l'œil
          retombe dessus en fin de cue sans lire. */}
      <div className="h-28 border-t border-gray-800 flex flex-col flex-shrink-0">
        <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-widest">Log</div>
        <div className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11px] leading-4">
          {st?.showLog.slice(-30).map((l, i) => (
            <div key={l.ts + '-' + i} className="text-gray-400 truncate">
              <span className="text-gray-600">
                {new Date(l.ts).toLocaleTimeString('fr-FR', { hour12: false })}
              </span>{' '}
              {l.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConduiteView;
