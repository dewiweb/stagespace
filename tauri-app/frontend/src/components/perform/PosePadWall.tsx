/// Mur de pose-pads — l'esprit console lumière (palettes position) pour
/// le busking spatial : tap = snap, hold = goto animé, nom = fantômes.
/// Auto-contenu (même pattern que PosesPanel) : lit usePoseStore, refresh
/// au mount. Monté dans l'onglet POSES de la zone centrale du jeu.
import React from 'react';
import { usePoseStore } from '../../store/usePoseStore';
import { useGraphStore } from '../../store/useGraphStore';
import { doPoseSnap, doPoseGoto, doPoseCapture, POSE_EASINGS } from '../../utils/liveActions';
import Modal from '../ui/Modal';
import { TrackGrid } from '../TrackGrid';
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
  const holProject = useGraphStore((s) => s.holProject);
  // Capture depuis le mur — la pose créée devient immédiatement un pad.
  // La distribution est choisie inline dans la modale (TrackGrid, tout
  // coché par défaut = capture complète) — pas de picker imbriqué.
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [captureName, setCaptureName] = React.useState('');
  const [captureIds, setCaptureIds] = React.useState<number[]>([]);

  const captureTrackInfos = React.useMemo(
    () =>
      holProject?.tracks.length
        ? holProject.tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, position: t.position }))
        : manualOscIds.map((id) => ({ id, name: `#${id}` })),
    [holProject, manualOscIds],
  );

  const openCapture = () => {
    setCaptureName('');
    setCaptureIds(captureTrackInfos.map((t) => t.id));
    setCaptureOpen(true);
  };
  const capture = () => {
    const name = captureName.trim();
    if (!name || captureIds.length === 0) return;
    // Toutes cochées = capture complète canonisée (undefined — le backend
    // prend toutes les positions connues, tracks futures incluses).
    const all = captureIds.length >= captureTrackInfos.length;
    doPoseCapture(name, all ? undefined : captureIds);
    setCaptureOpen(false);
  };

  React.useEffect(() => {
    void refreshPoses();
  }, [refreshPoses]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-end gap-1 px-3 py-1 border-b border-stagespace-border flex-shrink-0">
        <button
          onClick={openCapture}
          className="mr-auto px-2 py-0.5 rounded bg-stagespace-target/15 hover:bg-stagespace-target/25 text-stagespace-target text-[10px] font-bold"
          title="Capture les positions courantes en nouvelle pose — elle devient un pad ici"
        >
          + capture
        </button>
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
              hint="+ capture fige les positions courantes en pose — ou via l'onglet Poses à gauche."
            />
          </div>
        )}
      </div>

      {/* Modale capture — nom + distribution inline (tout coché = capture
          complète). Les positions capturées sont celles du moment :
          manuelles, holds de moves, ou live des moves en cours. */}
      {captureOpen && (
        <Modal title="Capture pose" onClose={() => setCaptureOpen(false)}>
          <div className="p-4">
            <input
              autoFocus
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') capture();
              }}
              placeholder="pose name…"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-stagespace-accent focus:outline-none mb-3"
            />
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">
              Tracks capturées — {captureIds.length}/{captureTrackInfos.length}
            </div>
            <TrackGrid
              compact
              tracks={captureTrackInfos}
              selectedTrackIds={new Set(captureIds)}
              toggleTrackSelection={(tid) =>
                setCaptureIds((prev) =>
                  prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid],
                )
              }
              setTrackSelection={setCaptureIds}
              assignments={[]}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={capture}
                disabled={!captureName.trim() || captureIds.length === 0}
                className="flex-1 py-1.5 bg-stagespace-accent hover:opacity-90 text-gray-950 text-xs rounded font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                title={
                  captureIds.length >= captureTrackInfos.length
                    ? 'Capture ALL known positions'
                    : `Capture ${captureIds.length} picked track(s) at their current positions`
                }
              >
                ● Capturer
              </button>
              <button
                onClick={() => setCaptureOpen(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
