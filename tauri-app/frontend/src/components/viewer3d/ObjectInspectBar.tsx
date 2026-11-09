/// Barre d'inspect d'un objet sélectionné — état source, position, et
/// actions de release (manual/hold/park/freeze). Partagée par le radar 2D
/// et l'overlay du viewer 3D : la sélection par proximité produit le
/// même affichage sur les deux surfaces.
import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { doClearPosition, doUnpark, doPark, doAttention } from '../../utils/liveActions';
import { sourceHex, SOURCE_LABEL } from '../../utils/sourceColors';

interface ObjectInspectBarProps {
  /// Positions live à afficher (radar: livePositions/emittedPositions,
  /// 3D: movementPositions['global'] → converties en [x,y,z] backend).
  positions: Record<number, [number, number, number]>;
}

export const ObjectInspectBar: React.FC<ObjectInspectBarProps> = ({ positions }) => {
  const selectedObj = useGraphStore((s) => s.selectedObjIndex);
  const setSelectedObj = useGraphStore((s) => s.setSelectedObjIndex);
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);

  if (selectedObj == null) return null;
  const src = objectStates[selectedObj] ?? 'track';
  const pos = positions[selectedObj];
  const trackId = manualOscIds[selectedObj] ?? selectedObj + 1;
  const OVERRIDE_RELEASE: Record<string, (i: number) => void> = {
    manual: doClearPosition, hold: doClearPosition,
    park: doUnpark, freeze: () => doAttention(null),
  };

  return (
    <div className="px-1.5 py-1 rounded bg-gray-800/80 border border-gray-700 text-[10px] flex items-center gap-1.5 flex-shrink-0">
      <span className="text-white font-bold">#{trackId}</span>
      <span
        className="px-1 rounded font-semibold"
        style={{ backgroundColor: sourceHex(src) + '33', color: sourceHex(src) }}
      >
        {SOURCE_LABEL[src] ?? src}
      </span>
      {pos && (
        <span className="text-gray-500 font-mono">
          {pos[0].toFixed(1)},{pos[1].toFixed(1)},{pos[2].toFixed(1)}
        </span>
      )}
      <span className="flex-1" />
      {OVERRIDE_RELEASE[src] && (
        <button
          onClick={() => OVERRIDE_RELEASE[src](selectedObj)}
          className="px-1.5 py-0.5 rounded bg-orange-900/70 text-orange-200 hover:bg-orange-600 text-[10px] font-bold"
          title={`Release obj ${selectedObj} (${src}) — le moteur reprend`}
        >
          release
        </button>
      )}
      <button
        onClick={() => (src === 'park' ? doUnpark(selectedObj) : doPark(selectedObj))}
        className="px-1.5 py-0.5 rounded bg-cyan-900/70 text-cyan-200 hover:bg-cyan-700 text-[10px] font-bold"
        title={src === 'park' ? 'Unpark — l\'objet rejoint recalls/stop' : 'Park — gèle l\'objet hors recalls/stop/panic'}
      >
        {src === 'park' ? 'unpark' : 'park'}
      </button>
      <button
        onClick={() => setSelectedObj(null)}
        className="px-1 text-gray-500 hover:text-white"
        title="Désélectionner"
      >
        ×
      </button>
    </div>
  );
};

export default ObjectInspectBar;
