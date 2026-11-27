/// Radar d'audition de cue — où la cue pose les objets SANS émettre :
/// fantômes cue (manual_positions + move origins, filtrés par scope)
/// vs positions actuellement émises. Extrait de CuelistPanel pour être
/// partagé avec la conduite (U3 — l'audition habite enfin la surface
/// où l'opérateur en a besoin live).
import React from 'react';
import { UI_HEX, VIZ } from '../../utils/uiColors';
import type { CueData } from '../../store/useCuelistStore';

export type AuditionGhost = { x: number; y: number; kind: 'pos' | 'origin' };

/// Fantômes d'une cue — positions manuelles (scope positions) + origines
/// des moves (scope moves). Pur, testable, partagé adapters conduite.
export function computeCueGhosts(cue: CueData): AuditionGhost[] {
  const ghosts: AuditionGhost[] = [];
  const posOn = (cue.scope ?? {}).positions !== false;
  if (posOn) {
    for (const p of Object.values(cue.manual_positions ?? {})) {
      if (p) ghosts.push({ x: p[0], y: p[1], kind: 'pos' });
    }
  }
  if ((cue.scope ?? {}).moves !== false) {
    for (const m of cue.moves ?? []) {
      const o = m.origin;
      if (o) ghosts.push({ x: o[0], y: o[1], kind: 'origin' });
    }
  }
  return ghosts;
}

export const CueAuditionRadar: React.FC<{
  ghosts: AuditionGhost[];
  /// Positions actuellement émises [x, y, z] — rendues en gris dim.
  emitted: Array<[number, number, number]>;
  /// Hauteur du svg (classe tailwind) — h-28 dans la cuelist, plus grand
  /// en conduite.
  heightClass?: string;
  showCaption?: boolean;
}> = ({ ghosts, emitted, heightClass = 'h-28', showCaption = true }) => {
  if (ghosts.length === 0 && emitted.length === 0) return null;
  const all = [...ghosts.map((g) => [g.x, g.y]), ...emitted.map((p) => [p[0], p[1]])];
  const maxR = Math.max(5, ...all.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
  const k = 60 / maxR;
  return (
    <div className="bg-gray-900/60 rounded p-1.5">
      <svg viewBox="-70 -70 140 140" className={`w-full ${heightClass}`}>
        <circle cx="0" cy="0" r="65" fill="none" stroke={VIZ.radarGrid} strokeWidth="1" />
        <line x1="0" y1="-65" x2="0" y2="65" stroke={VIZ.radarGrid} strokeWidth="0.5" />
        <line x1="-65" y1="0" x2="65" y2="0" stroke={VIZ.radarGrid} strokeWidth="0.5" />
        {emitted.map((p, i) => (
          <circle key={'e' + i} cx={p[0] * k} cy={-p[1] * k} r="2.5" fill={UI_HEX.dim} />
        ))}
        {ghosts.map((g, i) => (
          <circle
            key={i}
            cx={g.x * k}
            cy={-g.y * k}
            r={g.kind === 'pos' ? 4 : 3}
            fill={g.kind === 'pos' ? UI_HEX.target : 'none'}
            stroke={g.kind === 'pos' ? 'none' : UI_HEX.target}
            strokeWidth="1.5"
          />
        ))}
      </svg>
      {showCaption && (
        <div className="text-[8px] text-gray-500 text-center">
          ○ actuel · ● cue pos · ○ cue origins — audition, rien n'est émis
        </div>
      )}
    </div>
  );
};

export default CueAuditionRadar;
