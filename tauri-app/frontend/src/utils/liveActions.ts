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
import { useGraphStore } from '../store/useGraphStore';
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

/// `/stagespace/show/load <path.hfg>` — charge un fichier show depuis
/// le disque local (même fonction que le file dialog). Le chemin est
/// celui de la machine qui fait tourner STAGESPACE.
export function doShowLoad(path: string | number | null, from?: string): void {
  const p = String(path);
  if (!p) return;
  feLog(`[osc-in] /stagespace/show/load ${p}${from ? ` (${from})` : ''}`);
  void useGraphStore.getState().loadGraphFromFile(p);
}
