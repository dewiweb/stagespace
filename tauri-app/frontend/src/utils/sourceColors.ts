/// Couleurs source-de-contrôle — la couleur code QUI pilote l'objet :
///   track  = move (le graphe, cas normal — vert discret)
///   move   = move actif confirmé
///   manual = reprise opérateur (position manuelle — orange)
///   park   = gelé par panic/park (pink stase — survit aux recalls)
///   hold   = fin de one-shot retenue (cyan)
///   psn    = tracker externe PSN/RTTrP (violet)
///   freeze = stase attention (pink — même famille stase que park)
/// Un seul module : radar, pads, chips et 3D ne peuvent plus diverger.
export const SOURCE_HEX: Record<string, string> = {
  park: '#ec4899',
  psn: '#a855f7',
  hold: '#22d3ee',
  manual: '#f97316',
  freeze: '#ec4899',
  move: '#22c55e',
  track: '#6b7280',
};

export const sourceHex = (src: string | undefined): string =>
  SOURCE_HEX[src ?? 'track'] ?? SOURCE_HEX.track;

/// Variante texte (badges, chips) — mêmes rôles, classes tailwind.
export const SOURCE_TEXT: Record<string, string> = {
  park: 'text-pink-400',
  psn: 'text-purple-400',
  hold: 'text-cyan-400',
  manual: 'text-orange-400',
  freeze: 'text-pink-400',
  move: 'text-green-400',
  track: 'text-gray-500',
};

export const sourceText = (src: string | undefined): string =>
  SOURCE_TEXT[src ?? 'track'] ?? SOURCE_TEXT.track;

/// Variante chip (fond teinté + texte) — les chips source-de-contrôle.
export const SOURCE_CHIP: Record<string, string> = {
  park: 'bg-pink-900 text-pink-300',
  psn: 'bg-purple-900 text-purple-300',
  hold: 'bg-cyan-900 text-cyan-300',
  manual: 'bg-orange-900 text-orange-300',
  freeze: 'bg-pink-900 text-pink-300',
  move: 'bg-green-900 text-green-300',
  track: 'bg-gray-800 text-gray-400',
};

/// Pastille compacte (badge P/H des slots, pastilles inline) —
/// teinte pleine de la famille, plus foncée que SOURCE_CHIP.
export const SOURCE_BADGE: Record<string, string> = {
  park: 'bg-pink-800',
  hold: 'bg-cyan-800',
  freeze: 'bg-pink-800',
};

/// Bouton d'action fort (park/attention) — même teinte que
/// SOURCE_BADGE + hover.
export const SOURCE_STRONG: Record<string, string> = {
  park: 'bg-pink-800/70 hover:bg-pink-700 text-pink-100',
  freeze: 'bg-pink-800/70 hover:bg-pink-700 text-pink-100',
};

/// Variante outline douce (chips de status barrés) — contour
/// coloré sur fond très translucide.
export const SOURCE_OUTLINE: Record<string, string> = {
  park: 'border-pink-600/60 text-pink-200 bg-pink-900/30 hover:bg-pink-800/40',
  freeze: 'border-pink-600/60 text-pink-200 bg-pink-900/30 hover:bg-pink-800/40',
};

/// Bouton de row discret (chip list) — fond neutre, hover teinte
/// stase au survol.
export const SOURCE_ROW: Record<string, string> = {
  park: 'bg-gray-700 hover:bg-pink-700',
  freeze: 'bg-gray-700 hover:bg-pink-700',
};

/// Libellé court pour les tooltips — une seule formulation partout.
export const SOURCE_LABEL: Record<string, string> = {
  park: 'parked (survit aux recalls)',
  psn: 'PSN tracker',
  hold: 'hold (fin de move retenue)',
  manual: 'position manuelle',
  freeze: 'stase attention',
  move: 'move actif',
  track: 'track',
};
