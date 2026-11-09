/// Adapter surface interne — la station de conduite dans la fenêtre
/// principale : lit les stores directement (pas de broadcast), dispatch
/// via les mêmes liveActions que le clavier/OSC/console.
import React from 'react';
import { useCuelistStore } from '../../store/useCuelistStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useShowStatusStore } from '../../store/useShowStatusStore';
import { doArm, doCueNext, doCueRecallById, doPanic, doGo, doUnpark, doUnsolo } from '../../utils/liveActions';
import { cueLabel, tcStr } from '../../utils/showFormat';
import { ConduiteView } from './ConduiteView';
import type { ConduiteViewState } from './types';

export const ConduiteSurface: React.FC = () => {
  const cues = useCuelistStore((s) => s.cues);
  const currentCueIndex = useCuelistStore((s) => s.currentCueIndex);
  const pending = useCuelistStore((s) => s.pending);
  const isRecalling = useCuelistStore((s) => s.isRecalling);
  const tcChaseEnabled = useCuelistStore((s) => s.tcChaseEnabled);
  const lastTimecode = useCuelistStore((s) => s.lastTimecode);
  const lastTimecodeAt = useCuelistStore((s) => s.lastTimecodeAt);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const setlistOrder = useGraphStore((s) => s.setlistOrder);
  const currentSetlistIndex = useGraphStore((s) => s.currentSetlistIndex);
  const soloSavedIds = useGraphStore((s) => s.soloSavedIds);
  const showLog = useGraphStore((s) => s.showLog);
  const timecodeFps = useGraphStore((s) => s.timecodeFps);
  const parked = useShowStatusStore((s) => s.parked);
  const consoleAge = useShowStatusStore((s) => s.consoleAge);
  const armed = useShowStatusStore((s) => s.armed);

  const tcActive = lastTimecode != null && Date.now() - lastTimecodeAt < 1000;
  const st: ConduiteViewState = {
    cues: cues.map((c, i) => ({
      id: c.id,
      label: cueLabel(c, i),
      current: i === currentCueIndex,
      next: i === currentCueIndex + 1,
    })),
    pending: pending
      ? { kind: pending.kind, remainingSec: Math.max(0, (pending.deadline - Date.now()) / 1000) }
      : null,
    isRecalling,
    playingCount: moveSlots.filter((m) => m.movementId).length,
    tcChaseEnabled,
    tcActive,
    tcStr: tcStr(lastTimecode ?? 0, timecodeFps),
    showLog,
    armed,
    parked,
    consoleAge,
    nextSetlistName: (() => {
      const nextId =
        currentSetlistIndex >= 0 && currentSetlistIndex + 1 < setlistOrder.length
          ? setlistOrder[currentSetlistIndex + 1]
          : setlistOrder.length > 0 && currentSetlistIndex < 0
            ? setlistOrder[0]
            : null;
      return nextId ? (moveSlots.find((s) => s.id === nextId)?.name ?? null) : null;
    })(),
    soloRestoreCount: soloSavedIds.length,
  };

  return (
    <ConduiteView
      st={st}
      onGo={(armed) =>
        armed ? doCueRecallById(armed, undefined, 'conduite') : doCueNext('conduite')
      }
      onPanic={() => doPanic()}
      onArmToggle={() => doArm(!armed)}
      onRecallCue={(id) => doCueRecallById(id, undefined, 'conduite')}
      onGoSetlist={() => doGo('conduite')}
      onUnpark={(obj) => doUnpark(obj, 'conduite')}
      onUnsolo={() => doUnsolo('conduite')}
    />
  );
};

export default ConduiteSurface;
