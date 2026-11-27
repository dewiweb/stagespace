/// Panel Poses — presets de positions nommés (P1, design :
/// docs/position-presets-design.md). Auto-contenu : lit `usePoseStore`
/// directement (les poses sont backend-owned — `invoke` atteint le
/// backend depuis n'importe quelle fenêtre, pas besoin du broadcast
/// de la conduite). Refresh au mount ; mutations → refresh auto.
import React, { useEffect, useState } from 'react';
import { usePoseStore } from '../../store/usePoseStore';
import { useGraphStore } from '../../store/useGraphStore';
import { doPoseCapture, doPoseSnap, doPoseGoto, doPoseMorph, POSE_EASINGS } from '../../utils/liveActions';
import Modal from '../ui/Modal';
import { TrackGrid } from '../TrackGrid';

/// Layout-agnostic — le host décide du cadre (colonne Conduite, tab
/// Atelier, drawer Jeu). `fill` = colonne flex verticale (défaut) ;
/// sans fill le panel s'intègre dans un conteneur scrollable horizontal.
export const PosesPanel: React.FC<{ fill?: boolean }> = ({ fill = true }) => {
  const poses = usePoseStore((s) => s.poses);
  const selectedPoseName = usePoseStore((s) => s.selectedPoseName);
  const selectPose = usePoseStore((s) => s.selectPose);
  const refreshPoses = usePoseStore((s) => s.refreshPoses);
  const deletePose = usePoseStore((s) => s.deletePose);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const holProject = useGraphStore((s) => s.holProject);
  const [newName, setNewName] = useState('');
  const [gotoDuration, setGotoDuration] = useState(2.0);
  const [gotoEasing, setGotoEasing] = useState<string>('smooth');
  // Source du morph — une seule pose « A » à la fois ; chaque autre
  // row expose alors son bouton morph A→elle.
  const [morphSource, setMorphSource] = useState<string | null>(null);
  // Distribution de la capture — tracks concernées par la prochaine pose.
  // null = TOUTES les positions connues (défaut). Sélection explicite via
  // le picker TrackGrid (stagé dans tempCaptureIds tant que la modale est
  // ouverte). Volontairement décorrélé de la sélection du move editor :
  // capturer une pose n'a rien à voir avec l'assignation d'un slot.
  const [captureTracks, setCaptureTracks] = useState<number[] | null>(null);
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const [tempCaptureIds, setTempCaptureIds] = useState<number[]>([]);

  useEffect(() => {
    void refreshPoses();
  }, [refreshPoses]);

  // TrackInfos pour la TrackGrid du picker — même construction que
  // MovesTable (couleurs/noms du .hol, fallback IDs manuels).
  const pickerTrackInfos = React.useMemo(
    () =>
      holProject?.tracks.length
        ? holProject.tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, position: t.position }))
        : manualOscIds.map((id) => ({ id, name: `#${id}` })),
    [holProject, manualOscIds],
  );
  const allTrackIds = React.useMemo(() => pickerTrackInfos.map((t) => t.id), [pickerTrackInfos]);

  const openCapturePicker = () => {
    setTempCaptureIds(captureTracks ?? allTrackIds);
    setCapturePickerOpen(true);
  };
  const confirmCapturePicker = () => {
    // Toutes cochées = capture complète — null canonise l'état (le backend
    // capture alors toutes les positions connues, y compris les tracks
    // ajoutées plus tard au patch).
    setCaptureTracks(tempCaptureIds.length >= allTrackIds.length ? null : [...tempCaptureIds]);
    setCapturePickerOpen(false);
  };

  const capture = () => {
    const name = newName.trim();
    if (!name) return;
    doPoseCapture(name, captureTracks?.length ? captureTracks : undefined);
    setNewName('');
  };

  return (
    <div className={fill ? 'flex flex-col flex-1 min-h-0' : 'flex flex-col'}>
      <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-widest border-b border-gray-800 flex items-center justify-between">
        <span>Poses — position presets</span>
        <label className="flex items-center gap-1 normal-case tracking-normal" title="Goto ramp duration (seconds)">
          <span className="text-gray-600">goto</span>
          <input
            type="number"
            min={0.2}
            step={0.5}
            value={gotoDuration}
            onChange={(e) => setGotoDuration(Math.max(0.2, Number(e.target.value) || 2.0))}
            className="w-12 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-300 focus:border-stagespace-accent focus:outline-none"
          />
          <span className="text-gray-600">s</span>
        </label>
        <select
          value={gotoEasing}
          onChange={(e) => setGotoEasing(e.target.value)}
          className="px-1 py-0.5 bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-300 focus:border-stagespace-accent focus:outline-none"
          title="Courbe des rampes goto/morph — overshoot dépasse la cible (arrivée élastique)"
        >
          {POSE_EASINGS.map((ez) => (
            <option key={ez} value={ez}>{ez.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Capture — nom + distribution (picker tracks) + cap. */}
      <div className="px-2 py-2 border-b border-gray-800 flex gap-1">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') capture();
          }}
          placeholder="pose name…"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:border-stagespace-accent focus:outline-none"
        />
        <button
          onClick={openCapturePicker}
          className={`px-1.5 py-1 rounded text-[10px] font-mono border ${
            captureTracks
              ? 'border-stagespace-accent/50 text-stagespace-accent bg-stagespace-accent/10'
              : 'border-gray-700 text-gray-500 hover:text-gray-300'
          }`}
          title={
            captureTracks
              ? `Capture covers ${captureTracks.length} picked track(s) — click to change`
              : 'Capture covers ALL tracks — click to pick a subset'
          }
        >
          {captureTracks ? `${captureTracks.length}/${allTrackIds.length}` : 'all'}
        </button>
        <button
          onClick={capture}
          disabled={!newName.trim()}
          className="px-2 py-1 rounded bg-stagespace-accent/20 hover:bg-stagespace-accent/30 text-stagespace-info text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
          title={
            captureTracks
              ? `Capture ${captureTracks.length} picked track(s) at their current positions`
              : 'Capture ALL known positions'
          }
        >
          ● cap
        </button>
      </div>

      {/* Picker de distribution — même TrackGrid que le picker MovesTable,
          sélection STAGÉE appliquée à la confirmation. Mode select-only
          (pas de depth : une pose est binaire, membre ou pas). */}
      {capturePickerOpen && (
        <Modal title="Pose capture — tracks" onClose={() => setCapturePickerOpen(false)}>
          <div className="p-4">
            <TrackGrid
              compact
              tracks={pickerTrackInfos}
              selectedTrackIds={new Set(tempCaptureIds)}
              toggleTrackSelection={(tid) =>
                setTempCaptureIds((prev) =>
                  prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid],
                )
              }
              setTrackSelection={setTempCaptureIds}
              assignments={[]}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={confirmCapturePicker}
                disabled={tempCaptureIds.length === 0}
                className="flex-1 py-1.5 bg-stagespace-accent hover:opacity-90 text-gray-950 text-xs rounded font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                title={tempCaptureIds.length === 0 ? 'Pick at least one track' : undefined}
              >Confirmer</button>
              <button
                onClick={() => setCapturePickerOpen(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded"
              >Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      <div className="flex-1 overflow-y-auto">
        {poses.map((p) => {
          const ntracks = Object.keys(p.positions).length;
          const patched = Object.keys(p.positions).filter((t) =>
            manualOscIds.includes(Number(t))
          ).length;
          return (
            <div
              key={p.name}
              className="px-3 py-2 flex items-center gap-2 text-sm text-gray-300 hover:bg-gray-800/50 group"
            >
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => selectPose(selectedPoseName === p.name ? null : p.name)}
                title={
                  selectedPoseName === p.name
                    ? 'Hide pose ghosts in the 3D view'
                    : 'Show pose targets as ghosts in the 3D view'
                }
              >
                <div className={`truncate ${selectedPoseName === p.name ? 'text-stagespace-accent font-semibold' : ''}`}>
                  {selectedPoseName === p.name ? '◈ ' : ''}{p.name}
                </div>
                <div
                  className={`text-[10px] ${patched < ntracks ? 'text-stagespace-warning' : 'text-gray-600'}`}
                  title={
                    patched < ntracks
                      ? `${ntracks - patched} track(s) not patched — skipped at recall`
                      : `${ntracks} track(s)`
                  }
                >
                  {patched < ntracks ? `${patched}/${ntracks} tracks ⚠` : `${ntracks} tracks`}
                </div>
              </div>
              <button
                onClick={() => setMorphSource(morphSource === p.name ? null : p.name)}
                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  morphSource === p.name
                    ? 'bg-stagespace-target/25 text-white'
                    : 'bg-gray-800 text-gray-500 hover:text-stagespace-target opacity-70 group-hover:opacity-100'
                }`}
                title={
                  morphSource === p.name
                    ? 'Morph source A — click to unselect'
                    : 'Select as morph source A (then hit A→B on the target pose)'
                }
              >
                A
              </button>
              {morphSource && morphSource !== p.name && (
                <button
                  onClick={() => doPoseMorph(morphSource, p.name, gotoDuration, gotoEasing)}
                  className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs"
                  title={`Morph '${morphSource}' → '${p.name}' in ${gotoDuration}s — objects absent from the source start from their live positions`}
                >
                  A→B
                </button>
              )}
              <button
                onClick={() => doPoseGoto(p.name, gotoDuration, gotoEasing)}
                className="px-2 py-0.5 rounded bg-gray-800 hover:bg-stagespace-target/15 text-gray-400 hover:text-stagespace-target text-xs opacity-70 group-hover:opacity-100"
                title={`Goto — ramp objects to this pose in ${gotoDuration}s (smooth, holds the target at the end)`}
              >
                goto
              </button>
              <button
                onClick={() => doPoseSnap(p.name)}
                className="px-2 py-0.5 rounded bg-gray-800 hover:bg-stagespace-target/15 text-gray-400 hover:text-stagespace-target text-xs opacity-70 group-hover:opacity-100"
                title="Snap — instant recall (manual positions, partial: other tracks untouched)"
              >
                snap
              </button>
              <button
                onClick={() => void deletePose(p.name)}
                className="px-1 py-0.5 rounded text-gray-600 hover:text-stagespace-danger text-xs opacity-0 group-hover:opacity-100"
                title="Delete pose"
              >
                ×
              </button>
            </div>
          );
        })}
        {poses.length === 0 && (
          <div className="px-3 py-4 text-gray-600 text-xs">
            No poses — place objects, then capture.
          </div>
        )}
      </div>
    </div>
  );
};

export default PosesPanel;
