/// Recorder du séquenceur Score — la prise busking est matérialisée
/// en clips/courbes de la timeline (refs vivantes). Tape de positions
/// (flux 30 Hz, renderer externe). Extrait de liveActions.ts.
import { toast } from './toast-helpers';
import { safeInvoke as invoke } from './tauri';
import { rehearsalState, logAction } from './liveActionsShared';
import { recordingToScore } from './recordingToScore';
import { useScoreStore, GLOBALFX_LANE, SPATIALFX_LANE } from '../store/useScoreStore';

/** /stagespace/record <start|stop> · /stagespace/rehearsal <play|clear> —
 *  Recorder du séquenceur : capture la session busking (commandes
 *  horodatées + refs typées) puis la MATÉRIALISE en clips/courbes de la
 *  timeline Score — pas de tape parallèle : la prise devient de la
 *  partition éditable (Conduite → Score → réédition → re-jeu). */
export function doRehearsal(action: string, from?: string) {
  logAction('doRehearsal', from);
  const s = rehearsalState;
  switch (action) {
    case 'record':
      s.recording = true;
      s.t0 = Date.now();
      s.entries = [];
      toast.info('Score REC — capture du busking en cours');
      break;
    case 'stop': {
      const wasRecording = s.recording;
      s.recording = false;
      // STOP est sans ambiguïté : hors enregistrement il coupe la
      // lecture score ; en enregistrement il clôt la prise.
      if (!wasRecording) {
        useScoreStore.getState().stopScore();
        return;
      }
      const take = recordingToScore(s.entries);
      s.entries = [];
      if (take.clips.length === 0 && Object.keys(take.globalFx).length === 0
          && Object.keys(take.spatialFx).length === 0
          && Object.keys(take.objectCurves).length === 0) {
        toast.warning('Prise vide — rien de capturé');
        return;
      }
      // La prise s'ajoute en fin de partition — une section de plus,
      // éditable immédiatement (déliage, quantize, retarget…).
      const sc = useScoreStore.getState();
      const base = sc.durationMs > 0 ? sc.durationMs + 500 : 0;
      let end = base;
      for (const c of take.clips) {
        sc.addClip(c.ref, base + c.startMs, {
          durationMs: c.durationMs,
          trackIds: c.trackIds,
        });
        end = Math.max(end, base + c.startMs + (c.durationMs ?? 0));
      }
      const mergeKfs = (
        lane: string, param: string, kfs: { t: number; v: number; interp?: 'linear'|'step'|'smooth' }[],
        cur: Record<string, { t: number; v: number; interp?: 'linear'|'step'|'smooth' }[]> | undefined,
      ) => {
        const existing = cur?.[param] ?? [];
        sc.setLaneCurve(lane, param, [...existing, ...kfs.map((k) => ({ ...k, t: k.t + base }))]);
      };
      for (const [param, kfs] of Object.entries(take.globalFx)) {
        mergeKfs(GLOBALFX_LANE, param, kfs, sc.globalFxCurves);
      }
      for (const [param, kfs] of Object.entries(take.spatialFx)) {
        mergeKfs(SPATIALFX_LANE, param, kfs, sc.spatialFxCurves);
      }
      // Trajectoires capturées — merge par lane objet (`obj-<trackId>`).
      for (const [laneId, params] of Object.entries(take.objectCurves)) {
        for (const [param, kfs] of Object.entries(params)) {
          mergeKfs(laneId, param, kfs, sc.objectCurves?.[laneId]);
        }
      }
      sc.setDurationMs(end + 1000);
      const skippedNote = take.skipped.length
        ? ` — ${take.skipped.length} action(s) ignorée(s) : ${take.skipped.slice(0, 3).join(', ')}${take.skipped.length > 3 ? '…' : ''}`
        : '';
      toast.info(`Prise matérialisée — ${take.clips.length} clip(s) dans la partition${skippedNote}`);
      break;
    }
    case 'play':
      void useScoreStore.getState().playScore();
      break;
    case 'clear':
      useScoreStore.getState().clearScore();
      toast.info('Partition vidée');
      break;
  }
}

/** Position stream tape — enregistre les positions émises à ~30Hz et
 *  rejoue le flux pour un bounce/renderer externe (binaural côté
 *  renderer — STAGESPACE ne rend pas l'audio). */
export function doTape(action: 'record' | 'stop' | 'play' | 'export', from?: string) {
  logAction('doTape', from);
  if (action === 'record' || action === 'stop') {
    const on = action === 'record';
    invoke('set_pos_tape_record', { on })
      .then(() => toast.info(on ? 'Tape REC — positions @30Hz' : 'Tape STOP'))
      .catch((e) => toast.error('Tape failed: ' + e));
  } else if (action === 'export') {
    invoke<string>('get_pos_tape').then((json) => {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'position-tape.sstape.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }).catch((e) => toast.error('Tape export failed: ' + e));
  } else {
    invoke<string>('get_pos_tape').then((json) =>
      invoke('play_pos_tape', { json })
    ).then(() => toast.info('Tape PLAY — flux injecté au rythme réel'))
     .catch((e) => toast.error('Tape play failed: ' + e));
  }
}

export function tapeImport(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    invoke('play_pos_tape', { json: reader.result as string })
      .then(() => toast.info('Tape importée — lecture'))
      .catch((e) => toast.error('Tape invalide: ' + e));
  };
  reader.readAsText(file);
}

