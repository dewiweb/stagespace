/// Déliage des clips du score (docs/score-sequencer.md). Un clip
/// entretient deux liens distincts :
///  - COUVERTURE — les lanes objets où il se rend en copie liée :
///    délier = scinder le clip par piste (même entité, placement
///    indépendant).
///  - RÉFÉRENCE — l'entité partagée (`ref.slotId`) : délier = cloner
///    le move en banque ("make unique") — divergence de contenu, la
///    nouvelle version n'affecte plus les autres clips.
/// Le composite `asNewMove` enchaîne les deux : la piste détachée
/// devient un clip suivant un move frais né pour elle.
import { useScoreStore } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { effectiveTrackIds } from './scoreResolve';
import type { ScoreClipDoc, ScoreClipRef } from '../store/useScoreStore';

/// Nombre de clips pointant la même entité — badge « lié ×N » de
/// l'inspector / disabled-reason du menu.
export function sharedClipCount(ref: ScoreClipRef): number {
  const { clips } = useScoreStore.getState();
  if (ref.type === 'slot') return clips.filter((c) => c.ref.type === 'slot' && c.ref.slotId === ref.slotId).length;
  if (ref.type === 'cue') return clips.filter((c) => c.ref.type === 'cue' && c.ref.cueId === ref.cueId).length;
  return 1;
}

/// Copie les propriétés d'instance (fades, repeat, courbes clip-scoped)
/// sur un clip fraîchement créé — placement déjà posé par addClip.
function copyInstanceProps(src: ScoreClipDoc, dstId: string): void {
  const { setClipFades, setClipRepeat, setClipCurve } = useScoreStore.getState();
  if (src.fadeInMs !== undefined || src.fadeOutMs !== undefined) {
    setClipFades(dstId, src.fadeInMs, src.fadeOutMs);
  }
  if (src.repeatEveryMs !== undefined) setClipRepeat(dstId, src.repeatEveryMs);
  for (const [paramId, keys] of Object.entries(src.curves ?? {})) {
    setClipCurve(dstId, paramId, keys.map((k) => ({ ...k })));
  }
}

/// `Détacher T<n>` — scinde la couverture du clip : l'original garde
/// les autres pistes, un nouveau clip naît sur `[trackId]` à la même
/// position (mêmes fades/repeat/courbes).
/// - `asNewMove: false` → le nouveau clip pointe la MÊME entité avec
///   un override `[trackId]` (divergence de placement seule).
/// - `asNewMove: true` → clone le slot en banque (assigné `[trackId]`,
///   nom `‹slot› ▸ T<n>`) et le nouveau clip le suit — divergence de
///   contenu possible. Slots seulement (une cue → même ref + override ;
///   son « make unique » est la duplication de cue, chantier flatten).
/// Dans les deux cas l'original reçoit un override explicite —
/// suivre l'entité tout en excluant une piste est impossible par
/// construction (le toggle ⇄ permet de re-suivre).
export function detachLaneFromClip(clipId: string, trackId: number, asNewMove: boolean): boolean {
  const score = useScoreStore.getState();
  const clip = score.clips.find((c) => c.id === clipId);
  // Slots seulement — la « couverture » d'une cue est un blast radius
  // visuel, pas une assignation : la scinder ne voudrait rien dire.
  if (!clip || clip.ref.type !== 'slot') return false;
  const eff = effectiveTrackIds(clip);
  // Rien à détacher : piste pas couverte, ou couverture déjà réduite
  // à elle seule (le nouveau clip recouvrirait exactement l'original).
  if (!eff.includes(trackId) || eff.length <= 1) return false;

  score.setClipTrackIds(clipId, eff.filter((t) => t !== trackId));

  const clipRef = clip.ref;
  let ref = clipRef;
  let trackIds: number[] | undefined = [trackId];
  if (asNewMove && clipRef.type === 'slot') {
    const src = useGraphStore.getState().moveSlots.find((s) => s.id === clipRef.slotId);
    const newSlotId = useGraphStore.getState().duplicateMoveSlot(clipRef.slotId, {
      name: `${src?.name ?? 'Move'} ▸ T${trackId}`,
      trackIds: [trackId],
      select: false,
    });
    if (!newSlotId) return false;
    ref = { type: 'slot', slotId: newSlotId };
    // Le nouveau clip suit le move né pour cette piste — suivi live,
    // pas d'override à figer.
    trackIds = undefined;
  }

  const fresh = score.addClip(ref, clip.startMs, {
    durationMs: clip.durationMs,
    trackIds,
    repeatEveryMs: clip.repeatEveryMs,
  });
  copyInstanceProps(clip, fresh.id);
  return true;
}

/// `Rendre unique` — clone l'entité référencée et repointe le clip.
/// Le clip garde son mode de couverture : en suivi il suit désormais
/// le clone (suivi live préservé, seule la cible change) ; en override
/// l'override reste clip-local. Slot → clone du move en banque
/// (`‹slot› ▸ unique`) ; cue → duplication dans la cuelist
/// (`‹cue› copy`, insérée après la source, cue_number null — le clip
/// devient la SEULE référence vivante au clone). Retourne l'id de
/// l'entité clonée.
export function makeClipUnique(clipId: string): string | undefined {
  const score = useScoreStore.getState();
  const clip = score.clips.find((c) => c.id === clipId);
  if (!clip) return undefined;
  const clipRef = clip.ref;
  if (clipRef.type === 'slot') {
    const src = useGraphStore.getState().moveSlots.find((s) => s.id === clipRef.slotId);
    const newSlotId = useGraphStore.getState().duplicateMoveSlot(clipRef.slotId, {
      name: `${src?.name ?? 'Move'} ▸ unique`,
      select: false,
    });
    if (newSlotId) score.retargetClip(clipId, { type: 'slot', slotId: newSlotId });
    return newSlotId;
  }
  if (clipRef.type === 'cue') {
    const newCueId = useCuelistStore.getState().duplicateCue(String(clipRef.cueId), {
      name: `${useCuelistStore.getState().cues.find((q) => String(q.id) === String(clipRef.cueId))?.name ?? 'Cue'} copy`,
    });
    if (newCueId) score.retargetClip(clipId, { type: 'cue', cueId: newCueId });
    return newCueId;
  }
  return undefined;
}
