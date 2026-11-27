/// Page conduite détachable — adapter fenêtre secondaire (WebviewWindow
/// "conduite"). Reçoit l'état du thread principal via `conduite:state`,
/// renvoie les commandes par `conduite:cmd`, et lit directement les
/// stores partagés (showLog via l'event `show-log`, parked/armed via
/// useShowStatusStore) — chaque webview a son propre contexte JS mais
/// les events Tauri sont globaux.
import React from 'react';
import { emit } from '@tauri-apps/api/event';
import { safeListen } from '../utils/tauri';
import { useShowStatusStore, startShowStatusPolling } from '../store/useShowStatusStore';
import { useGraphStore } from '../store/useGraphStore';
import { ConduiteView } from '../components/conduite/ConduiteView';
import type { ConduiteViewState } from '../components/conduite/types';

/// Payload broadcasté par useConduiteBroadcast (main window, 500ms).
type BroadcastState = {
  cues: ConduiteViewState['cues'];
  pending: ConduiteViewState['pending'];
  isRecalling: boolean;
  playingCount: number;
  playingNames: string[];
  orphanCount: number;
  tcChaseEnabled: boolean;
  tcActive: boolean;
  tcStr: string;
  nextSetlistName: string | null;
  soloRestoreCount: number;
  armedCueId: string | null;
  audition: ConduiteViewState['audition'];
};

const cmd = (c: string) => void emit('conduite:cmd', c);

export const ConduitePage: React.FC = () => {
  const [bc, setBc] = React.useState<BroadcastState | null>(null);
  const parked = useShowStatusStore((s) => s.parked);
  const consoleAge = useShowStatusStore((s) => s.consoleAge);
  const armed = useShowStatusStore((s) => s.armed);
  const showLog = useGraphStore((s) => s.showLog);

  React.useEffect(() => {
    let un: (() => void) | undefined;
    void safeListen<BroadcastState>('conduite:state', (e) => setBc(e.payload)).then((u) => (un = u));
    startShowStatusPolling();
    return () => { un?.(); };
  }, []);

  // Raccourcis live de la fenêtre FOH — useLiveShortcuts n'est pas monté
  // ici : sans ça, Esc/panic était INOPÉRANT au clavier dans la fenêtre
  // détachée (trou de sécurité U10). Mêmes commandes que la surface
  // interne, routées sur le fil conduite:cmd.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cmd('panic');
      else if (e.key === 'Enter' && e.shiftKey) cmd('next');
      else if (e.key === 'Enter') cmd('go');
      else if (e.key === 'Backspace') { e.preventDefault(); cmd('prev'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const st: ConduiteViewState | null = bc
    ? { ...bc, showLog, armed, parked, consoleAge }
    : null;

  return (
    <div className="h-screen w-screen bg-stagespace-bg" style={{ background: '#0b0d12' }}>
      <ConduiteView
        st={st}
        onGo={(armed) => cmd(armed ? `recall:${armed}` : 'next')}
        onPanic={() => cmd('panic')}
        onArmToggle={() => cmd('arm')}
        onArmCue={(id) => cmd(id ? `armcue:${id}` : 'armcue:none')}
        onTcChaseToggle={() => cmd(`tcchase:${bc?.tcChaseEnabled ? 0 : 1}`)}
        onRecallCue={(id) => cmd(`recall:${id}`)}
        onGoSetlist={() => cmd('go')}
        onUnpark={(obj) => cmd(`unpark:${obj}`)}
        onUnsolo={() => cmd('unsolo')}
      />
    </div>
  );
};

export default ConduitePage;
