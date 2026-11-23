/// Répétition & enregistrement — rehearsal (bande horodatée rejouée
/// comme cue), tape de positions, scores import/export. Extrait de
/// liveActions.ts.
import { toast } from './toast-helpers';
import { safeInvoke as invoke, silentCatch } from './tauri';
import { rehearsalState, logAction } from './liveActionsShared';
import { doGo, doPanic } from './liveActionsTransport';
import { doSlot, doSlotStop, doSolo, doUnsolo } from './liveActionsSlots';
import {
  doSetPosition, doClearPosition, doThrow, doSpatial, doAttention,
  doSetTrackPosition,
} from './liveActionsSpatial';

/** /stagespace/record <start|stop> · /stagespace/rehearsal <play|clear> —
 *  capture de répétition : enregistre la session busking (commandes
 *  horodatées) et la rejoue comme un cue live.
 *  S1 : l'horloge vit dans le backend (thread + `score-fire`) — le
 *  frontend reste l'exécuteur via cette map. */
const REPLAY: Record<string, (...a: number[]) => void> = {
  doGo: () => doGo(),
  doPanic: () => doPanic(),
  doSlot: (n) => doSlot(n),
  doSlotStop: (n) => doSlotStop(n),
  doSolo: (n) => doSolo(n),
  doUnsolo: () => doUnsolo(),
  doSetPosition: (o, x, y, z) => doSetPosition(o, x, y, z),
  doClearPosition: (o) => doClearPosition(o),
  doThrow: (o, x, y, z) => doThrow(o, x, y, z),
  doSpatial: (k) => doSpatial(k),
  doAttention: (o) => doAttention(o === -1 ? null : o),
  doSetTrackPosition: (t, x, y, z) => doSetTrackPosition(t, x, y, z),
};

/** Point d'entrée unique des entrées tirées par l'horloge backend —
 *  appelé par le listener `score-fire` (hook useScoreTape). */
export function fireScoreEntry(name: string, args: number[]) {
  REPLAY[name]?.(...args);
}

export function doRehearsal(action: string, from?: string) {
  logAction('doRehearsal', from);
  const s = rehearsalState;
  switch (action) {
    case 'record':
      s.recording = true;
      s.t0 = Date.now();
      s.entries = [];
      toast.info('Rehearsal REC — capture du busking');
      break;
    case 'stop':
      s.recording = false;
      // Coupe aussi une lecture en cours — STOP est sans ambiguïté.
      invoke('score_stop').catch(silentCatch);
      // Persiste la dernière prise — la partition survit au reload.
      try {
        localStorage.setItem('stagespace:diffusion-score', JSON.stringify(s.entries));
      } catch { /* storage full — non critique */ }
      toast.info(`Rehearsal STOP — ${s.entries.length} commandes capturées`);
      break;
    case 'play': {
      if (s.entries.length === 0) { toast.warning('Rehearsal vide'); return; }
      // L'horloge est backend (déterministe, survit au reload webview) —
      // le frontend reste l'exécuteur via `score-fire` → fireScoreEntry.
      // recording off pendant le replay — sinon la bande s'auto-écrit.
      const wasRecording = s.recording;
      s.recording = false;
      invoke('score_load', { entries: s.entries })
        .then(() => invoke('score_play'))
        .then(() => toast.info(`Score PLAY — ${s.entries.length} commandes`))
        .catch((e) => {
          s.recording = wasRecording;
          toast.error('Score play failed: ' + e);
        });
      // Restaure le flag record en fin de bande — durée max = dernière entrée.
      const last = s.entries.reduce((m, e) => Math.max(m, e.t), 0);
      setTimeout(() => { s.recording = wasRecording; }, last + 100);
      break;
    }
    case 'clear':
      s.entries = [];
      invoke('score_clear').catch(silentCatch);
      break;
    case 'load':
      // Charge la partition persistée (dernier record ou score importé).
      try {
        const raw = localStorage.getItem('stagespace:diffusion-score');
        if (raw) {
          s.entries = JSON.parse(raw);
          toast.info(`Score chargé — ${s.entries.length} commandes`);
        } else {
          toast.warning('Aucun score sauvegardé');
        }
      } catch { toast.error('Score invalide'); }
      break;
  }
}

/** Diffusion score — export/import de la partition (JSON). Le score =
 *  la bande rehearsal sérialisée : capturé OU autorisé, sauvegardé,
 *  joué — la partition acousmatique de la conduite A. */
export function scoreExport() {
  const raw = localStorage.getItem('stagespace:diffusion-score');
  if (!raw) { toast.warning('Aucun score à exporter'); return; }
  const blob = new Blob([raw], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diffusion-score.sscore.json';
  a.click();
  URL.revokeObjectURL(a.href);
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

export function scoreImport(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const entries = JSON.parse(reader.result as string);
      if (!Array.isArray(entries)) throw new Error('not a tape');
      localStorage.setItem('stagespace:diffusion-score', JSON.stringify(entries));
      rehearsalState.entries = entries;
      toast.info(`Score importé — ${entries.length} commandes`);
    } catch {
      toast.error('Score invalide');
    }
  };
  reader.readAsText(file);
}
