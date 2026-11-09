/// Chasse timecode pure — aucune IO. Les cues portent `timecode` en
/// secondes ; la règle n'exécute JAMAIS une cascade : un step franchit
/// plusieurs cues → seule la dernière est rappelée.
export interface ChaseCue {
  id: string;
  cue_number?: string | null;
  timecode?: number | null;
}

export interface ChaseResult {
  /// cueId à rappeler — absent si rien à faire.
  fire?: string;
}

/// `prevTc` = dernière valeur TC connue (null = premier message reçu).
/// `tc` = nouvelle valeur. `currentCueId` = cue couramment active (pour
/// éviter un recall identique après un locate sur sa propre position).
export function chase(
  prevTc: number | null,
  tc: number,
  cues: ChaseCue[],
  currentCueId: string | null,
): ChaseResult {
  const timed = cues
    .filter((c) => c.timecode != null && Number.isFinite(c.timecode))
    .sort((a, b) => (a.timecode as number) - (b.timecode as number));
  if (timed.length === 0) return {};

  // Premier message, saut forward (>1s) ou rewind (<0) = locate : recall
  // la dernière cue déjà passée (si différente de la courante).
  const isLocate = prevTc === null || tc - prevTc > 1.0 || tc < prevTc;
  if (isLocate) {
    const latest = [...timed].reverse().find((c) => (c.timecode as number) <= tc);
    if (latest && latest.id !== currentCueId) return { fire: latest.id };
    return {};
  }

  // Step forward (0 < dt <= 1s) : la DERNIÈRE cue dans ]prevTc, tc] —
  // jamais plusieurs recalls d'affilée.
  const dt = tc - prevTc;
  if (dt > 0) {
    const crossed = timed.filter(
      (c) => (c.timecode as number) > prevTc && (c.timecode as number) <= tc,
    );
    const last = crossed[crossed.length - 1];
    if (last) return { fire: last.id };
  }
  return {};
}
