/// Pose ghosts — logique pure des marqueurs fantômes (P6, design :
/// docs/position-presets-design.md §8). Un fantôme par track de la pose
/// sélectionnée : position absolue (les poses sont track_id-keyed — pas
/// de résolution obj, la cible est un point de l'espace), flag `patched`
/// pour la couleur (les tracks non patchées seraient skippées au recall).
import type { Pose } from '../types/generated/Pose';

export interface PoseGhostEntry {
  trackId: number;
  position: [number, number, number];
  patched: boolean;
}

/// Entries triées par track_id — ordre stable pour les tests et le
/// billboard indexé du render loop. `patched` = la track est dans le
/// mapping courant (`manualOscIds`) — sans ça le recall la skipperait.
export function poseGhostEntries(pose: Pose, manualOscIds: number[]): PoseGhostEntry[] {
  return Object.entries(pose.positions)
    .map(([k, v]) => ({
      trackId: Number(k),
      position: v as [number, number, number],
      patched: manualOscIds.includes(Number(k)),
    }))
    .sort((a, b) => a.trackId - b.trackId);
}
