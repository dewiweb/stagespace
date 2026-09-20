import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import Slider from './ui/Slider';

/**
 * Overlay du mode Draw — slider Z + instructions + bouton Done.
 * Extrait de Scene3D.
 */
export const DrawModeOverlay: React.FC = () => {
  const drawZ = useGraphStore((s) => s.drawZ);
  const setDrawZ = useGraphStore((s) => s.setDrawZ);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);

  return (
    <>
      {/* Z slider overlay */}
      <div className="absolute top-2 left-2 z-20 bg-gray-900/80 backdrop-blur rounded-lg p-2 border border-orange-600/50 flex items-center gap-2">
        <span className="text-orange-400 text-[10px] font-mono">Z</span>
        <Slider
          layout="bare" min={-3} max={3} step={0.1} value={drawZ}
          onChange={setDrawZ} accent="orange" className="w-24"
        />
        <span className="text-white text-[10px] font-mono w-8">{drawZ.toFixed(1)}</span>
        <button
          // Finalize AVANT de clearer — finalizeDrawing lit drawnPoints.
          // (finalizeDrawing sort déjà du drawMode en cas de succès)
          onClick={async () => { await finalizeDrawing(); clearDrawnPoints(); setDrawMode(false); }}
          className="ml-2 px-2 py-0.5 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded font-medium"
        >
          Done
        </button>
        <button
          onClick={() => { clearDrawnPoints(); setDrawMode(false); }}
          className="px-2 py-0.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded font-medium"
        >
          Cancel
        </button>
      </div>
      {/* Instructions */}
      <div className="absolute top-2 right-2 z-20 bg-gray-900/80 backdrop-blur rounded-lg px-3 py-1.5 border border-orange-600/50">
        <span className="text-orange-400 text-[10px] font-medium">
          ✎ Draw mode — click & drag on the scene
        </span>
      </div>
    </>
  );
};
