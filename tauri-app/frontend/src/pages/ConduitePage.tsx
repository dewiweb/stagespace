/// Page conduite détachable — affichage dumb-view pour la fenêtre
/// secondaire (WebviewWindow "conduite"). Reçoit l'état du thread
/// principal via `conduite:state`, renvoie les commandes par
/// `conduite:cmd`, et interroge l'IPC directement (parked, console age,
/// osc_armed) — chaque webview a son propre contexte JS.
import React from 'react';
import { emit } from '@tauri-apps/api/event';
import { safeListen } from '../utils/tauri';
import { useShowStatusStore, startShowStatusPolling } from '../store/useShowStatusStore';
import { StatusChip } from '../components/ui/StatusChip';
import { ShowTransport } from '../components/show/ShowTransport';

type ConduiteState = {
  curCue: string;
  nextCue: string;
  nextNextCue: string;
  pending: { kind: string; remainingSec: number } | null;
  isRecalling: boolean;
  playingCount: number;
  tcChaseEnabled: boolean;
  tcActive: boolean;
  tcStr: string;
};

const cmd = (c: string) => void emit('conduite:cmd', c);

export const ConduitePage: React.FC = () => {
  const [st, setSt] = React.useState<ConduiteState | null>(null);
  // État de santé show — poll unique partagé (useShowStatusStore).
  const parked = useShowStatusStore((s) => s.parked);
  const consoleAge = useShowStatusStore((s) => s.consoleAge);
  const armed = useShowStatusStore((s) => s.armed);

  React.useEffect(() => {
    let un: (() => void) | undefined;
    void safeListen<ConduiteState>('conduite:state', (e) => setSt(e.payload)).then((u) => (un = u));
    startShowStatusPolling();
    return () => { un?.(); };
  }, []);

  return (
    <div className="h-screen w-screen bg-stagespace-bg flex flex-col select-none" style={{ background: '#0b0d12' }}>
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
        <span className="text-gray-400 text-sm uppercase tracking-widest">Conduite — STAGESPACE</span>
        <div className="flex items-center gap-5">
          {!armed && (
            <StatusChip variant="warning" pulse className="text-xl px-3 py-1.5">DRY-RUN</StatusChip>
          )}
          {parked.length > 0 && (
            <StatusChip variant="osc" className="text-xl px-3 py-1.5" title={`Objets parkés : ${parked.join(', ')}`}>{parked.length} PARKED</StatusChip>
          )}
          {consoleAge !== null && (
            <StatusChip variant={consoleAge < 5 ? 'live' : 'dim'} className="text-xl px-3 py-1.5">
              CONSOLE {consoleAge < 5 ? '●' : '○'}
            </StatusChip>
          )}
          {st?.tcChaseEnabled && (
            <span className={`font-mono text-3xl font-bold ${st.tcActive ? 'text-emerald-400' : 'text-gray-600'}`}>
              {st.tcActive ? st.tcStr : 'TC lost'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
        <div className="text-center">
          <div className="text-gray-500 text-lg uppercase tracking-widest mb-2">Now</div>
          <div className="text-6xl font-black text-amber-300 truncate max-w-[80vw]">{st?.curCue || '—'}</div>
          {st?.pending && (
            <div className="text-orange-400 text-3xl font-bold mt-3 animate-pulse">
              {st.pending.kind === 'pre_wait' ? 'pré-attente' : 'follow'} {st.pending.remainingSec.toFixed(1)}s
            </div>
          )}
          {st?.isRecalling && <div className="text-purple-400 text-3xl font-bold mt-3 animate-pulse">RECALLING…</div>}
        </div>
        <div className="text-center">
          <div className="text-gray-500 text-sm uppercase tracking-widest mb-1">Next</div>
          <div className="text-4xl font-bold text-gray-300 truncate max-w-[70vw]">{st?.nextCue || '—'}</div>
          {st?.nextNextCue && <div className="text-xl text-gray-600 truncate max-w-[60vw] mt-1">then {st.nextNextCue}</div>}
        </div>
        <div className="text-green-400/90 text-2xl font-semibold">
          {st && st.playingCount > 0 ? `${st.playingCount} moves live` : 'IDLE'}
        </div>
      </div>

      <div className="flex items-center justify-center gap-6 px-8 pb-10">
        <ShowTransport
          onPrev={() => cmd('prev')}
          onGo={() => cmd('go')}
          onNext={() => cmd('next')}
          prevDisabled={!!st?.isRecalling}
          nextDisabled={!!st?.isRecalling}
          panic={
            <button onClick={() => cmd('panic')} className="px-8 py-6 rounded-2xl bg-red-800 hover:bg-red-700 text-red-100 text-2xl font-black active:scale-95">PANIC</button>
          }
        />
      </div>
    </div>
  );
};

export default ConduitePage;
