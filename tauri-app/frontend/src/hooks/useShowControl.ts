/// Show-control OSC `/stagespace/*` — le backend route les commandes
/// parsées via l'évènement `show-control` ; chacune est dispatchée vers
/// la MÊME fonction que le raccourci clavier correspondant (liveActions).
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useCuelistStore } from '../store/useCuelistStore';
import { doGo, doCueNext, doCuePrev, doCueRecall, doPanic, doStop, doPark, doUnpark, doArm, doStatus } from '../utils/liveActions';
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
        const u = await listen<ShowControlEvent>('show-control', (event) => {
          const cmd = event.payload.command;
          switch (cmd.command) {
            case 'Go':
              doGo();
              break;
            case 'CueNext':
              doCueNext();
              break;
            case 'CuePrev':
              doCuePrev();
              break;
            case 'CueRecall':
              if (cmd.value != null) doCueRecall(cmd.value[0], cmd.value[1] ?? undefined);
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
