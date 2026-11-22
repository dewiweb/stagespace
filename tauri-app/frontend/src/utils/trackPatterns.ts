/// Patterns de sélection de tracks — partagés par TrackGrid (barre +
/// clic-droit), le picker de tracks du slot (MovesTable) et tout futur
/// sélecteur. La parité est index-based (position dans la liste ordonnée
/// des ids), pas sur la valeur de l'id : '1 of 2' = indices pairs.

export type SelectionPattern =
  | 'all'
  | 'none'
  | 'even'
  | 'odd'
  | 'first_half'
  | 'second_half'
  | 'inverse';

export const TRACK_PATTERNS: { id: SelectionPattern; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Select all (100%)' },
  { id: 'none', label: 'None', title: 'Deselect all' },
  { id: 'even', label: '1 of 2', title: 'Select every other track (even indices)' },
  { id: 'odd', label: 'Odd', title: 'Select every other track (odd indices)' },
  { id: 'inverse', label: 'Inverse', title: 'Invert current selection' },
  { id: 'first_half', label: '1st half', title: 'First half' },
  { id: 'second_half', label: '2nd half', title: 'Second half' },
];

export function applySelectionPattern(
  pattern: SelectionPattern,
  allIds: number[],
  current: ReadonlySet<number>,
): number[] {
  const n = allIds.length;
  switch (pattern) {
    case 'all':
      return [...allIds];
    case 'none':
      return [];
    case 'even':
      return allIds.filter((_, i) => i % 2 === 0);
    case 'odd':
      return allIds.filter((_, i) => i % 2 === 1);
    case 'first_half':
      return allIds.slice(0, Math.ceil(n / 2));
    case 'second_half':
      return allIds.slice(Math.floor(n / 2));
    case 'inverse':
      return allIds.filter((id) => !current.has(id));
  }
}
