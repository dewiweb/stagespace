/// Station de conduite — présentation pure, pilotée par props.
/// Deux adapters l'alimentent : ConduiteSurface (stores, surface interne)
/// et ConduitePage (events, fenêtre détachée). La vue ne connaît ni
/// Zustand ni Tauri — un seul rendu pour les deux contextes.
import React from 'react';
import { StatusChip } from '../ui/StatusChip';
import { ParkedChip } from '../perform/ParkedChip';
import { ShowTransport } from '../show/ShowTransport';
import { formatLogLabel } from '../../utils/liveActionsShared';
import type { ConduiteHandlers, ConduiteViewState } from './types';
import { SOURCE_OUTLINE } from '../../utils/sourceColors';

export const ConduiteView: React.FC<{ st: ConduiteViewState | null } & ConduiteHandlers> = ({
  st,
  onGo,
  onPanic,
  onArmToggle,
  onRecallCue,
  onGoSetlist,
  onUnpark,
  onUnsolo,
  onDetach,
  onArmCue,
  onTcChaseToggle,
}) => {
  // Arm unifié — lu depuis st (source unique : useCuelistStore, partagé
  // avec le fil OSC et le menu CUE GO), écrit via onArmCue. Click = arm
  // (outline), double-click = RECALL : jamais de scene-kill au simple clic.
  const armedCueId = st?.armedCueId ?? null;
  const setArmedCueId = onArmCue;

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
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs uppercase tracking-widest">Conduite</span>
          {onDetach && (
            <button
              onClick={onDetach}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white font-bold transition-colors"
              title="Détacher cette vue dans une fenêtre dédiée (écran FOH)"
            >
              ⧉
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Arm symétrique — le bouton existe dans les DEUX états :
              la fenêtre détachée FOH doit pouvoir repasser en dry-run
              sans la fenêtre principale (trou de sécurité U10). */}
          {st && (
            <button
              onClick={onArmToggle}
              className={`text-xl px-3 py-1 rounded font-bold border transition-colors ${
                st.armed
                  ? 'border-stagespace-danger/60 bg-stagespace-danger/30 text-white hover:bg-stagespace-danger/50'
                  : 'border-gray-700 text-gray-400 bg-gray-800 hover:text-gray-200 animate-pulse'
              }`}
              title={st.armed ? 'LIVE — positions émises vers le renderer. Cliquer pour DRY-RUN' : 'DRY-RUN — cliquer pour armer l\'OSC'}
            >
              {st.armed ? 'LIVE' : 'DRY-RUN'}
            </button>
          )}
          {st && st.parked.length > 0 && (
            <ParkedChip
              parked={st.parked}
              onUnpark={onUnpark}
              className={`text-xl px-3 py-1.5 rounded font-bold border ${SOURCE_OUTLINE.park}`}
            />
          )}
          {st && st.consoleAge !== null && (
            <StatusChip variant={st.consoleAge < 5 ? 'live' : 'dim'} className="text-xl px-3 py-1.5">
              CONSOLE {st.consoleAge < 5 ? '●' : '○'}
            </StatusChip>
          )}
          {/* TC — chip persistant et cliquable : toggle chase. Sans ça
              la fenêtre détachée n'a AUCUN contrôle TC (le routing
              tcchase: existait mais rien ne l'émettait — U10). */}
          {st && (
            <button
              onClick={onTcChaseToggle}
              className={`font-mono font-bold rounded px-2 py-1 border transition-colors ${
                st.tcChaseEnabled
                  ? `text-3xl border-transparent ${st.tcActive ? 'text-stagespace-live' : 'text-stagespace-warning'}`
                  : 'text-lg border-gray-700 text-gray-600 hover:text-gray-400'
              }`}
              title={st.tcChaseEnabled ? 'TC chase ON — cliquer pour couper' : 'TC chase OFF — cliquer pour chaser le timecode'}
            >
              {st.tcChaseEnabled ? (st.tcActive ? st.tcStr : 'TC lost') : 'TC'}
            </button>
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
                    ? 'bg-stagespace-conduite/15 border-l-2 border-stagespace-conduite font-bold'
                    : c.id === armedCueId
                      ? 'bg-stagespace-conduite/10 ring-1 ring-inset ring-stagespace-conduite/60 text-gray-200'
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
            {/* Sans cue courante mais des moves live (busking) : NOW montre
                la vérité — ce qui sonne — plutôt qu'un tiret trompeur. */}
            <div className="text-5xl font-black text-stagespace-conduite truncate max-w-[60vw]">
              {cur?.label ||
                (st && st.playingNames.length > 0
                  ? st.playingNames.length > 2
                    ? `${st.playingNames[0]} +${st.playingNames.length - 1}`
                    : st.playingNames.join(' + ')
                  : '—')}
            </div>
            {st && st.playingNames.length > 0 && (
              <div className="text-gray-500 text-sm mt-1" title={st.playingNames.join(', ')}>
                {cur
                  ? `+ ${st.playingNames.join(' + ')} busked`
                  : 'busked — no current cue'}
              </div>
            )}
            {st?.pending && (
              <div className="text-stagespace-conduite text-2xl font-bold mt-2 animate-pulse">
                {st.pending.kind === 'pre_wait' ? 'pré-attente' : 'follow'} {st.pending.remainingSec.toFixed(1)}s
              </div>
            )}
            {st?.isRecalling && <div className="text-stagespace-conduite text-2xl font-bold mt-2 animate-pulse">RECALLING…</div>}
          </div>
          <div className="text-center min-w-0">
            <div className="text-gray-500 text-xs uppercase tracking-widest mb-1">Next</div>
            <div className="text-3xl font-bold text-gray-300 truncate max-w-[55vw]">{nxt?.label || '—'}</div>
          </div>
          <div className={`${st && st.playingCount > 0 ? 'text-stagespace-live' : 'text-gray-400'} text-xl font-semibold flex items-center gap-2`}>
            {st && st.playingCount > 0 ? `${st.playingCount} moves live` : 'IDLE'}
            {st && st.orphanCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded bg-stagespace-warning/30 text-stagespace-warning text-xs font-bold"
                title={`${st.orphanCount} orphan movement(s) running — no slot controls them. PANIC clears.`}
              >
                +{st.orphanCount} ⚠
              </span>
            )}
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
                className="px-8 py-6 rounded-2xl bg-stagespace-danger/70 hover:bg-stagespace-danger text-white text-2xl font-black active:scale-95"
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
              className="px-8 py-3 rounded-xl bg-stagespace-target hover:opacity-90 text-gray-950 font-bold text-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              title="SETLIST GO — crossfade vers le prochain move de la setlist, les layers continuent. ≠ CUE GO (recall = tue la scène)"
            >
              SETLIST ▶
            </button>
            <span className="text-stagespace-target/80 text-base truncate max-w-[30vw]">
              {st?.nextSetlistName ?? 'fin de setlist'}
            </span>
            {st && st.soloRestoreCount > 0 && (
              <button
                onClick={onUnsolo}
                className="px-4 py-2 rounded-lg bg-stagespace-warning/70 hover:bg-stagespace-warning text-gray-950 text-sm font-bold active:scale-95"
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
              {formatLogLabel(l.label)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConduiteView;
