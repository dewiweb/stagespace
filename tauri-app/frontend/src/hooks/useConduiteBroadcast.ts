/// Broadcast de l'état conduite vers la fenêtre détachable.
/// Émet `conduite:state` toutes les 500ms (état computé depuis les
/// stores) et écoute `conduite:cmd` → dispatch vers les mêmes
/// liveActions que le clavier/OSC — sémantique identique partout.
import { useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import { safeListen } from '../utils/tauri';
import { useCuelistStore } from '../store/useCuelistStore';
import { useGraphStore } from '../store/useGraphStore';
import { doCueNext, doCuePrev, doGo, doPanic } from '../utils/liveActions';
import { cueLabel, tcStr } from '../utils/showFormat';


export function useConduiteBroadcast() {
  useEffect(() => {
    const t = setInterval(() => {
      const cs = useCuelistStore.getState();
      const gs = useGraphStore.getState();
      const cur = cs.currentCueIndex >= 0 ? cs.cues[cs.currentCueIndex] : null;
      const next = cs.currentCueIndex + 1 < cs.cues.length ? cs.cues[cs.currentCueIndex + 1] : null;
      const after = cs.currentCueIndex + 2 < cs.cues.length ? cs.cues[cs.currentCueIndex + 2] : null;
      const tcActive = cs.lastTimecode != null && Date.now() - cs.lastTimecodeAt < 1000;
      const tc = tcStr(cs.lastTimecode ?? 0, gs.timecodeFps);
      void emit('conduite:state', {
        curCue: cueLabel(cur, cs.currentCueIndex),
        nextCue: cueLabel(next, cs.currentCueIndex + 1),
        nextNextCue: after ? cueLabel(after, cs.currentCueIndex + 2) : '',
        pending: cs.pending
          ? { kind: cs.pending.kind, remainingSec: Math.max(0, (cs.pending.deadline - Date.now()) / 1000) }
          : null,
        isRecalling: cs.isRecalling,
        playingCount: gs.moveSlots.filter((m) => m.movementId).length,
        tcChaseEnabled: cs.tcChaseEnabled,
        tcActive,
        tcStr: tc,
      }).catch(() => {});
    }, 500);

    let un: (() => void) | undefined;
    // go = GO setlist (crossfade, même action que le gros GO de PerformView) ;
    // next/prev = recall cue — parité avec l'overlay conduite in-app.
    void safeListen<string>('conduite:cmd', (e) => {
      switch (e.payload) {
        case 'go':
          doGo();
          break;
        case 'next':
          doCueNext();
          break;
        case 'prev':
          doCuePrev();
          break;
        case 'panic':
          doPanic();
          break;
      }
    }).then((u) => (un = u));

    return () => { clearInterval(t); un?.(); };
  }, []);
}
