/// Recorder → Score : convertit une prise rehearsal (`RecEntry` —
/// actions busking horodatées + refs typées capturées à l'enregistrement)
/// en clips et courbes de la timeline. Un vrai recorder de séquenceur :
/// les refs vivantes (slot/cue) sont préservées — rejouer la prise
/// rejoue les ENTITÉS, pas un snapshot opaque de la commande.
import type { RecEntry } from './liveActionsShared';
import type { ScoreClipRef, ScoreKeyframe } from '../store/useScoreStore';
import { useCuelistStore } from '../store/useCuelistStore';

export interface RecordedScoreClip {
  ref: ScoreClipRef;
  startMs: number;
  durationMs?: number;
  trackIds?: number[];
}
export interface RecordedScore {
  clips: RecordedScoreClip[];
  /// Points GLOBALFX — param macro → keyframes (interpolés au play).
  globalFx: Record<string, ScoreKeyframe[]>;
  /// Points SPATIALFX — `spatial` (compresseur global).
  spatialFx: Record<string, ScoreKeyframe[]>;
  /// Trajectoires capturées — laneId `obj-<trackId>` → `pos.<axis>` →
  /// keyframes. Un drag enregistré devient une courbe éditable (pas
  /// un clip figé) — le vrai gain du recorder→partition.
  objectCurves: Record<string, Record<string, ScoreKeyframe[]>>;
  /// Actions non convertibles (config système etc.) — signalées à
  /// l'opérateur, jamais silencieusement perdues.
  skipped: string[];
}

export function recordingToScore(entries: RecEntry[]): RecordedScore {
  const clips: RecordedScoreClip[] = [];
  const globalFx: Record<string, ScoreKeyframe[]> = {};
  const spatialFx: Record<string, ScoreKeyframe[]> = {};
  const objectCurves: RecordedScore['objectCurves'] = {};
  const skipped: string[] = [];
  /// Slots en cours → index dans `clips` (appariement ouvert/fermé).
  const open = new Map<string, number>();
  const lastT = entries.reduce((m, e) => Math.max(m, e.t), 0);

  const closeSlot = (slotId: string, t: number) => {
    const i = open.get(slotId);
    if (i !== undefined) {
      clips[i].durationMs = Math.max(1, t - clips[i].startMs);
      open.delete(slotId);
    }
  };
  const closeAll = (t: number) => {
    for (const id of [...open.keys()]) closeSlot(id, t);
  };
  const addPoint = (
    map: Record<string, ScoreKeyframe[]>,
    param: string,
    t: number,
    v: number,
  ) => {
    (map[param] ??= []).push({ t, v, interp: 'linear' });
  };

  for (const e of entries) {
    const r = e.ref ?? {};
    switch (e.name) {
      case 'doSlot':
        if (r.slotId) {
          closeSlot(r.slotId, e.t); // re-trigger = redémarrage net
          open.set(r.slotId, clips.length);
          clips.push({ ref: { type: 'slot', slotId: r.slotId }, startMs: e.t });
        } else skipped.push(`slot ${e.args[0]}`);
        break;
      case 'doSlotStop':
        if (r.slotId) closeSlot(r.slotId, e.t);
        break;
      case 'doGo':
      case 'doSolo':
        // GO et solo = stop all + play — même résultat sur la timeline.
        closeAll(e.t);
        if (r.slotId) {
          open.set(r.slotId, clips.length);
          clips.push({ ref: { type: 'slot', slotId: r.slotId }, startMs: e.t });
        }
        break;
      case 'doUnsolo':
        for (const id of r.slotIds ?? []) {
          if (open.has(id)) continue;
          open.set(id, clips.length);
          clips.push({ ref: { type: 'slot', slotId: id }, startMs: e.t });
        }
        break;
      case 'doPanic':
        closeAll(e.t);
        clips.push({ ref: { type: 'panic' }, startMs: e.t });
        break;
      case 'doStop':
        closeAll(e.t);
        clips.push({ ref: { type: 'stopAll' }, startMs: e.t });
        break;
      case 'doCueNext':
      case 'doCuePrev':
      case 'doCueRecall':
      case 'doCueRecallById': {
        if (!r.cueId) {
          skipped.push(`${e.name} (cue introuvable à l'enregistrement)`);
          break;
        }
        // Une cue Full tue les moves non listés — les clips ouverts se
        // ferment au moment du recall. Tracking préserve les moves non
        // listés : les clips ouverts restent ouverts (même sémantique
        // runtime — les moves cue remplacent juste les objets couverts).
        const cue = useCuelistStore.getState().cues.find((c) => c.id === r.cueId);
        if (cue?.mode !== 'Tracking') closeAll(e.t);
        clips.push({ ref: { type: 'cue', cueId: r.cueId }, startMs: e.t });
        break;
      }
      case 'doSetPosition': {
        const pos = r.positions ?? {};
        const tids = Object.keys(pos).map(Number).filter(Number.isFinite);
        if (tids.length === 0) {
          skipped.push(`position obj ${e.args[0]}`);
          break;
        }
        // Positions → courbes `pos.<axis>` : une rafale (drag) devient
        // une trajectoire lisse, un placement isolé un point constant —
        // même sémantique que le takeover manuel, mais éditable.
        for (const tid of tids) {
          const p = pos[tid];
          if (!p) continue;
          const lane = objectCurves[`obj-${tid}`] ??= {};
          (lane['pos.x'] ??= []).push({ t: e.t, v: p[0], interp: 'linear' });
          (lane['pos.y'] ??= []).push({ t: e.t, v: p[1], interp: 'linear' });
          (lane['pos.z'] ??= []).push({ t: e.t, v: p[2], interp: 'linear' });
        }
        break;
      }
      case 'doClearPosition':
        clips.push({
          ref: { type: 'manualClear' },
          startMs: e.t,
          trackIds: r.trackId !== null && r.trackId !== undefined ? [r.trackId] : undefined,
        });
        break;
      case 'doPark':
        clips.push({
          ref: { type: 'park' },
          startMs: e.t,
          trackIds: r.trackId !== null && r.trackId !== undefined ? [r.trackId] : undefined,
        });
        break;
      case 'doUnpark':
        clips.push({
          ref: { type: 'unpark' },
          startMs: e.t,
          trackIds: r.trackId !== null && r.trackId !== undefined ? [r.trackId] : undefined,
        });
        break;
      case 'doThrow':
        clips.push({
          ref: { type: 'throw', vel: r.vel ?? [0, 0, 0] },
          startMs: e.t,
          trackIds: r.trackId !== null && r.trackId !== undefined ? [r.trackId] : undefined,
        });
        break;
      case 'doAttention':
        clips.push({
          ref: { type: 'attention' },
          startMs: e.t,
          trackIds: r.trackId !== null && r.trackId !== undefined ? [r.trackId] : undefined,
        });
        break;
      case 'doGesture': {
        const name = r.macro ?? '';
        if (name === 'explode' || name === 'converge' || name === 'orbit' || name === 'front') {
          clips.push({
            ref: { type: 'gesture', name, strength: r.strength ?? 3 },
            startMs: e.t,
          });
        } else skipped.push(`gesture ${name}`);
        break;
      }
      case 'doMacro':
        if (r.macro) addPoint(globalFx, r.macro, e.t, e.args[0] ?? 0);
        else skipped.push('macro');
        break;
      case 'doSpatial':
        addPoint(spatialFx, 'spatial', e.t, e.args[0] ?? 1);
        break;
      default:
        skipped.push(e.name);
    }
  }
  // Fin de prise : les moves encore ouverts se ferment au dernier
  // événement (le STOP de l'opérateur est la fin du take).
  closeAll(lastT);
  return { clips, globalFx, spatialFx, objectCurves, skipped };
}
