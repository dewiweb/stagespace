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
  tcChaseEnabled: boolean;
  tcActive: boolean;
  tcStr: string;
  nextSetlistName: string | null;
  soloRestoreCount: number;
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
        onRecallCue={(id) => cmd(`recall:${id}`)}
        onGoSetlist={() => cmd('go')}
        onUnpark={(obj) => cmd(`unpark:${obj}`)}
        onUnsolo={() => cmd('unsolo')}
      />
    </div>
  );
};

export default ConduitePage;
