/// Adapter surface interne — la station de conduite dans la fenêtre
/// principale : lit les stores directement (pas de broadcast), dispatch
/// via les mêmes liveActions que le clavier/OSC/console.
import React from 'react';
import { useCuelistStore } from '../../store/useCuelistStore';
import { useGraphStore } from '../../store/useGraphStore';
import { useShowStatusStore } from '../../store/useShowStatusStore';
import { doArm, doCueNext, doCueRecallById, doPanic, doGo, doUnpark, doUnsolo, doTcChase } from '../../utils/liveActions';
import { detachWindow } from '../../utils/detachWindow';
import { cueLabel, cueMeta, tcStr } from '../../utils/showFormat';
import { computeCueGhosts } from '../cues/CueAuditionRadar';
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
  const armedCueId = useCuelistStore((s) => s.armedCueId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const movements = useGraphStore((s) => s.movements);
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
      meta: cueMeta(c),
      current: i === currentCueIndex,
      next: i === currentCueIndex + 1,
    })),
    pending: pending
      ? { kind: pending.kind, remainingSec: Math.max(0, (pending.deadline - Date.now()) / 1000) }
      : null,
    isRecalling,
    playingCount: moveSlots.filter((m) => m.movementId).length,
    playingNames: moveSlots.filter((m) => m.movementId).map((m) => m.name),
    // Orphelins : backend vivant, aucun slot ne les contrôle — même
    // prédicat que la top bar Jeu.
    orphanCount: movements.filter(
      (mv) => mv.id.startsWith('mv-') && !moveSlots.some((s) => s.movementId === mv.id)
    ).length,
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
    armedCueId,
    // Audition de la cue armée — habite le centre de la conduite (U3) :
    // là où la cue va poser les objets, avant de la tirer.
    audition: (() => {
      const armedCue = armedCueId ? cues.find((c) => c.id === armedCueId) : undefined;
      if (!armedCue) return null;
      const ghosts = computeCueGhosts(armedCue);
      if (ghosts.length === 0) return null;
      return {
        ghosts,
        emitted: Object.values(useGraphStore.getState().emittedPositions),
      };
    })(),
  };

  return (
    <ConduiteView
      st={st}
      onGo={(armed) =>
        armed ? doCueRecallById(armed, undefined, 'conduite') : doCueNext('conduite')
      }
      onPanic={() => doPanic()}
      onArmToggle={() => doArm(!armed)}
      onArmCue={(id) => useCuelistStore.getState().armCue(id)}
      onTcChaseToggle={() => doTcChase(!tcChaseEnabled, 'conduite')}
      onRecallCue={(id) => doCueRecallById(id, undefined, 'conduite')}
      onGoSetlist={() => doGo('conduite')}
      onUnpark={(obj) => doUnpark(obj, 'conduite')}
      onUnsolo={() => doUnsolo('conduite')}
      onDetach={() => detachWindow('conduite', 'STAGESPACE — Conduite', 1100, 720)}
    />
  );
};

export default ConduiteSurface;
