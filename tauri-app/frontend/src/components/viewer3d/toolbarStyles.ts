/// Styles partagés des barres dockées du viewer 3D — un seul langage
/// visuel : groupes segmentés (bordure commune + divide-x), boutons
/// compacts h-6, séparateurs fins.

/// Conteneur de groupe segmenté (boutons joints, un seul contour).
export const tbGroup =
  'flex items-stretch rounded border border-gray-700/70 bg-gray-800/70 overflow-hidden divide-x divide-gray-700/70';

/// Bouton de groupe segmenté — pas de rounded/border propre.
export const tbBtn =
  'h-6 px-2 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';

/// Bouton autonome (actions : Done, Cancel, Exit).
export const tbAction =
  'h-6 px-2 text-[11px] rounded font-medium flex items-center gap-1 transition-colors whitespace-nowrap';

/// Bouton icône carré (undo / clear / load).
export const tbIcon =
  'h-6 w-6 flex items-center justify-center rounded bg-gray-800/70 border border-gray-700/70 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/// Séparateur vertical entre groupes.
export const tbSep = 'w-px h-4 bg-gray-700/70 self-center shrink-0';

/// État inactif standard.
export const tbIdle = 'text-gray-400 hover:text-white hover:bg-gray-700/60';
