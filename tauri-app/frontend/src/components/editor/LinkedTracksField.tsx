import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { TrackGrid } from '../TrackGrid';
import { Modal } from '../ui/Modal';

/// Classe input partagée des params node — les 7 copies verbatim dans
/// CustomNode divergeaient silencieusement (focus:border-blue vs cyan).
/// `nodrag nowheel` : sans eux un mousedown dans le champ déplaçait le
/// node (React Flow drague depuis tout élément non marqué) et la molette
/// zoomait le canvas en éditant.
export const NODE_INPUT_CLS =
  'nodrag nowheel w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-stagespace-accent focus:outline-none';
export const NODE_INPUT_MONO_CLS = `${NODE_INPUT_CLS} font-mono`;
const TRACKS_CLS =
  'nodrag nowheel flex-1 px-2 py-1 bg-gray-900 text-gray-300 text-xs font-mono rounded border border-gray-700 focus:border-stagespace-accent focus:outline-none';

/// Champ "Linked Tracks" des nodes Objects — deux copies identiques
/// (expanded + collapsed) dans CustomNode, qui divergeaient sur le nombre
/// de chips affichés (16 vs 12). `maxShown` conserve les deux seuils.
/// A6.2 : picker visuel TrackGrid — le bouton grille ouvre la sélection
/// en modal (même composant que le picker de la table des moves).
export const LinkedTracksField: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onCommit: () => void;
  onPick: (ids: number[]) => void;
  ids: number[];
  maxShown: number;
}> = ({ value, onChangeText, onCommit, onPick, ids, maxShown }) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<number[]>([]);
  const holProject = useGraphStore((s) => s.holProject);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);

  // Source des tracks — même résolution que la table des moves :
  // holProject si importé, sinon les ids manuels.
  const trackInfos = React.useMemo(
    () =>
      holProject?.tracks?.length
        ? holProject.tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, position: t.position }))
        : manualOscIds.map((id, i) => ({
            id,
            name: `Object ${id}`,
            color: `hsl(${(i / Math.max(manualOscIds.length, 1)) * 360}, 70%, 55%)`,
            position: [0, 0, 0] as [number, number, number],
          })),
    [holProject, manualOscIds],
  );

  const openPicker = () => {
    setPicked([...ids]);
    setPickerOpen(true);
  };
  const confirmPicker = () => {
    onPick([...picked].sort((a, b) => a - b));
    setPickerOpen(false);
  };

  return (
    <div>
      <label className="text-gray-400 text-xs font-mono">Linked Tracks</label>
      <div className="flex gap-1 mt-0.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
          placeholder="ex: 1-4, 7, 9-12"
          className={TRACKS_CLS}
        />
        <button
          onClick={(e) => { e.stopPropagation(); openPicker(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag nowheel flex-shrink-0 px-1.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-stagespace-accent rounded border border-gray-700 transition-colors"
          title="Pick tracks visually"
        >
          <LayoutGrid size={12} />
        </button>
      </div>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {ids.slice(0, maxShown).map((id) => (
            <span key={id} className="text-xs font-mono px-1 py-0.5 bg-stagespace-accent/10 text-stagespace-accent rounded">
              {id}
            </span>
          ))}
          {ids.length > maxShown && (
            <span className="text-xs text-gray-500">+{ids.length - maxShown}</span>
          )}
        </div>
      )}

      {pickerOpen && (
        <Modal title="Linked tracks" onClose={() => setPickerOpen(false)}>
          <div className="p-4">
            <TrackGrid
              compact
              tracks={trackInfos}
              selectedTrackIds={new Set(picked)}
              toggleTrackSelection={(tid) =>
                setPicked((prev) =>
                  prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid],
                )
              }
              setTrackSelection={setPicked}
              assignments={[]}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={confirmPicker}
                className="flex-1 py-1.5 bg-stagespace-accent hover:opacity-90 text-gray-950 text-xs rounded font-medium"
              >Confirmer</button>
              <button
                onClick={() => setPickerOpen(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded"
              >Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default LinkedTracksField;
