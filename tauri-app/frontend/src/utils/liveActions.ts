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
export * from './liveActionsTransport';
export * from './liveActionsSlots';
export * from './liveActionsSpatial';
export * from './liveActionsRehearsal';
