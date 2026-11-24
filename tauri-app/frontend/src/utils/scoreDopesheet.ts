/// Dopesheet — collecte TOUTE l'automation de la partition en
/// rangées navigables (vue d'ensemble façon Blender/DAW) :
///   - une rangée par courbe de lane (GLOBALFX/MODULATION/SPATIALFX
///     + lanes objets `obj-<tid>`) qui a ≥1 keyframe
///   - une rangée par courbe clip-scoped (clips slot)
///   - une rangée "événements" par lane porteuse de clips non-slot
///     (conductor, osc, spatialfx, modulation, globalfx) — un ◆ par
///     clip, déplaçable = moveClip.
///
/// Rangées vides exclues — le dopesheet n'affiche que ce qui existe.
/// Le composant résout les ParamDef (drag vertical = valeur) ; ce
/// collecteur reste pur de tout ParamDef.
import {
  GLOBALFX_LANE,
  MODULATION_LANE,
  OSC_LANE,
  SPATIALFX_LANE,
  CONDUCTOR_LANE,
  clipLaneIds,
  type ScoreClipDoc,
  type ScoreDoc,
} from '../store/useScoreStore';
import { effectiveTrackIds } from './scoreResolve';

/// Métrique partagée dopesheet — la colonne PARAMÈTRES et le plot
/// utilisent les mêmes hauteurs pour un alignement vertical strict.
export const DOPE_ROW_H = 18;
export const DOPE_HEADER_H = 14;
/// MIME du drag&drop bibliothèque → timeline (JSON :
/// {ref, durationMs?, repeatEveryMs?}).
export const SCORE_DRAG_MIME = 'application/x-stagespace-clip';

export interface DopePoint {
  t: number;
  /// Valeur du keyframe — absent pour les points événements (clips).
  v?: number;
  /// Index dans le tableau de keyframes de la courbe source.
  kfIdx?: number;
  /// Clip porteur (rangées events) — drag = moveClip.
  clipId?: string;
}

export interface DopeRow {
  /// Clé stable — `lc:<lane>:<param>` | `cc:<clip>:<param>` | `ev:<lane>`.
  key: string;
  kind: 'lane-curve' | 'clip-curve' | 'events';
  /// Affichage colonne gauche — `GLOBALFX`, `T3`, `clip Orbit`, `OSC`…
  laneLabel: string;
  /// Affichage paramètre — `speed`, `pos.x`… (absent pour events).
  paramLabel?: string;
  /// Cible d'écriture des drags / de la sélection.
  laneId?: string;
  paramId?: string;
  clipId?: string;
  points: DopePoint[];
}

/// Lanes globales dans l'ordre d'affichage de la timeline.
const LANE_ORDER: Record<string, number> = {
  [CONDUCTOR_LANE]: 0,
  [OSC_LANE]: 1,
  [GLOBALFX_LANE]: 2,
  [SPATIALFX_LANE]: 3,
  [MODULATION_LANE]: 4,
};

const laneLabelOf = (laneId: string): string =>
  laneId.startsWith('obj-') ? `T${laneId.slice(4)}` : laneId.toUpperCase();

const LANE_CURVE_SOURCES: Array<{
  laneId: string;
  field: 'globalFxCurves' | 'modulationCurves' | 'spatialFxCurves';
}> = [
  { laneId: GLOBALFX_LANE, field: 'globalFxCurves' },
  { laneId: SPATIALFX_LANE, field: 'spatialFxCurves' },
  { laneId: MODULATION_LANE, field: 'modulationCurves' },
];

/// Collecte les rangées — `clipLabel` fourni par l'appelant (il connaît
/// slots/cues). `resolveEff` facultatif : couverture effective d'un
/// clip pour les lanes d'events (défaut `effectiveTrackIds`).
export function collectDopesheetRows(
  doc: ScoreDoc,
  clipLabel: (c: ScoreClipDoc) => string,
): DopeRow[] {
  const rows: DopeRow[] = [];

  // ── Rangées événements — clips non-slot groupés par lane porteuse
  //    (première lane de clipLaneIds sur la couverture effective ; un
  //    clip multi-lanes objet n'est pas un event : slot/positions sont
  //    filtrés plus haut).
  const events = new Map<string, DopePoint[]>();
  for (const c of doc.clips) {
    if (c.ref.type === 'slot') continue;
    const lane = clipLaneIds(c, effectiveTrackIds(c))[0] ?? CONDUCTOR_LANE;
    const pts = events.get(lane) ?? [];
    pts.push({ t: c.startMs, clipId: c.id });
    events.set(lane, pts);
  }
  for (const [lane, pts] of [...events.entries()].sort(
    (a, b) => (LANE_ORDER[a[0]] ?? 90) - (LANE_ORDER[b[0]] ?? 90) || a[0].localeCompare(b[0]),
  )) {
    rows.push({
      key: `ev:${lane}`,
      kind: 'events',
      laneLabel: laneLabelOf(lane),
      laneId: lane,
      points: pts.sort((a, b) => a.t - b.t),
    });
  }

  // ── Rangées courbes de lanes globales — une rangée par paramètre
  //    portant ≥1 keyframe (ordre de lane, puis ordre alphabétique du
  //    paramètre — stable et recherchable).
  for (const { laneId, field } of LANE_CURVE_SOURCES) {
    for (const [param, kfs] of Object.entries(doc[field] ?? {}).sort()) {
      if (!kfs?.length) continue;
      rows.push({
        key: `lc:${laneId}:${param}`,
        kind: 'lane-curve',
        laneLabel: laneLabelOf(laneId),
        paramLabel: param,
        laneId,
        paramId: param,
        points: kfs.map((k, i) => ({ t: k.t, v: k.v, kfIdx: i })),
      });
    }
  }

  // ── Rangées courbes des lanes objets — obj-<tid> triées par track.
  const objLanes = Object.keys(doc.objectCurves ?? {})
    .filter((l) => l.startsWith('obj-'))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  for (const laneId of objLanes) {
    for (const [param, kfs] of Object.entries(doc.objectCurves![laneId] ?? {}).sort()) {
      if (!kfs?.length) continue;
      rows.push({
        key: `lc:${laneId}:${param}`,
        kind: 'lane-curve',
        laneLabel: laneLabelOf(laneId),
        paramLabel: param,
        laneId,
        paramId: param,
        points: kfs.map((k, i) => ({ t: k.t, v: k.v, kfIdx: i })),
      });
    }
  }

  // ── Rangées courbes clip-scoped (slots) — identifiées par le clip.
  for (const c of doc.clips) {
    if (!c.curves) continue;
    for (const [param, kfs] of Object.entries(c.curves).sort()) {
      if (!kfs?.length) continue;
      rows.push({
        key: `cc:${c.id}:${param}`,
        kind: 'clip-curve',
        laneLabel: `clip ${clipLabel(c)}`,
        paramLabel: param,
        clipId: c.id,
        paramId: param,
        points: kfs.map((k, i) => ({ t: k.t, v: k.v, kfIdx: i })),
      });
    }
  }

  return rows;
}
