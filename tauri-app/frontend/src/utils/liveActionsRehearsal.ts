/// Répétition & enregistrement — rehearsal (bande horodatée rejouée
/// comme cue), tape de positions, scores import/export. Extrait de
/// liveActions.ts.
import { toast } from './toast-helpers';
import { safeInvoke as invoke } from './tauri';
import { rehearsalState, logAction } from './liveActionsShared';
import { doGo, doPanic } from './liveActionsTransport';
import { doSlot, doSlotStop, doSolo, doUnsolo } from './liveActionsSlots';
import {
  doSetPosition, doClearPosition, doThrow, doSpatial, doAttention,
  doSetTrackPosition,
} from './liveActionsSpatial';

/** /stagespace/record <start|stop> · /stagespace/rehearsal <play|clear> —
 *  capture de répétition : enregistre la session busking (commandes
 *  horodatées) et la rejoue comme un cue live. */
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
      // Persiste la dernière prise — la partition survit au reload.
      try {
        localStorage.setItem('stagespace:diffusion-score', JSON.stringify(s.entries));
      } catch { /* storage full — non critique */ }
      toast.info(`Rehearsal STOP — ${s.entries.length} commandes capturées`);
      break;
    case 'play': {
      if (s.entries.length === 0) { toast.warning('Rehearsal vide'); return; }
      // Rejoue la bande sur ses timestamps (une chaîne de setTimeout).
      // recording off pendant le replay — sinon la bande s'auto-écrit.
      const wasRecording = s.recording;
      s.recording = false;
      let delay = 0;
      // Une bande déjà en cours doit être arrêtée AVANT d'armer la
      // nouvelle — remplacer playTimers sans clearTimeout perdait les
      // références et la première bande continuait de tirer (revue M7).
      s.playTimers.forEach(clearTimeout);
      // Tous les timers sont trackés — 'clear' doit pouvoir tout annuler
      // (un seul playTimer écrasé = la bande continuait de tirer).
      s.playTimers = s.entries.map((e) => {
        delay = e.t;
        return setTimeout(() => REPLAY[e.name]?.(...e.args), e.t);
      });
      s.playTimers.push(
        setTimeout(() => {
          s.recording = wasRecording;
          toast.info('Rehearsal fini');
        }, delay + 100),
      );
      break;
    }
    case 'clear':
      s.entries = [];
      s.playTimers.forEach(clearTimeout);
      s.playTimers = [];
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
