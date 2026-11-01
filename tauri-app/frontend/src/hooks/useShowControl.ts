/// Show-control OSC `/stagespace/*` — le backend route les commandes
/// parsées via l'évènement `show-control` ; chacune est dispatchée vers
/// la MÊME fonction que le raccourci clavier correspondant (liveActions).
import { useEffect } from 'react';
import { safeListen } from '../utils/tauri';
import { useCuelistStore } from '../store/useCuelistStore';
import { doGo, doCueNext, doCuePrev, doCueRecall, doPanic, doStop, doPark, doUnpark, doArm, doStatus, doSlot, doSlotStop, doSolo, doUnsolo, doSetPosition, doClearPosition, doClearAllPositions, doSetTrackPosition, doSoundcheck } from '../utils/liveActions';
import type { ShowCommand } from '../types/generated/ShowCommand';

interface ShowControlEvent {
  command: ShowCommand;
  from: string;
}

export function useShowControl() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const setup = async () => {
      try {
        const u = await safeListen<ShowControlEvent>('show-control', (event) => {
          const cmd = event.payload.command;
          const from = event.payload.from;
          switch (cmd.command) {
            case 'Go':
              doGo(from);
              break;
            case 'CueNext':
              doCueNext(from);
              break;
            case 'CuePrev':
              doCuePrev(from);
              break;
            case 'CueRecall':
              if (cmd.value != null) doCueRecall(cmd.value[0], cmd.value[1] ?? undefined, from);
              break;
            case 'Slot':
              if (cmd.value != null) doSlot(cmd.value, from);
              break;
            case 'SlotStop':
              if (cmd.value != null) doSlotStop(cmd.value, from);
              break;
            case 'Solo':
              if (cmd.value != null) doSolo(cmd.value, from);
              break;
            case 'Unsolo':
              doUnsolo();
              break;
            case 'Arm':
              doArm(true);
              break;
            case 'Disarm':
              doArm(false);
              break;
            case 'Status':
              doStatus();
              break;
            case 'Park':
              if (cmd.value != null) doPark(cmd.value);
              break;
            case 'Unpark':
              if (cmd.value != null) doUnpark(cmd.value);
              break;
            case 'SetPosition':
              if (cmd.value != null) doSetPosition(cmd.value[0], cmd.value[1], cmd.value[2], cmd.value[3]);
              break;
            case 'ClearPosition':
              if (cmd.value != null) doClearPosition(cmd.value);
              break;
            case 'ClearAllPositions':
              doClearAllPositions();
              break;
            case 'SetTrackPosition':
              if (cmd.value != null) doSetTrackPosition(cmd.value[0], cmd.value[1], cmd.value[2], cmd.value[3]);
              break;
            case 'Panic':
              doPanic();
              break;
            case 'Stop':
              doStop();
              break;
            case 'Timecode':
              if (cmd.value != null) {
                useCuelistStore.getState().handleTimecode(cmd.value);
              }
              break;
            case 'Soundcheck':
              doSoundcheck(cmd.value ?? 'start');
              break;
          }
        });
        if (cancelled) u();
        else unlisten = u;
      } catch {
        // Pas de backend (Vite seul) — silence.
      }
    };
    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
