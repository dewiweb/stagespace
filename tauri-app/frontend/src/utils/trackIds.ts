/// Track IDs — parse et format compact partagés (A6).
///
/// Le parseur reprend la syntaxe du CLI (`parse_track_list` dans
/// stagespace-cli) : nombres séparés par virgules, ranges `a-b`
/// inclusifs, mixité libre — "1-4, 7, 9-12". Les entrées invalides
/// sont ignorées silencieusement (l'opérateur tape en live, une
/// erreur dure casserait le flux) — les doublons sont conservés
/// uniquement s'ils sont tapés deux fois explicitement ? Non : dédup
/// trié, l'ordre de saisie n'a pas de sens pour un set de tracks.

/// Parse "1, 2, 5-8, 12" → [1, 2, 5, 6, 7, 8, 12] — dédup, trié.
/// Supporte les espaces, les ranges inclusifs, la mixité libre.
/// `maxRange` borne une range (protection typo "1-999").
export function parseTrackIds(text: string, maxRange = 512): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (b >= a && b - a <= maxRange) {
        for (let i = a; i <= b; i++) out.add(i);
      } else if (a > b && a - b <= maxRange) {
        // Range inversée — l'intention est évidente, on accepte.
        for (let i = b; i <= a; i++) out.add(i);
      }
      continue;
    }
    const n = parseInt(p, 10);
    if (!isNaN(n) && String(n) === p) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/// Format compact : [1,2,3,4,7,9,10,12] → "1-4, 7, 9-10, 12".
/// Les plages de 2+ consécutifs deviennent `a-b` (un range de 2 = "a,b"
/// serait aussi long — mais la lecture "9-10" est sans ambiguïté).
/// `parked` : ids marqués ⏸ sortis de leur plage (affichage pad live).
export function formatTrackIds(ids: number[], parked: number[] = []): string {
  if (ids.length === 0) return '';
  const parkedSet = new Set(parked);
  const sorted = [...ids].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i];
    if (parkedSet.has(t)) {
      parts.push(`${t}⏸`);
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < sorted.length &&
      !parkedSet.has(sorted[j + 1]) &&
      sorted[j + 1] === sorted[j] + 1
    ) {
      j++;
    }
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(`${sorted[k]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
