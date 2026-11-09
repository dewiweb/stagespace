/// Couleurs source-de-contrôle — la couleur code QUI pilote l'objet :
///   track  = move (le graphe, cas normal — vert discret)
///   move   = move actif confirmé
///   manual = reprise opérateur (position manuelle — orange)
///   park   = gelé par panic/park (ambre — survit aux recalls)
///   hold   = fin de one-shot retenue (cyan)
///   psn    = tracker externe PSN/RTTrP (violet)
///   freeze = stase attention (indigo — obj figé par attention_focus)
/// Un seul module : radar, pads, chips et 3D ne peuvent plus diverger.
export const SOURCE_HEX: Record<string, string> = {
  park: '#f59e0b',
  psn: '#a855f7',
  hold: '#22d3ee',
  manual: '#f97316',
  freeze: '#818cf8',
  move: '#22c55e',
  track: '#6b7280',
};

export const sourceHex = (src: string | undefined): string =>
  SOURCE_HEX[src ?? 'track'] ?? SOURCE_HEX.track;

/// Variante texte (badges, chips) — mêmes rôles, classes tailwind.
export const SOURCE_TEXT: Record<string, string> = {
  park: 'text-amber-400',
  psn: 'text-purple-400',
  hold: 'text-cyan-400',
  manual: 'text-orange-400',
  freeze: 'text-indigo-400',
  move: 'text-green-400',
  track: 'text-gray-500',
};

export const sourceText = (src: string | undefined): string =>
  SOURCE_TEXT[src ?? 'track'] ?? SOURCE_TEXT.track;

/// Variante chip (fond teinté + texte) — les chips source-de-contrôle.
export const SOURCE_CHIP: Record<string, string> = {
  park: 'bg-amber-900 text-amber-300',
  psn: 'bg-purple-900 text-purple-300',
  hold: 'bg-cyan-900 text-cyan-300',
  manual: 'bg-orange-900 text-orange-300',
  freeze: 'bg-indigo-900 text-indigo-300',
  move: 'bg-green-900 text-green-300',
  track: 'bg-gray-800 text-gray-400',
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
