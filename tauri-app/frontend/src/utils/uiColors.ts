/// uiColors — pont sémantique couleurs pour les domaines hors thème
/// tailwind (design : docs/color-harmonization.md). Doctrine : la
/// couleur code la FONCTION, jamais l'entité ni le goût.
///
/// Règles de câblage :
///   composants DOM  → classes tokens thème (text-stagespace-warning…)
///   canvas/SVG/three.js → hex exportés d'ICI — la seule duplication
///   hex autorisée du repo, centralisée pour rester en phase avec le
///   thème (tailwind.config.js). Tout hex brut ailleurs est une
///   violation (enforcement H4).

// ── Rôles fonctionnels — mêmes valeurs que le thème ─────────────────
export const UI_HEX = {
  live: '#22c55e',
  conduite: '#f59e0b',
  osc: '#22d3ee',
  warning: '#f97316',
  danger: '#ef4444',
  tracking: '#a855f7',
  dim: '#6b7280',
  target: '#2dd4bf',
  derived: '#94a3b8',
} as const;

// ── Viz — visualisations spatiales (3D/radar) ───────────────────────
/// Les hex three.js/SVG des visualisations : une seule source pour les
/// cercles fantômes, zones, trajectoires. Les variants textuels des
/// labels CSS2D sont dérivés ici aussi (lisibilité sur fond sombre).
export const VIZ = {
  /// Cible/destination — ghosts pose (patché), ancres, projections.
  target: UI_HEX.target,
  targetLabel: '#5eead4', // teal-300 — labels lisibles sur fond noir
  /// Cible invalide — track non patchée : serait skippée au recall.
  /// warning orange, même rôle que le badge ⚠ des panels.
  targetInvalid: UI_HEX.warning,
  targetInvalidLabel: '#fdba74', // orange-300
  /// Zones — graph-déclarées vs manuelles (qui les a créées, une
  /// distinction de provenance = une fonction). Déjà violet/cyan dans
  /// useRenderLoop : valeurs reprises, nommées.
  zoneGraph: '#8b5cf6',
  zoneManual: UI_HEX.osc,
  /// Fantômes au repos — inerte, non-position-live : dim translucide.
  restGhost: UI_HEX.dim,
} as const;

// ── Score — familles fonctionnelles des types de clips ─────────────
/// 24 types ne peuvent pas avoir 24 hues : famille = teinte, intensité
/// = sous-type. Le mapping résout les collisions mesurées (positions/
/// pose teal = désormais la MÊME famille « placement spatial » — la
/// collision devient une cohérence).
export type ClipFamily =
  | 'conduite'   // cue, cueArm, cueGo — transitions de show
  | 'danger'     // panic, stopAll
  | 'placement'  // pose, positions, throw, gesture — placer dans l'espace
  | 'objectControl' // park, unpark, manualClear, attention, solo, unsolo
  | 'graphs'     // modGraph, postGraph, chanMods, zones
  | 'system'     // osc, soundcheck, view
  | 'slot';      // le contenu — moves

export const CLIP_FAMILY_HEX: Record<ClipFamily, string> = {
  conduite: UI_HEX.conduite,
  danger: UI_HEX.danger,
  placement: UI_HEX.target,
  objectControl: '#e879f9', // fuchsia-400 — contrôle doux des objets
  graphs: '#818cf8',        // indigo-400 — pipelines de traitement
  system: UI_HEX.osc,
  slot: '#a78bfa',          // violet-400 — le contenu, neutre
};
