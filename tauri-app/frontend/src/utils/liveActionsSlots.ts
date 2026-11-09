/// Slots busking — play/stop/solo/unsolo par slot, macros globales,
/// timecode chase/fps, arm OSC. Extrait de liveActions.ts.
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { toast } from './toast-helpers';
import { safeInvoke as invoke } from './tauri';
import {
  logAction, rec, disarmPending, routeDetached, nack, recallBusy,
} from './liveActionsShared';

/// Alias OSC → clés macros du store (tolérant aux variantes consoles).
const MACRO_KEYS: Record<string, string> = {
  speed: 'speed', scale: 'scale',
  shiftx: 'shiftX', shifty: 'shiftY', shiftz: 'shiftZ',
  shift_x: 'shiftX', shift_y: 'shiftY', shift_z: 'shiftZ',
  yaw: 'yaw', pitch: 'pitch', roll: 'roll',
  radius: 'radius_scale', radius_scale: 'radius_scale',
  height: 'height_offset', height_offset: 'height_offset',
};

/** /stagespace/macro <name> <v> — macro globale depuis le fil (fader console). */
export async function doMacro(name: string, v: number, from?: string) {
  if (routeDetached(`macro:${name}:${v}`)) return;
  logAction('doMacro', from);
  const key = MACRO_KEYS[name.toLowerCase()];
  if (!key) {
    nack(from, `unknown-macro: ${name}`);
    return;
  }
  const st = useGraphStore.getState();
  st.setMacros({ [key]: v } as Record<string, number>);
  await st.pushMacrosToRuntime();
}

/** /stagespace/timecode/chase <0|1> — chase TC on/off. */
export function doTcChase(on: boolean, from?: string) {
  if (routeDetached(`tcchase:${on ? 1 : 0}`)) return;
  logAction('doTcChase', from);
  useCuelistStore.getState().setTcChaseEnabled(on);
}

/** /stagespace/timecode/fps <n> — fps du format HH:MM:SS:FF. */
export async function doTcFps(fps: number, from?: string) {
  if (routeDetached(`tcfps:${fps}`)) return;
  logAction('doTcFps', from);
  await invoke('set_timecode_fps', { fps }).catch((e) => toast.error('TC fps failed: ' + e));
}

/** Arm/disarm OSC — dry-run pilotable depuis la console (set_osc_armed). */
export function doArm(armed: boolean, from?: string) {
  logAction('doArm', from);
  invoke('set_osc_armed', { armed }).catch((e) => toast.error('OSC arm failed: ' + e));
}

/** /stagespace/slot <n> — joue le slot n (index 1-based, busking). */
export function doSlot(n: number, from?: string) {
  if (routeDetached(`slot:${n}`)) return;
  logAction('doSlot', from);
  rec('doSlot', [n]);
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un slot tiré pendant un recall serait tué par la désactivation du
  // recall — rejet explicite plutôt qu'un tir orphelin.
  if (recallBusy(from)) return;
  disarmPending();
  void gs.playSlot(slot.id);
}

/** /stagespace/slot/stop <n> — coupe le slot n avec son fade_out. */
export function doSlotStop(n: number, from?: string) {
  if (routeDetached(`slotstop:${n}`)) return;
  logAction('doSlotStop', from);
  rec('doSlotStop', [n]);
  const gs = useGraphStore.getState();
  const slot = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!slot) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  // Un stop pendant un recall peut tuer un move que le recall vient de
  // respawner — même garde que doSlot.
  if (recallBusy(from)) return;
  if (slot.movementId) {
    disarmPending();
    void gs.stopSlotWithFade(slot.id, slot.fadeOut ?? 1);
  }
}

/** /stagespace/solo <n> — coupe les autres slots puis joue n. */
/// Ids des slots à restaurer après le dernier solo (vide = pas de solo actif).
/// Vit dans le slice (soloSavedIds) — pas un module-level caché.
export function getSoloRestoreIds(): string[] {
  return useGraphStore.getState().soloSavedIds;
}

export function doSolo(n: number, from?: string) {
  if (routeDetached(`solo:${n}`)) return;
  logAction('doSolo', from);
  rec('doSolo', [n]);
  const gs = useGraphStore.getState();
  // Un n hors oscIndex = not-found, jamais le slot n-1 (mauvais objet tiré).
  const target = gs.moveSlots.find((s) => s.oscIndex === n);
  if (!target) {
    nack(from, `not-found: slot '${n}'`);
    return void toast.warning(`Slot '${n}' not found`);
  }
  if (recallBusy(from)) return;
  disarmPending();
  // Sauvegarde des autres slots jouants — un solo n'est jamais une
  // fin en soi, l'opérateur voudra souvent revenir au mix d'avant.
  useGraphStore.setState({ soloSavedIds: gs.moveSlots.filter((s) => s.id !== target.id && s.movementId).map((s) => s.id) });
  for (const s of gs.moveSlots) {
    if (s.id !== target.id && s.movementId) void gs.stopSlotWithFade(s.id, s.fadeOut ?? 1);
  }
  void gs.playSlot(target.id);
}

/** /stagespace/unsolo — rejoue les slots stoppés par le dernier solo. */
export function doUnsolo(from?: string) {
  if (routeDetached('unsolo')) return;
  logAction('doUnsolo', from);
  // Un recall vient peut-être de tuer ces moves — rejouer maintenant
  // ressusciterait des slots que la cue voulait morts.
  if (recallBusy(from)) return;
  disarmPending();
  const gs = useGraphStore.getState();
  const ids = gs.soloSavedIds;
  useGraphStore.setState({ soloSavedIds: [] });
  for (const id of ids) {
    const slot = gs.moveSlots.find((s) => s.id === id);
    if (slot && !slot.movementId) void gs.playSlot(id);
  }
}
