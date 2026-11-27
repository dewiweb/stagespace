/// Mur de pose-pads — l'esprit console lumière (palettes position) pour
/// le busking spatial : tap = snap, hold = goto animé, nom = fantômes.
/// Auto-contenu (même pattern que PosesPanel) : lit usePoseStore, refresh
/// au mount. Monté dans l'onglet POSES de la zone centrale du jeu.
import React from 'react';
import { usePoseStore } from '../../store/usePoseStore';
import { useGraphStore } from '../../store/useGraphStore';
import { doPoseSnap, doPoseGoto, POSE_EASINGS } from '../../utils/liveActions';
import { PoseTile } from '../show/PoseTile';
import EmptyState from '../ui/EmptyState';

export const PosePadWall: React.FC = () => {
  const poses = usePoseStore((s) => s.poses);
  const selectedPoseName = usePoseStore((s) => s.selectedPoseName);
  const selectPose = usePoseStore((s) => s.selectPose);
  const refreshPoses = usePoseStore((s) => s.refreshPoses);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  // Durée du goto (hold) — réglage du mur, indépendant du panel. 2s est
  // le défaut du PosesPanel : même repère pour l'opérateur.
  const [gotoDuration, setGotoDuration] = React.useState(2.0);
  // Courbe de la rampe — smooth (défaut backend) est le bon défaut musical :
  // vélocité nulle aux deux bouts, pas d'à-coup à l'arrivée.
  const [gotoEasing, setGotoEasing] = React.useState<string>('smooth');

  React.useEffect(() => {
    void refreshPoses();
  }, [refreshPoses]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-end gap-1 px-3 py-1 border-b border-stagespace-border flex-shrink-0">
        <label
          className="flex items-center gap-1 text-[10px] text-gray-500"
          title="Durée de la rampe goto (hold sur un pad)"
        >
          <span>hold goto</span>
          <input
            type="number"
            min={0.2}
            step={0.5}
            value={gotoDuration}
            onChange={(e) => setGotoDuration(Math.max(0.2, Number(e.target.value) || 2.0))}
            className="w-12 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-300 focus:border-stagespace-accent focus:outline-none"
          />
          <span>s</span>
        </label>
        <select
          value={gotoEasing}
          onChange={(e) => setGotoEasing(e.target.value)}
          className="px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-300 focus:border-stagespace-accent focus:outline-none"
          title="Courbe de la rampe goto — overshoot dépasse la cible (arrivée élastique)"
        >
          {POSE_EASINGS.map((ez) => (
            <option key={ez} value={ez}>{ez.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <div
        className={`flex-1 overflow-y-auto p-3 grid gap-3 auto-rows-min content-start ${
          poses.length > 12 ? 'grid-cols-4' : poses.length > 6 ? 'grid-cols-3' : 'grid-cols-2'
        }`}
      >
        {poses.map((pose) => {
          const patched = Object.keys(pose.positions).filter((t) =>
            manualOscIds.includes(Number(t)),
          ).length;
          return (
            <PoseTile
              key={pose.name}
              pose={pose}
              patchedCount={patched}
              isSelected={selectedPoseName === pose.name}
              onSnap={() => doPoseSnap(pose.name, 'posepad')}
              onGoto={() => doPoseGoto(pose.name, gotoDuration, gotoEasing, 'posepad')}
              onSelect={() => selectPose(selectedPoseName === pose.name ? null : pose.name)}
            />
          );
        })}
        {poses.length === 0 && (
          <div className="col-span-4 py-16">
            <EmptyState
              title="Aucune pose"
              hint="Capture des positions dans le drawer Poses — elles deviennent des pads ici."
            />
          </div>
        )}
      </div>
    </div>
  );
};
