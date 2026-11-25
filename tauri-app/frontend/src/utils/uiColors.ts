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
  /// Cible/destination — ghosts pose (patché), ancres, prédictions
  /// (flèche du lancer, trajectoires dessinées).
  target: UI_HEX.target,
  targetLabel: '#5eead4', // teal-300 — labels lisibles sur fond noir
  /// Cible invalide — track non patchée : serait skippée au recall.
  /// warning orange, même rôle que le badge ⚠ des panels.
  targetInvalid: UI_HEX.warning,
  targetInvalidLabel: '#fdba74', // orange-300
  /// Zones — graph-déclarées vs manuelles (qui les a créées, une
  /// distinction de provenance = une fonction).
  zoneGraph: '#8b5cf6',
  zoneManual: UI_HEX.osc,
  /// Fantômes au repos — inerte, non-position-live : dim translucide.
  restGhost: UI_HEX.dim,
  /// Labels discrets lisibles sur fond sombre (radar, hol markers).
  dimLabel: '#9ca3af',   // gray-400
  faintLabel: '#4b5563', // gray-600 — annotations fines (axes, numéros)
  /// Label d'objet 3D — identifiant principal, plus lumineux que dim.
  objLabel: '#d1d5db',   // gray-300
  /// Anneau de sélection neutre — pas une fonction, un accent blanc.
  selRing: '#ffffff',
  /// Grille du radar 2D — décor structurel.
  radarGrid: '#1f2937',
  /// Fallback identité track sans couleur hol — neutre par défaut.
  trackFallback: '#888888',

  /// Environnement scène 3D — décor structurel (fond, lumières, grilles),
  /// aucune fonction : centralisé pour rester cohérent avec le thème.
  env: {
    bg: '#0a0a0f',           // fond + brouillard
    ambient: '#404060',
    key: '#ffffff',          // lumière directionnelle principale
    fill: '#6080ff',         // contre-jour bleuté
    gridMajor: '#333344',
    gridMinor: '#1a1a2e',
    /// Grille du plan de travail (draw) — accent osc existant.
    workplaneMajor: '#22d3ee',
    workplaneMinor: '#16303e',
  },

  /// États objets — emissives/materials du render loop. Chaque valeur
  /// code un état fonctionnel, pas une préférence.
  obj: {
    off: '#000000',            // pas d'émission
    drag: '#446688',           // membre en cours de drag
    preview: '#94a3b8',        // track couverte par un move preview — derived (projeté, rien ne sort)
    previewEmissive: '#1e293b',
    selected: '#555555',       // sélection (clic proximité / manipulate)
    hot: '#664400',            // track du move sélectionné
    assignMember: '#1a5c2e',   // membre du slot édité (mode assign)
  },

  /// Tracé/spline (draw) — le geste utilisateur vs la courbe calculée.
  draw: {
    stroke: '#ff8800',   // tracé brut saisi
    start: '#ffaa00',    // marqueur du point de départ
    cp: '#00e5ff',       // point de contrôle
    cpSel: '#ffa040',    // CP sélectionné
    preview: '#00e5ff',  // courbe Catmull-Rom fittée — même famille que cp
  },
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

// ── Chips — le vocabulaire tonal vit dans ui/StatusChip.tsx ─────────
/// (STATUS_TONES, tokens + opacités). Ici ne restent que les variantes
/// que StatusChip ne couvre pas : boutons pleins et sémaphores.

/// Variante pleine (boutons d'action type PANIC) — fond opaque.
export const CHIP_SOLID: Record<'live' | 'conduite' | 'warning' | 'danger' | 'osc' | 'tracking' | 'info' | 'dim', string> = {
  live: 'bg-green-700 hover:bg-green-600 text-white',
  conduite: 'bg-amber-700 hover:bg-amber-600 text-white',
  warning: 'bg-orange-700 hover:bg-orange-600 text-white',
  danger: 'bg-red-700 hover:bg-red-600 text-white',
  osc: 'bg-cyan-700 hover:bg-cyan-600 text-white',
  tracking: 'bg-purple-700 hover:bg-purple-600 text-white',
  info: 'bg-blue-700 hover:bg-blue-600 text-white',
  dim: 'bg-gray-700 hover:bg-gray-600 text-white',
};

/// Sémaphore de santé — trio ok/dégradé/critique pour les métriques
/// (fps, cpu, latence). Harmonise les yellow/orange/amber dispersés :
/// UN seul orange pour « dégradé ». Retourne la classe texte.
export function healthTone(level: 'ok' | 'degraded' | 'critical'): string {
  return level === 'ok' ? 'text-green-400'
    : level === 'degraded' ? 'text-orange-400'
    : 'text-red-400';
}
