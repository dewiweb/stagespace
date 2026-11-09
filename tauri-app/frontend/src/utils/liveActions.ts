/// Actions live partagées — source unique pour les raccourcis clavier
/// (useLiveShortcuts) et les commandes OSC `/stagespace/*` (useShowControl).
/// Toute action manuelle annule d'abord les timers pre-wait/follow pendus.
///
/// Découpé par domaine (règle modularisation) — ce module reste le point
/// d'import public, les implémentations vivent dans :
///   liveActionsShared.ts     — infra (log, NACK, désarm, routage détachée)
///   liveActionsTransport.ts  — GO setlist, cues, panic, stop
///   liveActionsSlots.ts      — slots busking, solo, macros, TC, arm
///   liveActionsSpatial.ts    — positions, soundcheck, throw, gestes, park
///   liveActionsRehearsal.ts  — répétition, tape, scores
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { feLog } from './tauri';
export * from './liveActionsTransport';
export * from './liveActionsSlots';
export * from './liveActionsSpatial';
export * from './liveActionsRehearsal';

/// `/stagespace/view <surface>` — bascule la surface opérateur depuis
/// un contrôleur externe (atelier|conduite|jeu). Identique au clic
/// sur les onglets surface.
export function doView(v: string | number | null, from?: string): void {
  const surface = String(v);
  if (surface !== 'atelier' && surface !== 'conduite' && surface !== 'jeu') return;
  useMoveEditorStore.getState().setSurface(surface);
  feLog(`[osc-in] /stagespace/view ${surface}${from ? ` (${from})` : ''}`);
}
