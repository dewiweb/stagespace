/// Broadcast de l'état conduite vers la fenêtre détachable.
/// Émet `conduite:state` toutes les 500ms (état computé depuis les
/// stores) et écoute `conduite:cmd` → dispatch vers les mêmes
/// liveActions que le clavier/OSC — sémantique identique partout.
import { useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import { safeListen } from '../utils/tauri';
import { useCuelistStore } from '../store/useCuelistStore';
import { useGraphStore } from '../store/useGraphStore';
import { doArm, doCueNext, doCuePrev, doCueRecall, doCueRecallById, doCueArm, doCueGo, doGo, doMacro, doTcChase, doTcFps, doPanic, doSlot, doSlotStop, doSolo, doUnsolo, doUnpark } from '../utils/liveActions';
import { useShowStatusStore } from '../store/useShowStatusStore';
import { cueLabel, tcStr } from '../utils/showFormat';


export function useConduiteBroadcast() {
  useEffect(() => {
    const t = setInterval(() => {
      const cs = useCuelistStore.getState();
      const gs = useGraphStore.getState();
      const tcActive = cs.lastTimecode != null && Date.now() - cs.lastTimecodeAt < 1000;
      const tc = tcStr(cs.lastTimecode ?? 0, gs.timecodeFps);
      void emit('conduite:state', {
        cues: cs.cues.map((c, i) => ({
          id: c.id,
          label: cueLabel(c, i),
          current: i === cs.currentCueIndex,
          next: i === cs.currentCueIndex + 1,
        })),
        pending: cs.pending
          ? { kind: cs.pending.kind, remainingSec: Math.max(0, (cs.pending.deadline - Date.now()) / 1000) }
          : null,
        isRecalling: cs.isRecalling,
        playingCount: gs.moveSlots.filter((m) => m.movementId).length,
        tcChaseEnabled: cs.tcChaseEnabled,
        tcActive,
        tcStr: tc,
        nextSetlistName: (() => {
          const nextId =
            gs.currentSetlistIndex >= 0 && gs.currentSetlistIndex + 1 < gs.setlistOrder.length
              ? gs.setlistOrder[gs.currentSetlistIndex + 1]
              : gs.setlistOrder.length > 0 && gs.currentSetlistIndex < 0
                ? gs.setlistOrder[0]
                : null;
          return nextId ? (gs.moveSlots.find((s) => s.id === nextId)?.name ?? null) : null;
        })(),
        soloRestoreCount: gs.soloSavedIds.length,
      }).catch(() => {});
    }, 500);

    let un: (() => void) | undefined;
    // go = GO setlist (crossfade, même action que le gros GO de PerformView) ;
    // next/prev = recall cue — parité avec l'overlay conduite in-app.
    void safeListen<string>('conduite:cmd', (e) => {
      const p = e.payload;
      if (p.startsWith('recall:')) {
        doCueRecallById(p.slice(7), undefined, 'conduite-window');
        return;
      }
      if (p.startsWith('cue:')) {
        doCueRecall(p.slice(4), undefined, 'conduite-window');
        return;
      }
      if (p.startsWith('slotstop:')) {
        doSlotStop(Number(p.slice(9)), 'conduite-window');
        return;
      }
      if (p.startsWith('slot:')) {
        doSlot(Number(p.slice(5)), 'conduite-window');
        return;
      }
      if (p.startsWith('solo:')) {
        doSolo(Number(p.slice(5)), 'conduite-window');
        return;
      }
      if (p.startsWith('cuearm:')) {
        doCueArm(p.slice(7), 'conduite-window');
        return;
      }
      if (p.startsWith('unpark:')) {
        doUnpark(Number(p.slice(7)), 'conduite-window');
        return;
      }
      if (p.startsWith('macro:')) {
        const [name, v] = p.slice(6).split(':');
        void doMacro(name, Number(v), 'conduite-window');
        return;
      }
      if (p.startsWith('tcchase:')) {
        doTcChase(p.endsWith('1'), 'conduite-window');
        return;
      }
      if (p.startsWith('tcfps:')) {
        void doTcFps(Number(p.slice(6)), 'conduite-window');
        return;
      }
      switch (p) {
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
        case 'arm':
          doArm(!useShowStatusStore.getState().armed);
          break;
        case 'unsolo':
          doUnsolo('conduite-window');
          break;
        case 'cuego':
          doCueGo('conduite-window');
          break;
      }
    }).then((u) => (un = u));

    return () => { clearInterval(t); un?.(); };
  }, []);
}
